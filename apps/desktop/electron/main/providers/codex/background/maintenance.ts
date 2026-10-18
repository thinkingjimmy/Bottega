/**
 * [INPUT]: Uses supervised native inventory commands and owned marketplace cleanup.
 * [OUTPUT]: Exports codexMaintenance for read-only inventory and explicit refusal of global-configuration extension installation.
 * [POS]: Codex maintenance boundary; credentials and user configuration remain unchanged.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  buildAgentToolInventory,
} from "../../../apps/runtime/agent-tools";
import { codexEnvironment } from "../environment";
import { workspaceMaintenanceJob } from "../../../backends/jobs/maintenance-job";
import type { MaintenanceAdapter } from "../../../backends/contracts/types";
import { runSupervisedCommand } from "../../../backends/jobs/supervised-command";
import type { AgentBackendId } from "../../../../../shared/ipc/agent/agent-ipc";

/* A supervised auxiliary process: admitted per Agent, tracked for the crash watchdog while it runs (TASK-13 D). */
const runJson = (backend: AgentBackendId, executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) =>
  runSupervisedCommand({ backend, command: executable, args, cwd, env, timeoutMs: 15_000, maxBuffer: 4 * 1024 * 1024,
    label: `codex ${args.slice(0, 2).join(" ")}` }).then(result => result.stdout);


export const codexMaintenance: MaintenanceAdapter = {
  async open({ backend, runtime }) {
    /* CODEX_HOME 解析只有一处真相源（trim+resolve+homedir 回退）；
       在这里再写一遍 `process.env.HOME || ""` 就是第二套会漂移的答案。 */
    const env = codexEnvironment(runtime);
    return {
      createJob: workspaceMaintenanceJob,
      async applyExtension(input) {
        void input;
        throw new Error("Codex extension installation requires global configuration changes and is unsupported by bb-native-v1. The existing Codex configuration was not changed.");
      },
      async inspectToolInventory(workspace) {
        const [mcpJson, pluginJson] = await Promise.all([
          runJson(backend, runtime.executable, ["mcp", "list", "--json"], workspace, env),
          runJson(backend, runtime.executable, ["plugin", "list", "--json"], workspace, env),
        ]);
        return buildAgentToolInventory(workspace, mcpJson, pluginJson);
      },
    };
  },
  async cleanup({ userData, appId }) {
    await rm(join(userData, "plugin-marketplaces", appId), {
      recursive: true,
      force: true,
    });
  },
};
