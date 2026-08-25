/**
 * [INPUT]: Depends on the user's native Codex runtime, Node execFile, App tool clean core and general maintenance session agreement
 * [OUTPUT]: Provides codexMaintenance, creates user-default jobs and mechanical verification of MCP/skill requirements
 * [POS]: The App maintenance adapter for Codex descriptor; Not copying or deleting user authentication
 */

import { execFile } from "node:child_process";
import {
  appendFile,
  mkdir,
  readFile,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import {
  buildPluginMarketplace,
  type ExtensionPlan,
  verifyExtensionPlan,
} from "../../apps/install/extension";
import { buildAgentToolInventory } from "../../apps/runtime/agent-tools";
import {
  codexEnvironment,
} from "../../codex-runtime";
import { codexHome } from "../sandbox/fences";
import {
  validateMaintenanceRequirements,
  workspaceMaintenanceJob,
} from "../maintenance-job";
import type { MaintenanceAdapter } from "../types";

const runJson = (
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      executable,
      args,
      { cwd, env, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 15_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${args.slice(0, 2).join(" ")} 失败：${stderr.trim() || error.message}`));
        } else {
          resolve(stdout);
        }
      }
    );
  });

async function trustProject(homeDir: string, appDir: string) {
  const configPath = join(homeDir, "config.toml");
  const marker = `[projects.${JSON.stringify(appDir)}]`;
  const current = await readFile(configPath, "utf8").catch(() => "");
  if (current.includes(marker)) return;
  await appendFile(
    configPath,
    `${current && !current.endsWith("\n") ? "\n" : ""}${marker}\ntrust_level = "trusted"\n`,
    { mode: 0o600 }
  );
}

export const codexMaintenance: MaintenanceAdapter = {
  async open({ runtime }) {
    /* CODEX_HOME 解析只有一处真相源（trim+resolve+homedir 回退）；
       在这里再写一遍 `process.env.HOME || ""` 就是第二套会漂移的答案。 */
    const homeDir = codexHome();
    await mkdir(homeDir, { recursive: true, mode: 0o700 });
    const env = codexEnvironment(runtime);
    return {
      createJob: workspaceMaintenanceJob,
      async applyExtension(input) {
        const plan = input.value as ExtensionPlan;
        await verifyExtensionPlan(input.appDir, plan);
        await trustProject(homeDir, input.record.dir);
        if (!plan.pluginName) {
          await input.appendLog("[agent] 已批准并信任项目级 .agent/config.toml");
          return;
        }
        const marketplaceName = `app-${input.record.id}`;
        const marketplaceRoot = await buildPluginMarketplace({
          userData: input.userData,
          record: input.record,
          appDir: input.appDir,
          pluginName: plan.pluginName,
        });
        const selector = `${plan.pluginName}@${marketplaceName}`;
        const execute = (args: string[], cwd = input.appDir, allowFailure = false) =>
          input.execute(runtime.executable, args, { cwd, env, allowFailure });
        await execute(["plugin", "remove", selector, "--json"], input.appDir, true);
        await execute(
          ["plugin", "marketplace", "remove", marketplaceName, "--json"],
          input.appDir,
          true
        );
        // SOURCE 恒传 "."，避免含 @ 的绝对路径被 Codex 误判为 owner/repo@ref。
        await execute(["plugin", "marketplace", "add", ".", "--json"], marketplaceRoot);
        await execute(["plugin", "add", selector, "--json"]);
        const listed = await execute(["plugin", "list"]);
        if (!listed.stdout.includes(selector)) {
          throw new Error("Codex plugin list 未显示已安装扩展");
        }
        await input.appendLog(`[agent] 已安装扩展 ${selector}`);
      },
      async inspectToolInventory(workspace) {
        const [mcpJson, pluginJson] = await Promise.all([
          runJson(runtime.executable, ["mcp", "list", "--json"], workspace, env),
          runJson(runtime.executable, ["plugin", "list", "--json"], workspace, env),
        ]);
        return buildAgentToolInventory(workspace, mcpJson, pluginJson);
      },
      validateRequirements: validateMaintenanceRequirements,
    };
  },
  async cleanup({ userData, appId }) {
    await rm(join(userData, "plugin-marketplaces", appId), {
      recursive: true,
      force: true,
    });
  },
};
