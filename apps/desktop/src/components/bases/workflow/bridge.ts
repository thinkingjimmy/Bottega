/**
 * [INPUT]: Depends on the workflow bridge contract (`window.workflows`, installed by the main window's preload) and React.
 * [OUTPUT]: Provides workflowsBridge (the bridge, or null where the preload has none), useProjectBinding — the workflow
 *           binding of a Project's Base, re-read whenever the runtime reports a binding change — and the reminder route:
 *           useOpenConfirmationRoute (a clicked reminder goes to the run's Base) and pendingRunToOpen, which its runs host takes.
 * [POS]: The one way the desktop workflow surfaces (Base ⋯, Project settings › Workflows, the runs host) reach the runtime;
 *        the runtime owns bindings, the interface only reads them.
 */
import { useEffect, useState } from "react";
import { workbenchUiEnabled } from "@ai-chat/ui/lib/workbench-flag";
import type { WorkflowBinding } from "@ai-chat/cloud-protocol/contracts/workflow/binding";
import type { WorkflowsBridge } from "@ai-chat/cloud-protocol/contracts/workflow/bridge";

declare global { interface Window { workflows?: WorkflowsBridge } }

export const workflowsBridge = (): WorkflowsBridge | null => window.workflows ?? null;

/** `undefined` while the first read is in flight, `null` when the Project has no workflow. One Base per Project, so one binding. */
export function useProjectBinding(projectId: string | null): WorkflowBinding | null | undefined {
  const [state, setState] = useState<{ projectId: string; binding: WorkflowBinding | null } | null>(null);
  const bridge = workflowsBridge();
  useEffect(() => {
    if (!projectId || !bridge) return;
    let live = true;
    const load = () => void bridge.bindings(projectId).then(list => { if (live) setState({ projectId, binding: list[0] ?? null }); }, () => { if (live) setState({ projectId, binding: null }); });
    load();
    const stop = bridge.onChanged(event => { if (event.bindingId) load(); });
    return () => { live = false; stop(); };
  }, [projectId, bridge]);
  return !projectId || !bridge ? null : state?.projectId === projectId ? state.binding : undefined;
}

/* A clicked confirmation reminder names a run (Q16). It is navigation only: the run's Base opens, and its runs host takes the
   pending id to show that run's details; nothing is decided. */
let pending: string | null = null;
const pendingListeners = new Set<() => void>();
export const pendingRunToOpen = {
  take() { const runId = pending; pending = null; return runId; },
  peek: () => pending,
  subscribe(listener: () => void) { pendingListeners.add(listener); return () => { pendingListeners.delete(listener); }; },
};

function useRoute(navigate: (path: string) => void) {
  useEffect(() => {
    const bridge = workflowsBridge();
    if (!bridge) return;
    return bridge.onOpenConfirmation(({ runId }) => void bridge.run(runId).then(run => {
      const ownerKey = run?.record.base.ownerKey;
      if (!ownerKey?.startsWith("project:")) return;
      pending = runId;
      for (const listener of pendingListeners) listener();
      navigate(`/bases/project/${ownerKey.slice("project:".length)}`);
    }, () => undefined));
  }, [navigate]);
}
/** Mounted once in the product shell; a constant no-op without the workbench flag. */
export const useOpenConfirmationRoute: (navigate: (path: string) => void) => void = workbenchUiEnabled ? useRoute : () => undefined;
