/**
 * [INPUT]: Depends on the backend info/AgentBackendId of the agent-ipc
 * [OUTPUT]: Provides Onboarding Discharge marks, setup status, runtime/latest independent events, listing terminal action and preload API
 * [POS]: The contract for the configuration of the shared native Agent; renderer cannot submit commands or credentials
 */

import type { AgentBackendId, BackendInfo } from "./agent-ipc";

/** 产品与 E2E 共用的「本次缺口稍后处理」意图；补齐要求后由产品删除。 */

export type SetupStatus = { backends: BackendInfo[] };
export type SetupTerminalAction = "install" | "update" | "login";

export type SetupEvent =
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
  recheck: "setup:recheck",
  refreshLatest: "setup:refresh-latest",
  terminalAction: "setup:terminal-action",
  event: "setup:event",
} as const;

export type SetupBridgeApi = {
  check: () => Promise<SetupStatus>;
  recheck: (backend: AgentBackendId) => Promise<SetupStatus>;
  refreshLatest: (backend: AgentBackendId) => Promise<void>;
  terminalAction: (
    backend: AgentBackendId,
    action: SetupTerminalAction
  ) => Promise<{
    launched: boolean;
    delivery: "terminal" | "clipboard" | "cancelled";
  }>;
  onEvent: (callback: (event: SetupEvent) => void) => () => void;
};
