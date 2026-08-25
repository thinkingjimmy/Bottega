/**
 * [INPUT]: Depends on the Unified Job Maintenance Strategy and the General Maintenance Session Agreement
 * [OUTPUT]: Provides createClaudeMaintenance, creates workspace jobs and refuses to expand
 * [POS]: The following is a list of the most common types of computer adapters: No user authentication directory is read, copied or cleaned.The App extension Skill inventory remains fail-closed, but the interaction session is also found by settingSources=[user, project] user/project Skill, not to be confused with the latter
 */

import type { AgentToolInventory } from "../../apps/runtime/agent-tools";
import {
  validateMaintenanceRequirements,
  workspaceMaintenanceJob,
} from "../maintenance-job";
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
        validateRequirements: validateMaintenanceRequirements,
      };
    },
    async cleanup() {},
  };
}
