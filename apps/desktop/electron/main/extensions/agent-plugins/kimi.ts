/**
 * [INPUT]: Depends on Node os/path, the shared plugin reading primitives, Kimi's read-only plugin registry and the Kimi home resolver
 * [OUTPUT]: Provides kimiPlugins: Kimi's ProviderPluginHooks (a read-only inventory; plugins are managed in Kimi's own TUI)
 * [POS]: Kimi's half of the Agent plugin boundary; it reads Kimi's registry and never writes it
 */
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { AgentPluginBackendView, AgentPluginInventoryEntry } from "../../../../shared/ipc/settings/extensions-ipc";
import { resolveKimiCodeHome } from "../../providers/kimi/home";
import type { ProviderPluginHooks } from "./inventory";
import { asObject, byPluginId, firstString, isContainedPath, jsonValue, pathState, readJson, validPluginId } from "./support";

export type KimiPluginOptions = Readonly<{ userHome?: string; kimiCodeHome?: string }>;

export function kimiPlugins(userData: string, options: KimiPluginOptions = {}): ProviderPluginHooks {
  const userHome = options.userHome ?? homedir();
  const pluginsPath = join(options.kimiCodeHome ?? resolveKimiCodeHome(process.env, userHome), "plugins", "installed.json");
  const projectionRoot = join(userData, "agent-plugin-projections", "kimi");
  const failed: AgentPluginBackendView = { backendId: "kimi", policy: "read-only", inventoryState: "error", plugins: [], guidance: "kimi-tui-plugins" };
  return {
    async inventory() {
      const registry = await readJson(pluginsPath);
      if (registry.state === "error") return failed;
      const rawPlugins = asObject(jsonValue(registry))?.plugins;
      if (registry.state === "ready" && !Array.isArray(rawPlugins)) return failed;
      const plugins: AgentPluginInventoryEntry[] = [];
      for (const raw of Array.isArray(rawPlugins) ? rawPlugins : []) {
        const record = asObject(raw);
        const id = firstString(record?.id);
        const root = firstString(record?.root);
        if (!validPluginId(id) || !root) continue;
        const materialized = await pathState(root);
        plugins.push({
          id,
          displayName: firstString(record?.name, basename(root), id),
          source: firstString(record?.originalSource, record?.source, root),
          origin: await isContainedPath(root, projectionRoot) ? "product" : "user",
          enabled: record?.enabled !== false,
          state: record?.state === "error" || !materialized ? "error" : "ready",
        });
      }
      return { backendId: "kimi", policy: "read-only", inventoryState: "ready", plugins: plugins.sort(byPluginId), guidance: "kimi-tui-plugins" };
    },
  };
}
