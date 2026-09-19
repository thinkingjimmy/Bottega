/**
 * [INPUT]: Depends on the backend info/AgentBackendId of the agent-ipc
 * [OUTPUT]: Defines installation-only/full Setup reads, operation-specific feedback, scope-bound terminal delivery and status events.
 * [POS]: Shared contract for native Agent backend setup; the renderer can only trigger a terminal action (install/update/login), never submit commands or credentials directly
 */

import type { AgentBackendId, BackendInfo } from "./agent-ipc";

export type SetupStatus = { backends: BackendInfo[] };
export type SetupCheckScope = "installation" | "full";
export type SetupTerminalAction = "install" | "update" | "login";
export type SetupOperation = SetupTerminalAction | "check" | "load";
export type SetupFeedback = {
  operation: SetupOperation;
  kind: "failed" | "clipboard" | "clipboard-failed";
  diagnostic?: string;
};

export type SetupTerminalResult = {
  launched: boolean;
  delivery: "terminal" | "clipboard" | "clipboard-failed" | "cancelled";
  diagnostic?: string;
};

export type SetupEvent =
  | { type: "open-backends" }
  | { type: "turn-evidence"; evidence: import("./agent-availability/types").TurnAvailabilityEvidence }
  | { type: "status"; backend: AgentBackendId; status: BackendInfo }
  | {
      type: "latest-version";
      backend: AgentBackendId;
      checking: boolean;
      version?: string;
    }
  /** 模型目录缓存已作废；renderer 据此强制重取，不等 TTL 自然过期。 */
  | { type: "models-invalidated"; backend: AgentBackendId };

export const SETUP_CHANNEL = {
  check: "setup:check",
  refreshIfNeeded: "setup:refresh-if-needed",
  watch: "setup:watch",
  cancelCheck: "setup:cancel-check",
  openManagement: "setup:open-agent-management",
  recheck: "setup:recheck",
  refreshLatest: "setup:refresh-latest",
  terminalAction: "setup:terminal-action",
  event: "setup:event",
} as const;

export type SetupBridgeApi = {
  check: () => Promise<SetupStatus>;
  refreshIfNeeded: (scope?: SetupCheckScope) => Promise<SetupStatus>;
  cancelCheck: (backend: AgentBackendId) => Promise<void>;
  openManagement: () => Promise<void>;
  recheck: (backend: AgentBackendId, scope?: SetupCheckScope) => Promise<SetupStatus>;
  refreshLatest: (backend: AgentBackendId) => Promise<void>;
  terminalAction: (
    backend: AgentBackendId,
    action: SetupTerminalAction,
    scope?: SetupCheckScope
  ) => Promise<SetupTerminalResult>;
  onEvent: (callback: (event: SetupEvent) => void) => () => void;
};
