/**
 * [INPUT]: Depends on product Extension inventory, read-only Claude/Kimi CLI registries, real-path containment, and a strict product-owned Claude disable overlay
 * [OUTPUT]: Provides fail-closed AgentPluginInventory, OpenCode policy-only status, and path-serialized atomic Claude flag-overlay controls
 * [POS]: Extensions inventory and ambient-plugin policy boundary; it never reads OpenCode config bytes or writes either CLI's state files
 */

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  AgentPluginBackendView,
  AgentPluginInventoryEntry,
  ExtensionInventorySnapshot,
} from "../../../shared/extensions-ipc";
import { resolveKimiCodeHome } from "../backends/kimi/home";

const MAX_REGISTRY_BYTES = 1024 * 1024;
const PLUGIN_ID = /^[^\p{Cc}\p{Cf}]{1,200}$/u;
const overlayWrites = new Map<string, Promise<void>>();

type JsonRead =
  | Readonly<{ state: "ready"; value: unknown }>
  | Readonly<{ state: "missing" | "error" }>;

export class AgentPluginInventory {
  private readonly overlayPath: string;
  private readonly claudePluginsPath: string;
  private readonly claudeSettingsPath: string;
  private readonly kimiPluginsPath: string;
  private readonly kimiProjectionRoot: string;

  constructor(
    userData: string,
    options: Readonly<{
      userHome?: string;
      kimiCodeHome?: string;
      claudePluginsPath?: string;
      claudeSettingsPath?: string;
    }> = {}
  ) {
    const userHome = options.userHome ?? homedir();
    this.overlayPath = join(userData, "agent-plugin-overlays", "claude.json");
    this.claudePluginsPath =
      options.claudePluginsPath ??
      join(userHome, ".claude", "plugins", "installed_plugins.json");
    this.claudeSettingsPath =
      options.claudeSettingsPath ?? join(userHome, ".claude", "settings.json");
    this.kimiPluginsPath = join(
      options.kimiCodeHome ?? resolveKimiCodeHome(process.env, userHome),
      "plugins",
      "installed.json"
    );
    this.kimiProjectionRoot = join(
      userData,
      "agent-plugin-projections",
      "kimi"
    );
  }

  async snapshot(
    inventory: ExtensionInventorySnapshot
  ): Promise<readonly AgentPluginBackendView[]> {
    const [claude, kimi] = await Promise.all([
      this.claudeInventory(),
      this.kimiInventory(),
    ]);
    return [
      {
        backendId: "codex",
        policy: "managed",
        inventoryState: "ready",
        plugins: productPlugins(inventory),
      },
      claude,
      kimi,
      {
        backendId: "opencode",
        policy: "blocked",
        reason: "arbitrary-code-outside-product-fence",
        unlock: "safe-inventory-oracle-and-fenced-execution",
      },
    ];
  }

  async disabledClaudePluginIds(): Promise<readonly string[]> {
    const overlay = await readClaudeOverlay(this.overlayPath);
    if (overlay.state === "missing") return [];
    if (overlay.state === "error") {
      throw new Error("Claude plugin disable overlay 无法验证");
    }
    return overlay.disabledPluginIds;
  }

  async setClaudeEnabled(pluginId: string, enabled: boolean) {
    if (!validPluginId(pluginId)) throw new Error("pluginId 无效");
    await withOverlayWrite(this.overlayPath, async () => {
      const disabled = new Set(await this.disabledClaudePluginIds());
      if (enabled) disabled.delete(pluginId);
      else disabled.add(pluginId);
      await mkdir(join(this.overlayPath, ".."), { recursive: true });
      const temporary = `${this.overlayPath}.${randomUUID()}.tmp`;
      await writeFile(
        temporary,
        `${JSON.stringify({ version: 1, disabledPluginIds: [...disabled].sort() }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 }
      );
      await rename(temporary, this.overlayPath);
    });
  }

  private async claudeInventory(): Promise<AgentPluginBackendView> {
    const [registry, settings, overlay] = await Promise.all([
      readJson(this.claudePluginsPath),
      readJson(this.claudeSettingsPath),
      readClaudeOverlay(this.overlayPath),
    ]);
    if (
      registry.state === "error" ||
      settings.state === "error" ||
      overlay.state === "error"
    ) {
      return {
        backendId: "claude",
        policy: "managed",
        inventoryState: "error",
        plugins: [],
      };
    }
    const disabled = new Set(
      overlay.state === "ready" ? overlay.disabledPluginIds : []
    );
    const enabledPlugins = asObject(asObject(jsonValue(settings))?.enabledPlugins);
    const plugins = asObject(asObject(jsonValue(registry))?.plugins);
    const result: AgentPluginInventoryEntry[] = [];
    for (const [id, raw] of Object.entries(plugins ?? {})) {
      if (!validPluginId(id)) continue;
      const records = Array.isArray(raw) ? raw : [raw];
      const record = records.map(asObject).find(Boolean);
      const installRoot = firstString(
        record?.installPath,
        record?.path,
        record?.root
      );
      const source = firstString(
        installRoot,
        record?.source,
        id
      );
      result.push({
        id,
        displayName: id.split("@")[0] || id,
        source,
        origin: "user",
        enabled: enabledPlugins?.[id] !== false && !disabled.has(id),
        state: (await pathState(installRoot))
          ? "ready"
          : "error",
      });
    }
    return {
      backendId: "claude",
      policy: "managed",
      inventoryState: "ready",
      plugins: result.sort(byPluginId),
    };
  }

  private async kimiInventory(): Promise<AgentPluginBackendView> {
    const registry = await readJson(this.kimiPluginsPath);
    if (registry.state === "error") {
      return {
        backendId: "kimi",
        policy: "read-only",
        inventoryState: "error",
        plugins: [],
        guidance: "kimi-tui-plugins",
      };
    }
    const rawPlugins = asObject(jsonValue(registry))?.plugins;
    if (registry.state === "ready" && !Array.isArray(rawPlugins)) {
      return {
        backendId: "kimi",
        policy: "read-only",
        inventoryState: "error",
        plugins: [],
        guidance: "kimi-tui-plugins",
      };
    }
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
        origin: await isContainedPath(root, this.kimiProjectionRoot)
          ? "product"
          : "user",
        enabled: record?.enabled !== false,
        state: record?.state === "error" || !materialized ? "error" : "ready",
      });
    }
    return {
      backendId: "kimi",
      policy: "read-only",
      inventoryState: "ready",
      plugins: plugins.sort(byPluginId),
      guidance: "kimi-tui-plugins",
    };
  }
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

function productPlugins(
  inventory: ExtensionInventorySnapshot
): readonly AgentPluginInventoryEntry[] {
  return inventory.packages.flatMap((owner) => {
    const generation = owner.generations.find(
      (item) =>
        item.packageGenerationId === owner.activeGenerationRef?.packageGenerationId
    );
    if (!generation?.admissionEvidence.adapterId.startsWith("agent-plugins-")) {
      return [];
    }
    return [{
      id: owner.installIdentity,
      displayName: generation.displayName ?? owner.installIdentity,
      source: owner.source.normalizedUrl,
      origin: "product" as const,
      enabled: owner.enabled === "enabled",
      state: owner.admission === "valid" ? "ready" as const : "error" as const,
    }];
  }).sort(byPluginId);
}

async function readJson(path: string): Promise<JsonRead> {
  try {
    const bytes = await readFile(path);
    if (bytes.byteLength > MAX_REGISTRY_BYTES) return { state: "error" };
    return { state: "ready", value: JSON.parse(bytes.toString("utf8")) };
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "ENOENT"
      ? { state: "missing" }
      : { state: "error" };
  }
}

/* missing 与 error 在读取面同义：都没有可信内容可读。区别只在调用方——
   谁要 fail-closed，谁就先看 `state`，而不是靠两份同形的取值函数区分。 */
function jsonValue(read: JsonRead) {
  return read.state === "ready" ? read.value : {};
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.length > 0) ?? "";
}

function validPluginId(value: string) {
  return PLUGIN_ID.test(value);
}

async function pathState(path: string) {
  if (!path) return false;
  try {
    const metadata = await lstat(resolve(path));
    return metadata.isDirectory() || metadata.isFile();
  } catch {
    return false;
  }
}

async function isContainedPath(path: string, parent: string) {
  try {
    const [candidate, boundary] = await Promise.all([
      realpath(path),
      realpath(parent),
    ]);
    const child = relative(boundary, candidate);
    return child === "" || (
      child !== ".." &&
      !child.startsWith(`..${sep}`) &&
      !isAbsolute(child)
    );
  } catch {
    return false;
  }
}

type ClaudeOverlayRead =
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "error" }>
  | Readonly<{ state: "ready"; disabledPluginIds: readonly string[] }>;

async function readClaudeOverlay(path: string): Promise<ClaudeOverlayRead> {
  const read = await readJson(path);
  if (read.state !== "ready") return read;
  const value = asObject(read.value);
  const ids = value?.disabledPluginIds;
  if (
    value?.version !== 1 ||
    !Array.isArray(ids) ||
    ids.some((id) => typeof id !== "string" || !validPluginId(id)) ||
    new Set(ids).size !== ids.length
  ) {
    return { state: "error" };
  }
  return { state: "ready", disabledPluginIds: ids as string[] };
}

function byPluginId(left: AgentPluginInventoryEntry, right: AgentPluginInventoryEntry) {
  return left.id.localeCompare(right.id);
}
