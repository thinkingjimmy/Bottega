/**
 * [INPUT]: Depends on main-owned Chat incarnation/workspace resolution, the unified source manifest, operation-time receipt/version projections and late-bound Project authoring ports.
 * [OUTPUT]: Provides bounded mutation receipts, cursor-paginated version metadata and CAS declaration/install/validation/activation tools with source Project identity and lease cancellation.
 * [POS]: Host-retained authoring tools; callers cannot target another Chat or escape the current workspace.
 */
import { hashCanonical } from "@bottega/contracts/core/canonical-json";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { unifiedPluginManifestSchema, UNIFIED_PLUGIN_MANIFEST } from "@bottega/contracts/plugins/platform";
import type { PluginToolContext, PluginToolHandler } from "../../tools/registry";
import type { PLUGIN_TOOL_SPECS } from "../../../../shared/plugin-tools/plugins";
import { unifiedPluginAuthoring, type PluginAuthoringAuthority } from "./unified";
export type PluginAuthoringPorts = Readonly<{ resolveWorkspace(chatId: string, incarnationId: string): Promise<string> }>;
function authority(context: PluginToolContext): PluginAuthoringAuthority {
  context.signal.throwIfAborted(); context.lease.signal.throwIfAborted();
  return { chatId: context.lease.chatId, incarnationId: context.lease.incarnationId,
    signal: AbortSignal.any([context.signal, context.lease.signal]), invocationId: context.invocationId };
}
async function sourceDirectory(workspace: string, requested: string) {
  if (isAbsolute(requested)) throw new Error("Plugin source must be inside the current workspace");
  const root = await realpath(workspace), source = await realpath(resolve(root, requested));
  const tail = relative(root, source);
  if (tail === ".." || tail.startsWith("../") || tail.startsWith("..\\") || isAbsolute(tail)) throw new Error("Plugin source must be inside the current workspace");
  if (!(await stat(join(source, UNIFIED_PLUGIN_MANIFEST)).catch(() => null))?.isFile()) throw new Error("bottega.plugin.json is missing");
  return source;
}
export function createPluginToolset(ports: PluginAuthoringPorts): Record<(typeof PLUGIN_TOOL_SPECS)[number]["name"], PluginToolHandler> {
  const bound = async (context: PluginToolContext, directory = ".") => {
    const auth = authority(context), workspace = await ports.resolveWorkspace(auth.chatId, auth.incarnationId);
    const sourceRoot = await sourceDirectory(workspace, directory);
    const manifest = unifiedPluginManifestSchema.parse(JSON.parse(await readFile(join(sourceRoot, UNIFIED_PLUGIN_MANIFEST), "utf8")));
    auth.signal.throwIfAborted();
    return { ...auth, pluginId: manifest.id, sourceRoot };
  };
  return {
    install_plugin: async (args, context) => {
      const { authoringReceipt } = await import("./receipts");
      const input = await bound(context, args.directory as string);
      if (args.operation === "manifest") {
        const manifest = unifiedPluginManifestSchema.parse(args.declaration);
        if (manifest.id !== input.pluginId) throw new Error("Plugin declaration identity cannot change");
        const current = unifiedPluginManifestSchema.parse(JSON.parse(await readFile(join(input.sourceRoot, UNIFIED_PLUGIN_MANIFEST), "utf8")));
        if (hashCanonical(manifest.source) !== hashCanonical(current.source)) throw new Error("Plugin source provenance cannot change through declaration authoring");
        input.signal.throwIfAborted();
        return authoringReceipt(input.pluginId, "manifest", await unifiedPluginAuthoring().updateManifest({ ...input, manifest, expectedManifestDigest: args.expectedManifestDigest as string }));
      }
      if (args.operation === "dependencies") return authoringReceipt(input.pluginId, "dependencies", await unifiedPluginAuthoring().dependencies({ ...input, operation: "install" }));
      if (args.operation === "check-dependencies") return authoringReceipt(input.pluginId, "check-dependencies", await unifiedPluginAuthoring().dependencies({ ...input, operation: "check" }));
      return authoringReceipt(input.pluginId, "install", await unifiedPluginAuthoring().install(input));
    },
    validate_plugin: async (_args, context) => unifiedPluginAuthoring().validate(await bound(context)),
    plugin_versions: async (args, context) => { const { authoringVersionPage } = await import("./receipts"); const input = await bound(context); const result = await unifiedPluginAuthoring().versions(input.pluginId); input.signal.throwIfAborted(); return authoringVersionPage(input.pluginId, result, args); },
    activate_plugin_version: async (args, context) => { const { authoringReceipt } = await import("./receipts"); const input = await bound(context); return authoringReceipt(input.pluginId, "activate", await unifiedPluginAuthoring().activate(input.pluginId, args.revisionId as string, input)); },
  };
}
