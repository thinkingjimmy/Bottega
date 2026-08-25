/**
 * [INPUT]: Depends on Node fs/path and AppManifest, read the skills of the plugin/project, MCP declaration
 * [OUTPUT]: Provides complete AgentRequirements, incorporating tools found by mechanics into the manifest requirements
 * [POS]: The Agent of apps/install requires a unifier to prevent analytical models from missing the clear declaration warehouse
 */

import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AppManifest } from "../../../../shared/apps-ipc";

export async function completeAgentRequirements(
  manifest: AppManifest,
  appDir: string
) {
  if (
    manifest.kind !== "server" ||
    !manifest.serveAgentPrompt ||
    !manifest.agentRequirements
  ) {
    return manifest;
  }
  const declared = await discoverDeclaredRequirements(appDir);
  return {
    ...manifest,
    agentRequirements: {
      mcpServers: unique([
        ...manifest.agentRequirements.mcpServers,
        ...declared.mcpServers,
      ]),
      skills: unique([
        ...manifest.agentRequirements.skills,
        ...declared.skills,
      ]),
    },
  } satisfies AppManifest;
}

async function discoverDeclaredRequirements(appDir: string) {
  const mcpServers = new Set<string>();
  const skills = new Set<string>();
  await collectSkills(join(appDir, ".agents", "skills"), skills);

  const plugin = await readJson(
    join(appDir, ".agent-plugin", "plugin.json")
  );
  if (plugin) {
    for (const path of stringList(plugin.skills)) {
      await collectSkills(resolve(appDir, path), skills);
    }
    for (const path of stringList(plugin.mcpServers)) {
      await collectMcpJson(resolve(appDir, path), mcpServers);
    }
  }
  await collectMcpJson(join(appDir, ".mcp.json"), mcpServers);
  await collectProjectConfig(
    join(appDir, ".agent", "config.toml"),
    mcpServers
  );
  return { mcpServers: [...mcpServers], skills: [...skills] };
}

async function collectSkills(root: string, names: Set<string>) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    try {
      await readFile(join(root, entry.name, "SKILL.md"), "utf8");
      names.add(entry.name);
    } catch {
      // 缺少 SKILL.md 的目录不是声明的 skill。
    }
  }
}

async function collectMcpJson(path: string, names: Set<string>) {
  const parsed = await readJson(path);
  if (!parsed?.mcpServers || typeof parsed.mcpServers !== "object") return;
  for (const name of Object.keys(parsed.mcpServers)) names.add(name);
}

async function collectProjectConfig(path: string, names: Set<string>) {
  const content = await readFile(path, "utf8").catch(() => "");
  const pattern = /^\s*\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]\s*$/gm;
  for (const match of content.matchAll(pattern)) {
    names.add(match[1] ?? match[2]);
  }
}

async function readJson(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stringList(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return values.filter(
    (item): item is string => typeof item === "string" && Boolean(item.trim())
  );
}

const unique = (values: string[]) => [...new Set(values)].sort();
