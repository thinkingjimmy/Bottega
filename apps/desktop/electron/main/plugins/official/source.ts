/**
 * [INPUT]: Depends on official plugin-owned tool declarations, canonical JSON schemas and main-owned Library paths.
 * [OUTPUT]: Provides unified official manifests, copyable complete feature source and non-destructive source materialization.
 * [POS]: Official plugin source distribution; copied features call the same named host RPC as their original.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { unifiedPluginManifestSchema, type UnifiedPluginManifest } from "@bottega/contracts/plugins/platform";
import { officialToolPlugins, toolBudget, type OfficialToolPlugin } from "../../../../shared/plugin-tools";
import { featureRpcOperation } from "../process/rpc";

export function officialPluginManifest(plugin: OfficialToolPlugin): UnifiedPluginManifest {
  const native = plugin.nativeFeature === "dock" ? [{ kind: "page", id: "settings", name: "Dock", entry: "host-view/dock-settings", hostViewId: "dock-settings", slot: "main.pages", navigation: { label: "Dock" } }]
      : plugin.nativeFeature === "sketch" ? [{ kind: "composer", id: "composer", name: "Sketch", entry: "host-view/sketch-composer", hostViewId: "sketch-composer", slot: "composer.below" }] : [];
  return unifiedPluginManifestSchema.parse({ schemaVersion: 1, id: plugin.id, name: plugin.name, version: "1.0.0",
    providerAlias: plugin.hostInfrastructure ? `host_${plugin.alias}` : plugin.alias,
    source: { kind: "official", format: "bottega", editable: plugin.copyable }, essential: Boolean(plugin.alwaysOn),
    dependencies: plugin.dependencies.map(pluginId => ({ pluginId })), slots: { declares: [], injects: native.map(value => ({ slot: value.slot, ownerPluginId: "host" })) },
    contributions: [...native, ...plugin.tools.map(spec => ({ kind: "tool", id: spec.name, name: spec.name,
      description: spec.description, inputSchema: z.toJSONSchema(spec.wireInputSchema ?? spec.inputSchema, { unrepresentable: "any" }), outputSchema: {},
      executor: { kind: plugin.copyable ? "process" : "host", entry: "service.mjs", method: spec.name },
      timeoutMs: spec.timeoutMs ?? 600_000, access: spec.access === "mutate" ? "write" : "read", planAllowed: !spec.planExcluded,
      manualTurnOnly: Boolean(spec.manualTurnOnly), exactIssued: Boolean(spec.exactIssued),
      backendAllowlist: spec.backendAllowlist, domain: spec.domainId, resultBytes: toolBudget(spec.domainId).logicalResultByteLimit,
      budget: { rateLimit: toolBudget(spec.domainId).rateLimit, rateWindowMs: toolBudget(spec.domainId).rateWindowMs },
    }))],
  });
}
export function officialFeatureSource(plugin: OfficialToolPlugin) {
  if (!plugin.copyable) throw new Error("Host infrastructure cannot be copied");
  const operations = Object.fromEntries(plugin.tools.map(tool => [tool.name, featureRpcOperation(plugin.alias, tool.name)]));
  return `/**
 * [INPUT]: Bottega trusted host RPC for ${plugin.name}.
 * [OUTPUT]: The ${plugin.name} plugin tools and lifecycle.
 * [POS]: Editable official feature source; personal copies use independent plugin identities.
 */
const operations = ${JSON.stringify(operations, null, 2)};
export function prepare() {
  return { activate() {}, drain() {}, dispose() {}, tools: Object.fromEntries(Object.entries(operations).map(([name, operation]) =>
    [name, (args, context) => context.api.call(operation, args)])) };
}
`;
}
export async function ensureOfficialPluginSources(libraryRoot: string) {
  const result: { manifest: UnifiedPluginManifest; sourceDirectory: string; packageDirectory: string; official: OfficialToolPlugin }[] = [];
  for (const official of officialToolPlugins) {
    const manifest = officialPluginManifest(official);
    const sourceDirectory = join(libraryRoot, "plugins", official.id, "source");
    await mkdir(sourceDirectory, { recursive: true, mode: 0o700 });
    const service = official.copyable ? officialFeatureSource(official) : "export function prepare() { return {}; }\n";
    const files = { "bottega.plugin.json": JSON.stringify(manifest, null, 2) + "\n", ...(!official.nativeFeature ? { "service.mjs": service } : {}),
      "package.json": JSON.stringify({ name: official.id.replace(/\./g, "-"), version: manifest.version, private: true, type: "module" }, null, 2) + "\n",
      "README.md": `# ${official.name}\n\n${official.nativeFeature ? "This native feature uses Bottega's existing interface and execution owner. Its native source is not a portable editable plugin package." : official.copyable ? "Copy this plugin to change its behavior. Tools call Bottega's named host RPC." : "Host infrastructure. Execution and recovery remain owned by Bottega."}\n` };
    const fingerprint = createHash("sha256").update(JSON.stringify(files)).digest("hex");
    let prior: string | null = null; try { prior = await readFile(join(sourceDirectory, ".official-source"), "utf8"); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
    if (prior !== fingerprint) {
      for (const [name, text] of Object.entries(files)) await writeFile(join(sourceDirectory, name), text, { mode: 0o600 });
      await writeFile(join(sourceDirectory, ".official-source"), fingerprint, { mode: 0o600 });
    }
    result.push({ manifest, sourceDirectory, packageDirectory: sourceDirectory, official });
  }
  return result;
}
