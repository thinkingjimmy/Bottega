/**
 * [INPUT]: Depends on Unified Maintenance job strategy, App tools, purely core and general maintenance session
 * [OUTPUT]: Provides create KimiMaintenance, create workspace jobs and mechanical verification project skills
 * [POS]: backends/kimi's App-maintenance adapter; KIMI_CODE_HOME is prepared uniformly by the headless spec, and this file never touches credential files
 */

import {
  buildAgentToolInventory,
} from "../../apps/runtime/agent-tools";
import { workspaceMaintenanceJob } from "../maintenance-job";
import type { MaintenanceAdapter } from "../types";

export function createKimiMaintenance(): MaintenanceAdapter {
  return {
    async open() {
      return {
        createJob: workspaceMaintenanceJob,
        async applyExtension() {
          throw new Error("Kimi 运行暂不支持带扩展的 App");
        },
        async inspectToolInventory(workspace) {
          return buildAgentToolInventory(
            workspace,
            "[]",
            '{"installed":[]}'
          );
        },
      };
    },
    async cleanup() {},
  };
}
