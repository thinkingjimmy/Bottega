/**
 * [INPUT]: Depends on Node fs/path, Codex mcp/plugin list JSON and AppManifest.agentRequirements
 * [OUTPUT]: Provides structured AgentToolInventory to build mechanical tests with required MCP/skills
 * [POS]: Agent security boundaries for apps/runtime, do not accept model self-report READY, only send CLI JSON and SKILL.md
 */

import { access, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ServerAppManifest } from "../../../../shared/apps-ipc";

export type AgentRequirements = NonNullable<
  ServerAppManifest["agentRequirements"]
>;

export type AgentToolInventory = {
  mcpServers: Set<string>;
  skills: Set<string>;
};

export async function buildAgentToolInventory(
  projectDir: string,
  mcpJson: string,
  pluginJson: string
): Promise<AgentToolInventory> {
  const mcpServers = parseEnabledMcpServers(mcpJson);
  const plugins = parseEnabledPlugins(pluginJson);
  const skills = new Set<string>();
  await collectSkillDirectory(join(projectDir, ".agents", "skills"), skills);
  for (const source of plugins.flatMap(({ source }) => (source ? [source] : []))) {
    for (const root of await pluginSkillRoots(source)) {
      await collectSkillDirectory(root, skills);
    }
  }
  const projectPlugin = await readPluginManifest(projectDir);
  if (
    projectPlugin?.name &&
    plugins.some(({ name }) => name === projectPlugin.name)
  ) {
    for (const root of pluginSkillPaths(projectDir, projectPlugin.skills)) {
      await collectSkillDirectory(root, skills);
    }
  }
  return { mcpServers, skills };
}

export function assertAgentRequirements(
  requirements: AgentRequirements,
  inventory: AgentToolInventory
) {
  const missingMcp = requirements.mcpServers.filter(
    (name) => !inventory.mcpServers.has(name)
  );
  const missingSkills = requirements.skills.filter(
    (name) => !inventory.skills.has(name)
  );
  if (missingMcp.length === 0 && missingSkills.length === 0) return;
  const details = [
    missingMcp.length > 0 ? `MCP: ${missingMcp.join(", ")}` : "",
    missingSkills.length > 0 ? `skills: ${missingSkills.join(", ")}` : "",
  ].filter(Boolean);
  throw new Error(`Agent 工具缺失：${details.join("；")}`);
}

export function parseEnabledMcpServers(json: string) {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) throw new Error("codex mcp list 输出格式无效");
  return new Set(
    parsed.flatMap((item) =>
      item &&
      typeof item === "object" &&
      typeof (item as { name?: unknown }).name === "string" &&
      (item as { enabled?: unknown }).enabled === true
        ? [(item as { name: string }).name]
        : []
    )
  );
}

function parseEnabledPlugins(json: string) {
  const parsed = JSON.parse(json) as {
    installed?: unknown;
  };
  if (!Array.isArray(parsed.installed)) {
    throw new Error("codex plugin list 输出格式无效");
  }
  return parsed.installed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const plugin = item as {
      name?: unknown;
      installed?: unknown;
      enabled?: unknown;
      source?: { path?: unknown };
    };
    return plugin.installed === true &&
      plugin.enabled === true &&
      typeof plugin.name === "string"
      ? [
          {
            name: plugin.name,
            source:
              typeof plugin.source?.path === "string"
                ? plugin.source.path
                : undefined,
          },
        ]
      : [];
  });
}

async function pluginSkillRoots(source: string) {
  const manifest = await readPluginManifest(source);
  return manifest ? pluginSkillPaths(source, manifest.skills) : [];
}

async function readPluginManifest(source: string) {
  try {
    return JSON.parse(
      await readFile(join(source, ".agent-plugin", "plugin.json"), "utf8")
    ) as { name?: string; skills?: unknown };
  } catch {
    return null;
  }
}

function pluginSkillPaths(source: string, skills: unknown) {
  const declared = Array.isArray(skills) ? skills : [skills];
  return [
    ...new Set(
      declared.flatMap((value) =>
        typeof value === "string" && value.trim()
          ? [resolve(source, value)]
          : []
      )
    ),
  ];
}

async function collectSkillDirectory(root: string, skills: Set<string>) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    try {
      await access(join(root, entry.name, "SKILL.md"));
      skills.add(entry.name);
    } catch {
      // 没有 SKILL.md 的目录不是可用 skill。
    }
  }
}
