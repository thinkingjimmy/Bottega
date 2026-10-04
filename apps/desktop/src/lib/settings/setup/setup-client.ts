/**
 * [INPUT]: Depends on shared/setup-ipc, agent-ipc, the Provider IPC refusal check, the main-provided startup snapshot and preload window.setup
 * [OUTPUT]: Provides the provisional startup status, passive snapshots (an App window's refresh is one: main owns maintenance), installation/full checks (for any Provider with facts here, a package Provider included), terminal actions that retain their requested check scope, and headless CLI self-updates.
 * [POS]: apps/desktop/src/lib/settings/setup; Renderer's sole Setup IPC boundary; a Provider refusal reads as each call's unavailable form, never as text (TASK-11 S3-c); the UI never touches downloads, checksums, raw commands, or credentials directly
 */

import { toast } from "@ai-chat/ui/components/ui/sonner";
import { getI18n } from "react-i18next";
import type { AgentBackendId } from "../../../../shared/ipc/agent/agent-ipc";
import type { ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";
import type {
  CliUpdateResult,
  SetupBridgeApi,
  SetupCheckScope,
  SetupTerminalResult,
  SetupEvent,
  SetupStatus,
  SetupTerminalAction,
} from "../../../../shared/ipc/agent/setup-ipc";
import { listBackends } from "../client/settings-client";
import { windowContext } from "../../platform/window-surfaces-client";
import { readStartupSnapshot } from "../../../../shared/startup/startup-snapshot";
import { isProviderIpcRefusal, type ProviderIpcRefusal } from "../../../../shared/providers/catalog-ipc";

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

/* TASK-11 S3-c: main answers a malformed or unknown Provider id with a typed refusal; each call reads it as its own unavailable form
   (the passive status, a no-op, an unavailable update) so no caller ever shows it as text. */
async function orElse<T, F>(channel: string, answer: Promise<T | ProviderIpcRefusal> | undefined, fallback: () => F | Promise<F>): Promise<T | F> {
  if (!answer) return fallback();
  const value = await answer;
  if (!isProviderIpcRefusal(value)) return value;
  console.warn(`[setup] ${channel} refused: ${value.status}${value.status === "unknown-provider" ? ` ${value.id}` : ""}`);
  return fallback();
}

/* Main owns Agent maintenance: an App window reads the passive snapshot (its composer sees the same status) and never asks for a refresh,
   which may start probes and which main answers only for the main window. */
export const refreshSetupIfNeeded = (scope: SetupCheckScope = "full", backends?: ProviderId[]): Promise<SetupStatus> =>
  orElse("refresh", windowContext().role === "app-window" ? undefined : window.setup?.refreshIfNeeded(scope, backends), browserStatus);
export const checkSetup = () => window.setup?.check() ?? browserStatus();
export const recheckBackend = (backend: ProviderId, scope: SetupCheckScope = "full"): Promise<SetupStatus> =>
  orElse("recheck", window.setup?.recheck(backend, scope), browserStatus);
export const refreshBackendLatest = (backend: AgentBackendId): Promise<void> =>
  orElse("refresh-latest", window.setup?.refreshLatest(backend), () => undefined);
export const openBackendTerminalAction = (
  backend: ProviderId,
  action: SetupTerminalAction,
  scope: SetupCheckScope = "full"
): Promise<SetupTerminalResult> =>
  window.setup
    ? orElse("terminal-action", window.setup.terminalAction(backend, action, scope), (): SetupTerminalResult => ({ launched: false, delivery: "cancelled" }))
    : Promise.resolve<SetupTerminalResult>({ launched: false, delivery: "clipboard" });
export const updateBackendCli = (backend: AgentBackendId): Promise<CliUpdateResult> =>
  orElse("update-cli", window.setup?.updateCli(backend), (): CliUpdateResult => ({ ok: false, reason: "unavailable", log: "" }));
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
