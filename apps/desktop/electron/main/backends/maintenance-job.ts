/**
 * [INPUT]: Depends on the MaintenanceJobInput/HeadlessJob contract
 * [OUTPUT]: Provides workspaceMaintenanceJob
 * [POS]: The backends' single App maintenance job policy: workspace read/write fence, never approve, ephemeral
 */

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
