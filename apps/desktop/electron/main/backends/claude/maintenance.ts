/**
 * [INPUT]: Depends on the Unified Job Maintenance Strategy and the General Maintenance Session Agreement
 * [OUTPUT]: Provides createClaudeMaintenance, creates workspace jobs and refuses to expand
 * [POS]: backends/claude's App-maintenance adapter; never reads, copies, or cleans the user auth directory. The App extension Skill inventory stays fail-closed, while the interactive session separately discovers user/project Skills via settingSources=[user, project] — the two must not be conflated
 */

import {
  type AgentToolInventory,
} from "../../apps/runtime/agent-tools";
import { workspaceMaintenanceJob } from "../maintenance-job";
import type { MaintenanceAdapter } from "../types";

export function createClaudeMaintenance(): MaintenanceAdapter {
  return {
    async open() {
      return {
        createJob: workspaceMaintenanceJob,
        async applyExtension() {
          throw new Error("Claude 运行暂不支持带扩展的 App");
        },
        async inspectToolInventory() {
          return {
            mcpServers: new Set<string>(),
            skills: new Set<string>(),
          } satisfies AgentToolInventory;
        },
      };
    },
    async cleanup() {},
  };
}
