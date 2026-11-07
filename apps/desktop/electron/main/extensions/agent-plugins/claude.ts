/**
 * [INPUT]: Depends on Node crypto/fs/os/path, the shared plugin reading primitives, Claude's read-only plugin registry and settings, a strict product-owned disable overlay, and the Claude plugin projection
 * [OUTPUT]: Provides claudePlugins: Claude's ProviderPluginHooks (inventory, per-plugin enable/disable through the overlay, disabled ids, and the frozen session config carrying the projected plugin paths)
 * [POS]: Claude's half of the Agent plugin boundary; the only place that knows Claude's plugin files and projection. It never writes Claude's own state files
 */
import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentPluginBackendView, AgentPluginInventoryEntry } from "../../../../shared/ipc/settings/extensions-ipc";
import { ClaudePluginProjection } from "../skills/claude-plugin-projection";
import type { ProviderPluginHooks } from "./inventory";
import { asObject, byPluginId, firstString, jsonValue, pathState, readJson, validPluginId } from "./support";

const overlayWrites = new Map<string, Promise<void>>();

type OverlayRead =
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "error" }>
  | Readonly<{ state: "ready"; disabledPluginIds: readonly string[]; enabledPluginIds: readonly string[] }>;

export type ClaudePluginOptions = Readonly<{ userHome?: string; claudePluginsPath?: string; claudeSettingsPath?: string }>;

export function claudePlugins(userData: string, options: ClaudePluginOptions = {}): ProviderPluginHooks {
  const userHome = options.userHome ?? homedir();
  const overlayPath = join(userData, "agent-plugin-overlays", "claude.json");
  const pluginsPath = options.claudePluginsPath ?? join(userHome, ".claude", "plugins", "installed_plugins.json");
  const settingsPath = options.claudeSettingsPath ?? join(userHome, ".claude", "settings.json");
  let projection: ClaudePluginProjection | undefined;

  async function disabledIds(): Promise<readonly string[]> {
    const overlay = await readOverlay(overlayPath);
    if (overlay.state === "missing") return [];
    if (overlay.state === "error") throw new Error("Claude plugin overlay cannot be verified");
    return overlay.disabledPluginIds;
  }

  return {
    async inventory(): Promise<AgentPluginBackendView> {
      const [registry, settings, overlay] = await Promise.all([readJson(pluginsPath), readJson(settingsPath), readOverlay(overlayPath)]);
      if (registry.state === "error" || settings.state === "error" || overlay.state === "error") {
        return { backendId: "claude", policy: "managed", inventoryState: "error", plugins: [] };
      }
      const disabled = new Set(overlay.state === "ready" ? overlay.disabledPluginIds : []);
      const forcedEnabled = new Set(overlay.state === "ready" ? overlay.enabledPluginIds : []);
      const enabledPlugins = asObject(asObject(jsonValue(settings))?.enabledPlugins);
      const plugins = asObject(asObject(jsonValue(registry))?.plugins);
      const result: AgentPluginInventoryEntry[] = [];
      for (const [id, raw] of Object.entries(plugins ?? {})) {
        if (!validPluginId(id)) continue;
        const records = Array.isArray(raw) ? raw : [raw];
        const record = records.map(asObject).find(Boolean);
        const installRoot = firstString(record?.installPath, record?.path, record?.root);
        const source = firstString(installRoot, record?.source, id);
        result.push({
          id,
          displayName: id.split("@")[0] || id,
          source,
          origin: "user",
          enabled: forcedEnabled.has(id) || enabledPlugins?.[id] !== false && !disabled.has(id),
          state: (await pathState(installRoot)) ? "ready" : "error",
        });
      }
      return { backendId: "claude", policy: "managed", inventoryState: "ready", plugins: result.sort(byPluginId) };
    },

    disabledIds,

    async setEnabled(pluginId, enabled) {
      if (!validPluginId(pluginId)) throw new Error("pluginId 无效");
      const registry = await readJson(pluginsPath);
      if (registry.state !== "ready" || !Object.hasOwn(asObject(asObject(registry.value)?.plugins) ?? {}, pluginId)) throw new Error("Native plugin is not installed");
      await withOverlayWrite(overlayPath, async () => {
        const overlay = await readOverlay(overlayPath);
        if (overlay.state === "error") throw new Error("Claude plugin overlay cannot be verified");
        const disabled = new Set(overlay.state === "ready" ? overlay.disabledPluginIds : []);
        const forcedEnabled = new Set(overlay.state === "ready" ? overlay.enabledPluginIds : []);
        if (enabled) { disabled.delete(pluginId); forcedEnabled.add(pluginId); }
        else { disabled.add(pluginId); forcedEnabled.delete(pluginId); }
        await mkdir(join(overlayPath, ".."), { recursive: true });
        const temporary = `${overlayPath}.${randomUUID()}.tmp`;
        await writeFile(temporary, `${JSON.stringify({ version: 1, disabledPluginIds: [...disabled].sort(), enabledPluginIds: [...forcedEnabled].sort() }, null, 2)}\n`,
          { encoding: "utf8", mode: 0o600 });
        await rename(temporary, overlayPath);
      });
    },

    /* Frozen at the last moment before spawn; the result only crosses main's memory. */
    async sessionConfig(inventory) {
      const built = await (projection ??= new ClaudePluginProjection(userData)).build(inventory);
      try {
        const overlay = await readOverlay(overlayPath);
        if (overlay.state === "error") throw new Error("Claude plugin overlay cannot be verified");
        const claudeDisabledPluginIds = overlay.state === "ready" ? overlay.disabledPluginIds : [];
        const claudeEnabledPluginIds = overlay.state === "ready" ? overlay.enabledPluginIds : [];
        return built.paths.length || claudeDisabledPluginIds.length || claudeEnabledPluginIds.length
          ? { claudePluginPaths: built.paths, claudeDisabledPluginIds, claudeEnabledPluginIds, releaseClaudePluginProjection: built.release }
          : undefined;
      } catch (cause) {
        await built.release();
        throw cause;
      }
    },
  };
}

function withOverlayWrite<T>(path: string, operation: () => Promise<T>) {
  const previous = overlayWrites.get(path) ?? Promise.resolve();
  const run = previous.then(operation, operation);
  const tail = run.then(() => undefined, () => undefined);
  overlayWrites.set(path, tail);
  return run.finally(() => {
    if (overlayWrites.get(path) === tail) overlayWrites.delete(path);
  });
}

async function readOverlay(path: string): Promise<OverlayRead> {
  const read = await readJson(path);
  if (read.state !== "ready") return read;
  const value = asObject(read.value);
  const ids = value?.disabledPluginIds;
  const enabled = value?.enabledPluginIds ?? [];
  if (value?.version !== 1 || !Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !validPluginId(id)) || new Set(ids).size !== ids.length || !Array.isArray(enabled) || enabled.some(id => typeof id !== "string" || !validPluginId(id) || ids.includes(id)) || new Set(enabled).size !== enabled.length) {
    return { state: "error" };
  }
  return { state: "ready", disabledPluginIds: ids as string[], enabledPluginIds: enabled as string[] };
}
