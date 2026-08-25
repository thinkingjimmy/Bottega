/**
 * [INPUT]: Depends on shared/setup-ipc, agent-ipc and preload window.setup
 * [OUTPUT]: Provides check/recheck/latest/ list of terminal actions renderer IPC packaging and browser mock
 * [POS]: The only output of the lib setup is theUI does not contact downloads, checksum, raw commands or credentials
 */

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
