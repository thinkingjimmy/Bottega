/**
 * [INPUT]: Uses the product permission mode contract.
 * [OUTPUT]: Exports NATIVE_BACKGROUND_PENDING_DETAIL, NativeBackgroundResult and NativeBackgroundCommand, per-item control status, non-authorizing original-item identity and bounded output of a Chat-owned native command.
 * [POS]: Shared background-running-item DTO; native terminal IDs and process authority remain in main.
 */
export const NATIVE_BACKGROUND_PENDING_DETAIL = "Execution result unknown until completion is confirmed.";

import type { AgentPermissionMode } from "./agent-ipc";
export type NativeBackgroundCommand = {
  id: string;
  itemId: string;
  chatId: string;
  incarnationId: string;
  command: string;
  cwd: string;
  permissionMode: AgentPermissionMode;
  status: "running" | "stopping" | "failed";
  output: string;
};

/** Internal result data; a renderer cannot submit it or acquire process authority. */
export type NativeBackgroundResult = {
  itemId: string;
  outcome: "completed" | "failed" | "stopped" | "unknown";
  exitCode?: number;
  output: string;
};
