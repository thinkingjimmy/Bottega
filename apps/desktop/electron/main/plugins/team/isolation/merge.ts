/**
 * [INPUT]: Existing managed Git preflight, common-dir mutation gate, Seatbelt runner and durable JSON publication.
 * [OUTPUT]: Strict private merge state for startup relocation, version-bound non-destructive worktree merge plans, conflict results and interrupted-publication recovery.
 * [POS]: Reusable controlled isolation result coordinator for team and opt-in Workflow writers.
 */
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import { z } from "zod";
import { hashCanonical } from "@bottega/contracts/core/canonical-json";
import { pluginIdentitySchema } from "@bottega/contracts/plugins/platform";
import { DurableJson } from "../../../persistence/durable-json";
import { preflightManagedWorktree } from "../../../projects/git/managed-worktree";
import { GitCommandError, resolveGitIdentity, runGit, runOwnedGitMutationSequence } from "../../../projects/git/git-runner";

const commit = z.string().regex(/^[a-f0-9]{40,64}$/);
export const pluginWorktreeMergeInputSchema = z.object({
  operationId: pluginIdentitySchema, owner: z.object({ kind: z.enum(["team", "workflow"]), id: pluginIdentitySchema }).strict(),
  sourceWorkspace: z.string().min(1).max(32768), memberWorktree: z.string().min(1).max(32768),
  expectedHead: commit, memberCommit: commit, message: z.string().min(1).max(200),
}).strict();
const planSchema = z.object({
  input: pluginWorktreeMergeInputSchema, inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["prepared", "applied", "conflicted", "blocked"]), mergeCommit: commit.optional(),
  tree: commit.optional(), error: z.string().max(4096).optional(), conflicts: z.array(z.string().max(1024)).max(256).default([]),
  createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
}).strict();
export const pluginWorktreeMergeStateSchema = z.object({ schemaVersion: z.literal(1), plans: z.array(planSchema) }).strict();
export type PluginWorktreeMergeInput = z.infer<typeof pluginWorktreeMergeInputSchema>;
export type PluginWorktreeMergePlan = z.infer<typeof planSchema>;
type Options = Readonly<{ userData: string; beforePublish?(plan: PluginWorktreeMergePlan): Promise<void> }>;
export class PluginWorktreeMerges {
  private readonly file: DurableJson<z.infer<typeof pluginWorktreeMergeStateSchema>>;
  private readonly flights = new Map<string, { hash: string; promise: Promise<PluginWorktreeMergePlan> }>();
  constructor(private options: Options) {
    this.file = new DurableJson(join(options.userData, "plugin-worktree-merges.json"), pluginWorktreeMergeStateSchema, () => ({ schemaVersion: 1, plans: [] }));
  }
  async initialize() { await this.file.initialize(); }
  list(owner?: { kind: "team" | "workflow"; id: string }) {
    return this.file.read(state => state.plans.filter(plan => !owner || plan.input.owner.kind === owner.kind && plan.input.owner.id === owner.id));
  }
  merge(raw: PluginWorktreeMergeInput, guard: () => void | Promise<void> = () => {}): Promise<PluginWorktreeMergePlan> {
    const input = pluginWorktreeMergeInputSchema.parse(raw), hash = hashCanonical(input);
    const pending = this.flights.get(input.operationId);
    if (pending) return pending.hash === hash ? pending.promise : Promise.reject(new Error("Merge operation identity differs from its original input"));
    const work = this.perform(input, hash, guard);
    this.flights.set(input.operationId, { hash, promise: work });
    void work.finally(() => { if (this.flights.get(input.operationId)?.promise === work) this.flights.delete(input.operationId); }).catch(() => undefined);
    return work;
  }
  private async perform(input: PluginWorktreeMergeInput, inputHash: string, guard: () => void | Promise<void>): Promise<PluginWorktreeMergePlan> {
    const existing = this.file.read(state => state.plans.find(plan => plan.input.operationId === input.operationId));
    if (existing && existing.inputHash !== inputHash) throw new Error("Merge operation identity differs from its original input");
    if (existing?.status === "applied" || existing?.status === "conflicted") return existing;
    const source = await realpath(input.sourceWorkspace), member = await realpath(input.memberWorktree);
    const sourcePreflight = await preflightManagedWorktree(source), memberIdentity = await resolveGitIdentity(member);
    if (!sourcePreflight.supported) throw new Error("Controlled worktree merge requires macOS Git sandbox support");
    if (source === member || sourcePreflight.identity.topLevel !== source || memberIdentity.topLevel !== member ||
      memberIdentity.commonDir !== sourcePreflight.identity.commonDir) throw new Error("Worktree repository identities differ");
    if (sourcePreflight.dirty.staged || sourcePreflight.dirty.unstaged || sourcePreflight.dirty.untracked) throw new Error("Commit or preserve Project changes before merging a member");
    if ((await runGit(member, ["status", "--porcelain=v1", "--untracked-files=all"])).trim()) throw new Error("Member worktree has uncommitted changes");
    if ((await runGit(member, ["rev-parse", "HEAD"])).trim() !== input.memberCommit) throw new Error("Member commit changed after merge review");
    return runOwnedGitMutationSequence(source, { commonDir: sourcePreflight.identity.commonDir,
      writeRoots: [source, sourcePreflight.identity.commonDir], denyRoots: [member], readRoots: [member] },
    ["merge", "--ff-only", input.memberCommit], async run => {
      await guard();
      const head = (await run(["rev-parse", "HEAD"])).trim();
      if (existing?.mergeCommit && head === existing.mergeCommit) return this.update(input.operationId, plan => { plan.status = "applied"; delete plan.error; });
      if (head !== input.expectedHead) {
        if (existing) await this.update(input.operationId, plan => { plan.status = "blocked"; plan.error = "Project destination changed after merge review"; });
        throw new Error("Project destination changed after merge review");
      }
      if ((await run(["status", "--porcelain=v1", "--untracked-files=all"])).trim()) throw new Error("Project destination changed while preparing the merge");
      let plan = existing ?? await this.file.mutate(state => {
        const now = Date.now(), created: PluginWorktreeMergePlan = { input, inputHash, status: "prepared", conflicts: [], createdAt: now, updatedAt: now };
        state.plans.push(created); return created;
      });
      if (!plan.mergeCommit) {
        let tree: string;
        try { tree = (await run(["merge-tree", "--write-tree", input.expectedHead, input.memberCommit])).trim().split("\n")[0]!; }
        catch (cause) {
          if (!(cause instanceof GitCommandError) || cause.detail.exitCode !== 1) throw cause;
          const base = (await run(["merge-base", input.expectedHead, input.memberCommit])).trim();
          const left = new Set((await run(["diff", "--name-only", base, input.expectedHead])).trim().split("\n"));
          const conflicts = (await run(["diff", "--name-only", base, input.memberCommit])).trim().split("\n").filter(path => path && left.has(path)).slice(0, 256);
          return this.update(input.operationId, current => { current.status = "conflicted"; current.conflicts = conflicts;
            current.error = "Overlapping changes require review in the isolated member worktree"; });
        }
        commit.parse(tree);
        const merged = (await run(["commit-tree", tree, "-p", input.expectedHead, "-p", input.memberCommit, "-m", input.message])).trim();
        commit.parse(merged);
        plan = await this.update(input.operationId, current => { current.tree = tree; current.mergeCommit = merged; current.status = "prepared"; delete current.error; });
      }
      await this.options.beforePublish?.(plan); await guard();
      if ((await run(["rev-parse", "HEAD"])).trim() !== input.expectedHead ||
        (await run(["status", "--porcelain=v1", "--untracked-files=all"])).trim()) throw new Error("Project destination changed before merge publication");
      await run(["merge", "--ff-only", "--no-overwrite-ignore", plan.mergeCommit!]);
      if ((await run(["rev-parse", "HEAD"])).trim() !== plan.mergeCommit) throw new Error("Merge publication could not be confirmed");
      return this.update(input.operationId, current => { current.status = "applied"; delete current.error; });
    });
  }
  private update(operationId: string, mutate: (plan: PluginWorktreeMergePlan) => void) {
    return this.file.mutate(state => {
      const plan = state.plans.find(value => value.input.operationId === operationId);
      if (!plan) throw new Error("Merge plan is not available");
      mutate(plan); plan.updatedAt = Date.now(); return plan;
    });
  }
  async close() { await Promise.allSettled([...this.flights.values()].map(value => value.promise)); await this.file.closeAndFlush(); }
}
export async function openPluginWorktreeMerges(options: Options) {
  const service = new PluginWorktreeMerges(options); await service.initialize(); return service;
}
