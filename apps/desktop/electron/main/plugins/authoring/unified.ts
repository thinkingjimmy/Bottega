/**
 * [INPUT]: Depends on main-owned source Project authoring callbacks and per-turn authority.
 * [OUTPUT]: Provides deferred and late-bound authoring ports plus exact source Chat authority types.
 * [POS]: Unified authoring composition boundary; multiple Chats edit one source Project without owning plugin records.
 */
import type { UnifiedPluginManifest } from "@bottega/contracts/plugins/platform";
export type PluginAuthoringAuthority = Readonly<{ chatId: string; incarnationId: string; signal: AbortSignal; invocationId: string }>;
export type PluginSourceAuthoringAuthority = PluginAuthoringAuthority & Readonly<{ sourceRoot: string }>;
export type UnifiedPluginAuthoringPort = Readonly<{
  updateManifest(input: PluginAuthoringAuthority & { pluginId: string; sourceRoot: string; manifest: UnifiedPluginManifest; expectedManifestDigest: string }): Promise<unknown>;
  install(input: PluginAuthoringAuthority & { sourceRoot: string }): Promise<unknown>;
  validate(input: PluginAuthoringAuthority & { pluginId: string; sourceRoot: string }): Promise<unknown>;
  versions(pluginId: string): Promise<unknown>;
  activate(pluginId: string, revisionId: string, authority: PluginSourceAuthoringAuthority): Promise<unknown>;
  dependencies(input: PluginAuthoringAuthority & { pluginId: string; sourceRoot: string; operation: "install" | "check" }): Promise<unknown>;
}>;
export function deferUnifiedPluginAuthoring(load: () => Promise<UnifiedPluginAuthoringPort>): UnifiedPluginAuthoringPort {
  let owner: Promise<UnifiedPluginAuthoringPort> | undefined;
  const get = () => owner ??= load().catch(cause => { owner = undefined; throw cause; });
  return {
    updateManifest: input => get().then(port => port.updateManifest(input)),
    install: input => get().then(port => port.install(input)),
    validate: input => get().then(port => port.validate(input)),
    versions: id => get().then(port => port.versions(id)),
    activate: (id, revision, authority) => get().then(port => port.activate(id, revision, authority)),
    dependencies: input => get().then(port => port.dependencies(input)),
  };
}
let installed: UnifiedPluginAuthoringPort | null = null;
export function setUnifiedPluginAuthoring(port: UnifiedPluginAuthoringPort | null) { installed = port; }
export function unifiedPluginAuthoring() { if (!installed) throw new Error("Unified plugin authoring is unavailable"); return installed; }
