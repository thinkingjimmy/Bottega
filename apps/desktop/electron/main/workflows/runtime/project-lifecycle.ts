/**
 * [INPUT]: Depends on the run ledger, the binding store, the workspace leases and the executor's cancel.
 * [OUTPUT]: Provides PROJECT_ARCHIVED_PAUSE, PROJECT_RESTORED_PAUSE, assertProjectOpen (an archived Project starts, resumes, retries or confirms nothing), pauseProjectRuns (archive: every unfinished run pauses, a running step first finishing, an unanswered confirmation withdrawn and its run paused at once — A2-03), restoreProjectRuns (V-02: restore restates the archive's pause as PROJECT_RESTORED_PAUSE, which the person can continue), followProjectArchive (D3-02: runs follow the Project's archivedAt from any writer, in order, and once for every bound Project at install), removeOrphanedProjectWorkflows (DM-04(a): at install, the workflows of a Project removed while the runtime was absent) and removeProjectWorkflows (delete / remove: cancel like a person would, and only once every run is proven stopped — its state finished and custody holding nothing of an unknown attempt — forget its runs, leases and binding; otherwise refuse with the reason and remove nothing).
 * [POS]: The workflow side of a Project's archive and deletion (2-design §115; plan TASK-17). The archive service and the Project cleanup handler call it through the runtime; it never decides a stop without the executor's evidence.
 */
import { TERMINAL_RUN_STATES, type PauseReason, type WorkflowRun } from "@ai-chat/cloud-protocol/contracts/workflow/run";
import type { WorkflowBindingStore } from "../bindings";
import type { WorkflowExecutor } from "../executor";
import type { WorkflowRunLedger } from "../ledger";
import type { WorkspaceLeases } from "./workspace-leases";

/** Archive reuses the person's pause: the interface names it by its detail, and resume is refused while the Project is archived. */
export const PROJECT_ARCHIVED_PAUSE: PauseReason = { kind: "user", detail: "project-archived" };
/** V-02: after restore the pause is still the archive's doing, not the person's; the interface says so and offers Continue. */
export const PROJECT_RESTORED_PAUSE: PauseReason = { kind: "user", detail: "project-restored" };
export const PROJECT_ARCHIVED = "workflow-project-archived";
/** How long a deletion waits for a cancelled step's own evidence before it stops and says why. */
const SETTLE_MS = 15_000;

const finished = (run: WorkflowRun) => (TERMINAL_RUN_STATES as readonly string[]).includes(run.state);
const runsOf = (deps: { ledger: WorkflowRunLedger; bindings: WorkflowBindingStore }, projectId: string) =>
  deps.ledger.list().filter(run => deps.bindings.get(run.bindingId)?.projectId === projectId);

export function assertProjectOpen(archived: () => boolean) {
  if (archived()) throw new Error(PROJECT_ARCHIVED);
}

/**
 * Archive (2-design §115): new execution stops; a running step finishes and its run then pauses. A confirmation still waiting is
 * withdrawn and its run paused now (A2-03): the archived Project refuses the answer, so nothing may keep waiting for it.
 */
export async function pauseProjectRuns(deps: { ledger: WorkflowRunLedger; bindings: WorkflowBindingStore }, projectId: string) {
  for (const run of runsOf(deps, projectId)) {
    if (finished(run) || run.state === "paused" || run.state === "cancelling") continue;
    if (run.state === "waiting-human") await deps.ledger.pauseWithdrawingConfirmation(run.runId, PROJECT_ARCHIVED_PAUSE);
    else if (!run.pauseRequested) await deps.ledger.pause(run.runId, PROJECT_ARCHIVED_PAUSE);
  }
}

/** V-02: restore restates the archive's pause as `project-restored`, so the person can continue the run themselves (TASK-17). */
export async function restoreProjectRuns(deps: { ledger: WorkflowRunLedger; bindings: WorkflowBindingStore }, projectId: string) {
  for (const run of runsOf(deps, projectId)) {
    if (!finished(run)) await deps.ledger.restatePause(run.runId, PROJECT_ARCHIVED_PAUSE, PROJECT_RESTORED_PAUSE);
  }
}

/** What the runs follow: a Project's archivedAt, and each durable change of it from any writer (a local archive, a synced head). */
export type ArchivedProjects = {
  get(projectId: string): { archivedAt?: number | null } | null | undefined;
  onArchivedChange(listener: (projectId: string) => void): () => void;
};

/**
 * D3-02: the Project's archivedAt is the one truth for its runs, whoever wrote it. Archived, they pause (pauseProjectRuns); open,
 * the archive's pause is restated as project-restored (restoreProjectRuns). Both are idempotent, so this runs on every change, in
 * order, and once for every bound Project when the runtime is installed: a change made before then, or a crash between the Project
 * write and the run writes, converges at the next start. A Project that no longer exists is left to its removal.
 */
export function followProjectArchive(deps: { ledger: WorkflowRunLedger; bindings: WorkflowBindingStore; projects: ArchivedProjects; changed?(): void }) {
  let tail = Promise.resolve();
  let stopped = false;
  const reconcile = (projectId: string) => {
    tail = tail.then(async () => {
      const project = stopped ? null : deps.projects.get(projectId);
      if (!project) return;
      if (project.archivedAt) await pauseProjectRuns(deps, projectId); else await restoreProjectRuns(deps, projectId);
      deps.changed?.();
    }).catch(cause => console.warn(`[workflows] the runs of Project ${projectId} could not follow its archive state`, cause));
  };
  const unsubscribe = deps.projects.onArchivedChange(reconcile);
  for (const projectId of new Set(deps.bindings.list().map(binding => binding.projectId))) reconcile(projectId);
  return { settled: () => tail, stop() { stopped = true; unsubscribe(); } };
}

/**
 * DM-04(a): a Project removed while the workflow runtime was not installed had its cleanup skipped; when the runtime is installed,
 * the workflows of every bound Project that no longer exists are removed the same way (cancel, prove stopped, forget). One whose run
 * may still be running stays, with the reason logged, and is retried at the next start. Returns the Projects removed.
 */
export async function removeOrphanedProjectWorkflows(deps: Parameters<typeof removeProjectWorkflows>[0] & { projects: Pick<ArchivedProjects, "get"> }) {
  /* Destructive, so "not loaded" never reads as "deleted": every existence is decided first, and a store that cannot answer (not
     ready yet, or poisoned by a failed write) skips the whole sweep. An archived Project is a Project. */
  let orphans: string[];
  try { orphans = [...new Set(deps.bindings.list().map(binding => binding.projectId))].filter(projectId => !deps.projects.get(projectId)); }
  catch (cause) { console.warn("[workflows] the Project store cannot answer yet; the removed-Project sweep is skipped until the next start", cause); return []; }
  const removed: string[] = [];
  for (const projectId of orphans) {
    try { await removeProjectWorkflows(deps, projectId); removed.push(projectId); }
    catch (cause) { console.warn(`[workflows] the workflows of removed Project ${projectId} stay until the next start`, cause); }
  }
  return removed;
}

/**
 * Delete / remove: every unfinished run is cancelled as a person would cancel it, and the step's own evidence decides when it
 * stopped (A-01). Only when every run of the Project is finished are its runs, leases and binding forgotten; while one may still
 * run, the deletion stays in progress with that reason and can be retried (Force stop remains the way to prove it).
 */
export async function removeProjectWorkflows(deps: { ledger: WorkflowRunLedger; bindings: WorkflowBindingStore; leases: WorkspaceLeases;
  executor: Pick<WorkflowExecutor, "cancel" | "mayStillRun">; settleMs?: number; wait?(ms: number): Promise<void> }, projectId: string) {
  for (const run of runsOf(deps, projectId)) if (!finished(run)) await deps.executor.cancel(run.runId);
  const wait = deps.wait ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const deadline = Date.now() + (deps.settleMs ?? SETTLE_MS);
  while (runsOf(deps, projectId).some(run => !finished(run)) && Date.now() < deadline) await wait(Math.min(250, deps.settleMs ?? SETTLE_MS));
  /* A terminal state is not the proof (A2-01): an attempt whose cleanup is unknown is forgotten only once custody holds nothing of it. */
  const stillRunning = await Promise.all(runsOf(deps, projectId).map(run => !finished(run) || deps.executor.mayStillRun(run.runId)));
  if (stillRunning.some(Boolean)) {
    // A code, not a sentence: the interface names it (a run still stopping; a process may still be running; Force stop, then retry).
    throw new Error("workflow-runs-stopping");
  }
  for (const run of runsOf(deps, projectId)) { await deps.leases.releaseRun(run.runId); await deps.ledger.forget(run.runId); }
  await deps.bindings.removeProject(projectId);
}
