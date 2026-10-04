/**
 * [INPUT]: Depends on the workflows bridge contract (type only).
 * [OUTPUT]: Provides workflowsBridge (the main window's `window.workflows`, or null elsewhere) and its global typing, and
 *           workflowLifecycleFailure — a Project or Chat archive / removal the workflow runtime refused (by its code), in the interface language.
 * [POS]: apps/desktop/src/lib/clients; Renderer entry to the workflow runtime (run detail, confirmation, rework draft, the record's Workflow block, ▶ start, needs-you); the interface's fake implements the same WorkflowsBridge.
 */
import type { WorkflowsBridge } from "@ai-chat/cloud-protocol/contracts/workflow/bridge";
declare global { interface Window { workflows?: WorkflowsBridge } }
export const workflowsBridge = (): WorkflowsBridge | null => window.workflows ?? null;

type LifecycleCopy = { archiveStepRunning: string; runsStillStopping: string; runtimeNotReady: string };
/**
 * The runtime refuses an archive while a workflow step runs, a removal while a run cannot be proven stopped, and a cleanup
 * while it is not ready yet, each by its code. Their line for the person, or null for any other failure (shown as it is).
 */
export function workflowLifecycleFailure(message: string, copy: LifecycleCopy | null) {
  if (!copy) return null;
  return ({ "workflow-step-running": copy.archiveStepRunning, "workflow-runs-stopping": copy.runsStillStopping,
    "workflow-runtime-not-ready": copy.runtimeNotReady } as Record<string, string>)[message] ?? null;
}
