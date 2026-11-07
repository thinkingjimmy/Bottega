/**
 * [INPUT]: Owned Library execution domain, durable run identities, existing managed Git worktree policy and shared controlled merge coordinator.
 * [OUTPUT]: WorkflowIsolation for explicit per-run workspaces, validated execution roots and accepted-result publication.
 * [POS]: Optional Workflow execution owner; ordinary runs keep the existing shared workspace and writer lease.
 */
import { mkdir, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { prepareWorkflowExecution, verifyWorkflowExecution, workflowLibraryRoot } from "../../../library/workflows/paths";
import { workflowWorkspacesSchema, workflowWorkspacesPath, type WorkflowWorkspace as Entry } from "./model";
import { hashCanonical } from "@bottega/contracts/core/canonical-json";
import type { WorkflowIsolationMergeInput, WorkflowIsolationMergeResult, WorkflowIsolationSnapshot } from "@ai-chat/cloud-protocol/contracts/workflow/bridge";
import { DurableJson } from "../../../persistence/durable-json";
import { assertManagedWorktreeShape, commitManagedWorktree, createManagedWorktree, preflightManagedWorktree } from "../../../projects/git/managed-worktree";
import { resolveGitIdentity, runGit } from "../../../projects/git/git-runner";
import { openPluginWorktreeMerges, type PluginWorktreeMergePlan } from "../../../plugins/team/isolation/merge";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
type Options = Readonly<{ userData: string; libraryRoot?(): string | null; readRun(runId: string): { revision: number; state: string; businessOutcome: string | null } | null;
  beforePublish?(plan: PluginWorktreeMergePlan): Promise<void> }>;
export class WorkflowIsolation {
  private readonly file: DurableJson<z.infer<typeof workflowWorkspacesSchema>>;
  private readonly allocations = new Map<string, Promise<Entry>>();
  private readonly publications = new Map<string, { operationId: string; hash: string; promise: Promise<WorkflowIsolationMergeResult> }>();
  private merges!: Awaited<ReturnType<typeof openPluginWorktreeMerges>>;
  constructor(private options: Options) {
    this.file = new DurableJson(workflowWorkspacesPath(options.userData), workflowWorkspacesSchema, () => ({ schemaVersion: 1, entries: [] }));
  }
  async initialize() { await this.file.initialize(); this.merges = await openPluginWorktreeMerges(this.options); }
  async preflight(sourceWorkspace: string) {
    const preflight = await preflightManagedWorktree(await realpath(sourceWorkspace));
    if (!preflight.supported) throw new Error("Workflow worktree isolation requires macOS Git sandbox support");
    return preflight;
  }
  workspace(runId: string) { return this.entry(runId)?.status === "ready" ? this.entry(runId)!.workspace : null; }
  ensure(input: { runId: string; projectId: string; sourceWorkspace: string; previousRunId?: string }): Promise<Entry> {
    id.parse(input.runId); id.parse(input.projectId); if (input.previousRunId) id.parse(input.previousRunId);
    const pending = this.allocations.get(input.runId); if (pending) return pending;
    const work = this.allocate(input); this.allocations.set(input.runId, work);
    void work.finally(() => { if (this.allocations.get(input.runId) === work) this.allocations.delete(input.runId); }).catch(() => undefined);
    return work;
  }
  private async allocate(input: { runId: string; projectId: string; sourceWorkspace: string; previousRunId?: string }): Promise<Entry> {
    const preflight = await this.preflight(input.sourceWorkspace), sourceWorkspace = preflight.identity.topLevel;
    const libraryRoot = await workflowLibraryRoot(this.options.libraryRoot?.(), this.options.userData);
    let entry = this.entry(input.runId);
    if (entry && entry.libraryRoot !== libraryRoot) throw new Error("Workflow execution Library root changed");
    if (entry && (entry.projectId !== input.projectId || entry.sourceWorkspace !== sourceWorkspace || entry.commonDir !== preflight.identity.commonDir || entry.previousRunId !== input.previousRunId))
      throw new Error("Workflow isolated Project identity changed");
    if (entry?.status === "ready") { await this.validate(input.runId, sourceWorkspace); return entry; }
    let baseCommit = preflight.baseCommit;
    if (!entry && input.previousRunId) {
      const previous = this.entry(input.previousRunId), run = this.options.readRun(input.previousRunId);
      if (!previous || run?.state !== "succeeded" || run.businessOutcome !== "rework-requested" || previous.projectId !== input.projectId ||
        previous.sourceWorkspace !== sourceWorkspace || previous.commonDir !== preflight.identity.commonDir)
        throw new Error("The previous isolated Workflow must be terminal and request rework in this Project");
      await this.validate(input.previousRunId, sourceWorkspace);
      await commitManagedWorktree({ sourceIdentity: preflight.identity, worktreeDir: previous.workspace, branch: previous.branch, message: "Preserve isolated Workflow result for rework" });
      baseCommit = (await runGit(previous.workspace, ["rev-parse", "HEAD"])).trim();
    }
    const workspace = await prepareWorkflowExecution(libraryRoot, input.runId, input.projectId, sourceWorkspace);
    if (!entry) entry = await this.file.mutate(state => {
      const key = hashCanonical([input.projectId, input.runId]), entry: Entry = { ...input, sourceWorkspace, workspace, libraryRoot,
        commonDir: preflight.identity.commonDir, baseCommit, branch: "bottega/workflow/" + key.slice(0, 32), status: "preparing" };
      state.entries.push(entry); return entry;
    });
    await mkdir(dirname(entry.workspace), { recursive: true });
    await createManagedWorktree({ sourceWorkspace, worktreeDir: entry.workspace, baseCommit: entry.baseCommit, branch: entry.branch, expectedIdentity: preflight.identity });
    return this.file.mutate(state => { const value = state.entries.find(value => value.runId === input.runId)!; value.status = "ready"; return value; });
  }
  async validate(runId: string, sourceWorkspace: string) {
    const entry = this.entry(runId); if (!entry || entry.status !== "ready") throw new Error("Workflow isolated workspace is not ready");
    const root = await workflowLibraryRoot(this.options.libraryRoot?.(), this.options.userData);
    if (entry.libraryRoot !== root) throw new Error("Workflow execution Library root changed");
    await verifyWorkflowExecution(root, runId, entry.projectId, entry.workspace);
    const source = await resolveGitIdentity(sourceWorkspace), isolated = await assertManagedWorktreeShape(entry.workspace);
    if (source.topLevel !== entry.sourceWorkspace || source.commonDir !== entry.commonDir || isolated.commonDir !== entry.commonDir ||
      (await runGit(entry.workspace, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim() !== entry.branch)
      throw new Error("Workflow isolated workspace identity changed");
    return entry.workspace;
  }
  execution(runId: string) {
    const entry = this.entry(runId); if (!entry || entry.status !== "ready") return null;
    return { workspace: entry.workspace, projectWorkspace: entry.sourceWorkspace, validate: () => this.validate(runId, entry.sourceWorkspace).then(() => {}) };
  }
  async status(runId: string): Promise<WorkflowIsolationSnapshot | null> {
    const entry = this.entry(runId); if (!entry) return null;
    await this.validate(runId, entry.sourceWorkspace);
    const latest = this.merges.list({ kind: "workflow", id: runId }).at(-1);
    return { runId, workspace: entry.workspace, branch: entry.branch, baseCommit: entry.baseCommit,
      status: latest?.status === "applied" ? "merged" : latest?.status === "conflicted" ? "conflicted" : "ready",
      expectedHead: (await runGit(entry.sourceWorkspace, ["rev-parse", "HEAD"])).trim(),
      memberCommit: (await runGit(entry.workspace, ["rev-parse", "HEAD"])).trim(),
      dirty: Boolean((await runGit(entry.workspace, ["status", "--porcelain=v1", "--untracked-files=all"])).trim()),
      ...(latest ? { merge: this.result(latest) } : {}) };
  }
  merge(input: WorkflowIsolationMergeInput & { runId: string }): Promise<WorkflowIsolationMergeResult> {
    const hash = hashCanonical(input), pending = this.publications.get(input.runId);
    if (pending) return pending.operationId === input.operationId && pending.hash === hash ? pending.promise : Promise.reject(new Error("A Workflow result merge is already pending"));
    const promise = this.publish(input); this.publications.set(input.runId, { operationId: input.operationId, hash, promise });
    void promise.finally(() => { if (this.publications.get(input.runId)?.promise === promise) this.publications.delete(input.runId); }).catch(() => undefined);
    return promise;
  }
  private async publish(input: WorkflowIsolationMergeInput & { runId: string }) {
    const guard = () => {
      const run = this.options.readRun(input.runId);
      if (!run || run.state !== "succeeded" || !["accepted", "accepted-with-exceptions"].includes(run.businessOutcome ?? "")) throw new Error("Only an accepted completed Workflow result can merge");
      if (run.revision !== input.expectedRunRevision) throw new Error("Workflow run revision changed after merge review");
    };
    guard();
    const entry = this.entry(input.runId); if (!entry) throw new Error("Workflow has no isolated workspace");
    await this.validate(input.runId, entry.sourceWorkspace); guard();
    const identity = await resolveGitIdentity(entry.sourceWorkspace);
    await commitManagedWorktree({ sourceIdentity: identity, worktreeDir: entry.workspace, branch: entry.branch, message: "Commit accepted isolated Workflow result" });
    const memberCommit = (await runGit(entry.workspace, ["rev-parse", "HEAD"])).trim();
    const result = await this.merges.merge({ operationId: input.operationId, owner: { kind: "workflow", id: input.runId }, sourceWorkspace: entry.sourceWorkspace,
      memberWorktree: entry.workspace, expectedHead: input.expectedHead, memberCommit, message: "Merge accepted isolated Workflow result" }, guard);
    return this.result(result);
  }
  private result(plan: PluginWorktreeMergePlan): WorkflowIsolationMergeResult {
    return { status: plan.status, expectedHead: plan.input.expectedHead, memberCommit: plan.input.memberCommit, conflicts: plan.conflicts,
      ...(plan.mergeCommit ? { mergeCommit: plan.mergeCommit } : {}), ...(plan.error ? { error: plan.error } : {}) };
  }
  private entry(runId: string) { return this.file.read(state => state.entries.find(value => value.runId === runId)); }
  async close() { await Promise.allSettled([...this.allocations.values(), ...[...this.publications.values()].map(value => value.promise)]); await this.merges.close(); await this.file.closeAndFlush(); }
}
export async function openWorkflowIsolation(options: Options) { const service = new WorkflowIsolation(options); await service.initialize(); return service; }
