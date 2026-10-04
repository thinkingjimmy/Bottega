/**
 * [INPUT]: Installed workflow runtime, bounded evidence reader and the authoritative plugin catalog.
 * [OUTPUT]: workflowResourcePort with run actions, encrypted evidence pages and revision-checked enable-and-retry through normal plugin admission.
 * [POS]: cloud/remote/resources' seam onto workflows; the same bridge calls a person on this computer makes, so every rule (plugin gate, A-02, Q20) applies unchanged.
 */
import { workflowRuntime } from "../../../workflows/runtime/installed";
import type { WorkflowResourcePort } from "./runtime";
import { installedPluginCatalog } from "../../../plugins/catalog";

export function workflowResourcePort(): WorkflowResourcePort | null {
  const runtime = workflowRuntime();
  if (!runtime) return null;
  return {
    run: runId => runtime.run(runId),
    evidence: (runId, stepId, kind, offset) => runtime.evidence(runId, stepId, kind, offset),
    async enableBlockingPlugin(runId, stepId, expectedRevision) {
      const run = runtime.run(runId), step = run?.steps.find(item => item.stepId === stepId), reason = step?.blockedReason;
      if (!run) throw new Error("workflow-run-not-found");
      if (run.revision !== expectedRevision) throw new Error("input-changed");
      if (run.state !== "blocked" || step?.state !== "blocked") throw new Error("not-blocked");
      const pluginId = reason?.kind === "no-valid-report" && reason.extractor === "plugin-disabled" ? "claude" : reason?.kind === "plugin-disabled" ? reason.provider : null;
      if (!pluginId) throw new Error("not-blocked");
      const catalog = installedPluginCatalog();
      if (!catalog) throw new Error("plugin-not-found");
      const plugin = await catalog.detail(pluginId);
      if (plugin.turnOn.mode === "setup") throw new Error("plugin-setup-required");
      if (plugin.availability.state === "unsupported") throw new Error("plugin-unsupported");
      if (runtime.run(runId)?.revision !== expectedRevision) throw new Error("input-changed");
      // The same catalog performs dependency and owner admission as a click on this computer.
      await catalog.setEnabled(pluginId, true);
      return runtime.retryStep(runId, stepId);
    },
    confirm: (runId, stepId, input, operator) => runtime.confirmAs(runId, stepId, input, operator),
    async act(action, runId, input) {
      switch (action) {
        case "cancel": return runtime.cancel(runId);
        case "force-stop": return runtime.forceStop(runId);
        case "pause": return runtime.pause(runId);
        case "resume": return runtime.resume(runId);
        case "check-result": return runtime.checkResult(runId);
        case "retry-step": return runtime.retryStep(runId, input.stepId as string);
        case "start-rework": return runtime.startRework(runId, input.choice as "keep-plan" | "replan");
      }
    },
    start: async (bindingId, rowId) => (await runtime.start({ bindingId, rowId })).run,
  };
}
