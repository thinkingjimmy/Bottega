/**
 * [INPUT]: Depends on Unified Maintenance job strategy, App tools, purely core and general maintenance session
 * [OUTPUT]: Provides create KimiMaintenance, create workspace jobs and mechanical verification project skills
 * [POS]: The Application is designed to support the development of the applicationKIMI_CODE_HOME is a unified file prepared by headless spec, which does not touch the certification file
 */

import { buildAgentToolInventory } from "../../apps/runtime/agent-tools";
import {
  validateMaintenanceRequirements,
  workspaceMaintenanceJob,
} from "../maintenance-job";
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
        validateRequirements: validateMaintenanceRequirements,
      };
    },
    async cleanup() {},
  };
}
