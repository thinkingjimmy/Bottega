/**
 * [INPUT]: Depends on MaintenanceJobInput/HeadlessJob Contract with App Tools Clean Core
 * [OUTPUT]: Provides workspaceMaintenanceJob and validateMaintenanceRequirements
 * [POS]: The backends of the App maintains a unified job strategy; workspace, fences, never, approval and ephemeral
 */

import {
  assertAgentRequirements,
  type AgentRequirements,
  type AgentToolInventory,
} from "../apps/runtime/agent-tools";
import type { HeadlessJob, MaintenanceJobInput } from "./types";

/** App 维护 job 的统一档位：workspace 读写围栏、永不审批、不留用户态副作用。 */
export function workspaceMaintenanceJob(input: MaintenanceJobInput): HeadlessJob {
  return {
    ...input,
    sandboxRoot: input.cwd,
    readRoots: [input.cwd],
    toolPolicy: "workspace",
    ephemeral: true,
    approvalPolicy: "never",
    env: "user-default",
    ignoreUserConfig: true,
  };
}

export function validateMaintenanceRequirements(
  requirements: unknown,
  inventory: unknown
) {
  assertAgentRequirements(
    requirements as AgentRequirements,
    inventory as AgentToolInventory
  );
}
