/**
 * [INPUT]: Depends on the runtime composition's type only.
 * [OUTPUT]: Provides installWorkflowRuntime, workflowRuntime() (the composed workflow runtime once it exists, or null) and onWorkflowRuntime (told now and on every install or removal).
 * [POS]: Kept apart from composition.ts so the main window can reach the runtime without pulling the whole workflow runtime into the startup closure (the runtime is loaded after startup by a dynamic import).
 */
import type { WorkflowRuntime } from "./composition";

let installed: WorkflowRuntime | null = null;
const listeners = new Set<(runtime: WorkflowRuntime | null) => void>();
export function installWorkflowRuntime(runtime: WorkflowRuntime | null) { installed = runtime; for (const listener of listeners) listener(runtime); }
export const workflowRuntime = () => installed;
/** The runtime once installed; a runtime that never comes (it failed to start) is an error after `timeoutMs`, so a caller can retry. */
/** The cloud side attaches whenever the runtime exists; it loads after startup, so it may come later than the account. */
export function onWorkflowRuntime(listener: (runtime: WorkflowRuntime | null) => void) {
  listeners.add(listener); listener(installed);
  return () => { listeners.delete(listener); };
}
