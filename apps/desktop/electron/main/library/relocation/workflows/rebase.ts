/**
 * [INPUT]: Verified relocation roots, private Workflow/merge schemas, owned execution markers and bounded managed Git mutation.
 * [OUTPUT]: Idempotent execution/merge receipt rebasing and strict common-Git link repair before relocation completion.
 * [POS]: Startup-only Library writer; live Workflow owners are not constructed while its journal is pending.
 */
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { hashCanonical } from "@bottega/contracts/core/canonical-json";
import { workflowWorkspacesSchema, workflowWorkspacesPath, type WorkflowWorkspace } from "../../../workflows/runtime/isolation/model";
import { pluginWorktreeMergeStateSchema } from "../../../plugins/team/isolation/merge";
import { durableReplaceFile } from "../../../persistence/durable-json";
import { assertManagedWorktreeShape } from "../../../projects/git/managed-worktree";
import { runGit, runOwnedGitMutationSequence } from "../../../projects/git/git-runner";
import { isUnder } from "../../paths";
import { verifyWorkflowExecution, workflowExecutionPath, workflowLibraryRoot } from "../../workflows/paths";
const rebase = (path: string, from: string, to: string) => isUnder(path, from) ? to + path.slice(from.length) : path;
const readJson = (path: string) => readFile(path, "utf8").then(JSON.parse).catch(cause => { if (cause.code === "ENOENT") return null; throw cause; });

export async function rebaseWorkflowExecution(userData: string, from: string, to: string) {
  const path = workflowWorkspacesPath(userData), raw = await readJson(path);
  if (raw) {
    const state = workflowWorkspacesSchema.parse(raw);
    for (const entry of state.entries) {
      if (entry.libraryRoot !== from && entry.libraryRoot !== to) continue;
      if (entry.workspace !== workflowExecutionPath(entry.libraryRoot, entry.runId)) throw new Error("Workflow relocation execution identity changed");
      await workflowLibraryRoot(to, userData);
      const next = { ...entry, libraryRoot: to, workspace: rebase(entry.workspace, from, to),
        sourceWorkspace: rebase(entry.sourceWorkspace, from, to), commonDir: rebase(entry.commonDir, from, to) };
      await verifyWorkflowExecution(to, entry.runId, entry.projectId, next.workspace);
      Object.assign(entry, next);
    }
    await durableReplaceFile(path, JSON.stringify(state, null, 2) + "\n", 0o600);
  }
  const mergePath = join(userData, "plugin-worktree-merges.json"), merges = await readJson(mergePath);
  if (!merges) return;
  const state = pluginWorktreeMergeStateSchema.parse(merges);
  for (const plan of state.plans) {
    if (plan.inputHash !== hashCanonical(plan.input)) throw new Error("Workflow relocation merge receipt identity changed");
    plan.input.sourceWorkspace = rebase(plan.input.sourceWorkspace, from, to);
    plan.input.memberWorktree = rebase(plan.input.memberWorktree, from, to);
    plan.inputHash = hashCanonical(plan.input);
  }
  await durableReplaceFile(mergePath, JSON.stringify(state, null, 2) + "\n", 0o600);
}
async function boundedFile(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4096) throw new Error("Workflow Git link identity changed");
  return (await readFile(path, "utf8")).trim();
}
async function repair(entry: WorkflowWorkspace, from: string, to: string) {
  await verifyWorkflowExecution(to, entry.runId, entry.projectId, entry.workspace);
  const link = await boundedFile(join(entry.workspace, ".git"));
  if (!link.startsWith("gitdir: ")) throw new Error("Workflow Git link is not managed");
  const linked = resolve(entry.workspace, link.slice(8));
  const previousCommon = rebase(entry.commonDir, to, from);
  const tails = [entry.commonDir, previousCommon].map(root => relative(root, linked));
  const tail = tails.find(value => !isAbsolute(value) && /^worktrees\/[A-Za-z0-9._-]+$/.test(value.split(sep).join("/")));
  if (!tail) throw new Error("Workflow Git link points outside its recorded repository");
  const admin = join(entry.commonDir, tail);
  if (await realpath(admin) !== admin || (await lstat(admin)).isSymbolicLink() || await boundedFile(join(admin, "HEAD")) !== "ref: refs/heads/" + entry.branch)
    throw new Error("Workflow Git branch ownership changed");
  const previousWorkspace = rebase(entry.workspace, to, from), reverse = await boundedFile(join(admin, "gitdir"));
  if (![join(previousWorkspace, ".git"), join(entry.workspace, ".git")].includes(reverse)) throw new Error("Workflow Git reverse link ownership changed");
  await runOwnedGitMutationSequence(entry.sourceWorkspace, { commonDir: entry.commonDir, writeRoots: [entry.commonDir, entry.workspace], denyRoots: previousCommon === entry.commonDir ? [previousWorkspace] : [previousWorkspace, previousCommon], readRoots: [entry.sourceWorkspace, entry.workspace] },
    ["worktree", "repair", entry.workspace], async (run, source) => {
      if (source.commonDir !== entry.commonDir) throw new Error("Workflow relocation repository changed");
      await run(["worktree", "repair", entry.workspace]);
      const actual = await assertManagedWorktreeShape(entry.workspace);
      if (actual.commonDir !== entry.commonDir || (await runGit(entry.workspace, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim() !== entry.branch)
        throw new Error("Workflow repaired worktree identity changed");
    });
}
export async function repairWorkflowExecution(userData: string, from: string, to: string) {
  const raw = await readJson(workflowWorkspacesPath(userData)); if (!raw) return;
  for (const entry of workflowWorkspacesSchema.parse(raw).entries) {
    if (entry.libraryRoot !== to) continue;
    const present = await lstat(join(entry.workspace, ".git")).then(() => true, cause => { if (cause.code === "ENOENT") return false; throw cause; });
    if (entry.status === "ready" || present) await repair(entry, from, to);
  }
}
