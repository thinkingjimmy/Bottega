/**
 * [INPUT]: Depends on the installed workflow runtime (runs, bindings, needs-you, workflow Chats, Project existence, change and ledger-write signals), the installed Agent-configuration store for configuration names, and WorkflowProjectionPublisher.
 * [OUTPUT]: Provides attachWorkflowProjection: runs the publisher while both the account runtime and the workflow runtime exist, returning a handle that closes it.
 * [POS]: workflows/projection's startup seam; cloud composition calls it once the account runtime exists, and the workflow runtime may be installed later.
 */
import { agentConfigsRuntime } from "../../agent-configs/runtime";
import { effectiveOf } from "../../agent-configs/store";
import { onWorkflowRuntime } from "../runtime/installed";
import type { WorkflowRuntime } from "../runtime/composition";
import { WorkflowProjectionPublisher, type WorkflowProjectionPorts, type WorkflowProjectionSource } from "./publisher";

function sourceOf(runtime: WorkflowRuntime): WorkflowProjectionSource {
  return {
    runs: () => runtime.ledger.list(),
    bindings: () => runtime.bindings(),
    projectExists: projectId => runtime.projectExists(projectId),
    removedProjects: () => runtime.removedProjects(),
    acknowledgeRemoved: projectId => runtime.acknowledgeRemovedProject(projectId),
    needsYou: () => runtime.needsYou(),
    chatFor: (runId, role) => runtime.chatFor({ runId }, role)?.chatId ?? null,
    configName: configId => {
      const record = agentConfigsRuntime()?.store.snapshot().records.find(item => item.configId === configId);
      return record ? effectiveOf(record).payload?.name ?? null : null;
    },
    // Every durable run write, and everything else the runtime announces (bindings, an Agent waiting in a workflow Chat).
    onChanged: listener => {
      const releases = [runtime.onChanged(() => listener()), runtime.ledger.onWritten(() => listener()),
        agentConfigsRuntime()?.store.onChanged(() => listener()) ?? (() => {})];
      return () => { for (const release of releases) release(); };
    },
  };
}

export function attachWorkflowProjection(ports: Omit<WorkflowProjectionPorts, "source">) {
  let publisher: WorkflowProjectionPublisher | null = null;
  let closing: Promise<void> = Promise.resolve();
  const report = (error: unknown) => console.warn("[workflows] projection failed", error instanceof Error ? error.message : String(error));
  const release = onWorkflowRuntime(runtime => {
    const previous = publisher;
    publisher = runtime ? new WorkflowProjectionPublisher({ report, ...ports, source: sourceOf(runtime) }) : null;
    if (previous) closing = closing.then(() => previous.close());
  });
  return {
    wake: () => publisher?.wake(),
    close: async () => { release(); const last = publisher; publisher = null; await closing; await last?.close(); },
  };
}
