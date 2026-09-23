/**
 * [INPUT]: Depends on shared/setup-ipc, agent-ipc, the main-provided startup snapshot and preload window.setup
 * [OUTPUT]: Provides the provisional startup status, passive snapshots, installation/full checks, terminal actions that retain their requested check scope, and headless CLI self-updates.
 * [POS]: Renderer's sole Setup IPC boundary; the UI never touches downloads, checksums, raw commands, or credentials directly
 */

import { toast } from "@ai-chat/ui/components/ui/sonner";
import { getI18n } from "react-i18next";
import type { AgentBackendId } from "../../shared/agent-ipc";
import type {
  CliUpdateResult,
  SetupBridgeApi,
  SetupCheckScope,
  SetupTerminalResult,
  SetupEvent,
  SetupStatus,
  SetupTerminalAction,
} from "../../shared/setup-ipc";
import { listBackends } from "./settings-client";
import { readStartupSnapshot } from "../../shared/startup-snapshot";

/**
 * The Agents main confirmed on the previous launch, handed over at window creation.
 * They exist so the onboarding gate can settle on the first render; this launch's
 * discovery replaces them as soon as it has a real verdict.
 */
export const startupSetupStatus = (): SetupStatus | null => {
  const backends = readStartupSnapshot()?.setup?.backends;
  return backends?.length ? { backends } : null;
};

declare global {
  interface Window {
    setup?: SetupBridgeApi;
  }
}

const browserStatus = async (): Promise<SetupStatus> => ({
  backends: await listBackends(),
});

export const refreshSetupIfNeeded = (scope: SetupCheckScope = "full") => window.setup?.refreshIfNeeded(scope) ?? browserStatus();
export const checkSetup = () => window.setup?.check() ?? browserStatus();
export const recheckBackend = (backend: AgentBackendId, scope: SetupCheckScope = "full") =>
  window.setup?.recheck(backend, scope) ?? browserStatus();
export const refreshBackendLatest = (backend: AgentBackendId) =>
  window.setup?.refreshLatest(backend) ?? Promise.resolve();
export const openBackendTerminalAction = (
  backend: AgentBackendId,
  action: SetupTerminalAction,
  scope: SetupCheckScope = "full"
) =>
  window.setup?.terminalAction(backend, action, scope) ??
  Promise.resolve<SetupTerminalResult>({ launched: false, delivery: "clipboard" });
export const updateBackendCli = (backend: AgentBackendId) =>
  window.setup?.updateCli(backend) ??
  Promise.resolve<CliUpdateResult>({ ok: false, reason: "unavailable", log: "" });
export const onSetupEvent = (callback: (event: SetupEvent) => void) =>
  window.setup?.onEvent(callback) ?? (() => {});

export const openAgentSettings = async () => {
  try {
    if (!window.setup) throw new Error("Main window unavailable");
    await window.setup.openManagement();
  } catch {
    toast.error(getI18n().t("agentAvailability.managementUnavailable"));
  }
};
