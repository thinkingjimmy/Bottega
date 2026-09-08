/**
 * [INPUT]: Depends on shared/setup-ipc, agent-ipc and preload window.setup
 * [OUTPUT]: Wraps passive setup reads, explicit recheck/cancel, fixed terminal actions and main Agent settings navigation with localized failure feedback.
 * [POS]: Renderer's sole Setup IPC boundary; the UI never touches downloads, checksums, raw commands, or credentials directly
 */

import { toast } from "@ai-chat/ui/components/ui/sonner";
import { getI18n } from "react-i18next";
import type { AgentBackendId } from "../../shared/agent-ipc";
import type {
  SetupBridgeApi,
  SetupEvent,
  SetupStatus,
  SetupTerminalAction,
} from "../../shared/setup-ipc";
import { listBackends } from "./settings-client";

declare global {
  interface Window {
    setup?: SetupBridgeApi;
  }
}

const browserStatus = async (): Promise<SetupStatus> => ({
  backends: await listBackends(),
});

export const checkSetup = () => window.setup?.check() ?? browserStatus();
export const recheckBackend = (backend: AgentBackendId) =>
  window.setup?.recheck(backend) ?? browserStatus();
export const refreshBackendLatest = (backend: AgentBackendId) =>
  window.setup?.refreshLatest(backend) ?? Promise.resolve();
export const openBackendTerminalAction = (
  backend: AgentBackendId,
  action: SetupTerminalAction
) =>
  window.setup?.terminalAction(backend, action) ??
  Promise.resolve({ launched: false, delivery: "clipboard" as const });
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
