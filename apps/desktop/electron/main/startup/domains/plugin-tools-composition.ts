/**
 * [INPUT]: Depends on plugin-owned official declarations, existing domain executors, the shared HostRuntime, a live optional Library root and document owners.
 * [OUTPUT]: Composes one dynamic tool registry, channel-bound host RPC, trusted process manager and an admitted-Library official source loader; the existing builtin-tools observation payload includes its RPC broker.
 * [POS]: Production plugin tool composition after foundation hosts exist; no tool names or per-tool wiring live here.
 */
import { session } from "electron";
import { BROWSER_PARTITION } from "../../../../shared/ipc/workspace/browser-ipc";
import type { UnifiedPluginManifest } from "@bottega/contracts/plugins/platform";
import { join } from "node:path";
import { officialToolPlugins } from "../../../../shared/plugin-tools";
import { createOfficialToolExecutors, type PluginToolsetDependencies } from "../../plugins/official/executors";
import { ensureOfficialPluginSources } from "../../plugins/official/source";
import { installedPluginCatalog } from "../../plugins/catalog";
import { PluginCredentialStore } from "../../plugins/process/credentials";
import { PluginHostRpcBroker } from "../../plugins/process/rpc";
import { createPluginProcessRuntime, installPluginProcessRuntime } from "../../plugins/process/runtime";
import { AgentPluginInventory } from "../../extensions/agent-plugins/inventory";
import { PluginToolRegistry } from "../../tools/registry";
import type { HostRuntime } from "../../host/composition";
import { announceComposition } from "../boot/composition-hooks";
import type { EffectiveWorkspaceResolver } from "../../workspace/files/workspace-resolver";
import { initializeDesignDocuments } from "../../design/documents/runtime";
import { initializeArtifactWorkspace } from "../../artifacts/workspace/runtime";

export async function composePluginTools(input: {
  userData: string; libraryRoot(): string | null; hosts: HostRuntime;
  services: Omit<PluginToolsetDependencies, "agentPlugins" | "resolveEffectiveWorkspace">;
  resolveEffectiveWorkspace: EffectiveWorkspaceResolver;
  incarnationOf(chatId: string): string | undefined;
}) {
  await initializeDesignDocuments(input.userData, input.services.chatStore, input.services.chatsService, input.resolveEffectiveWorkspace);
  await initializeArtifactWorkspace(join(input.userData, "artifact-design"), (chatId, incarnationId) => {
    const metadata = input.services.chatStore.getMetadata(chatId);
    if (!metadata || metadata.incarnationId !== incarnationId) throw new Error("Original candidate Chat expired");
    return metadata.options;
  });
  const registry = new PluginToolRegistry();
  const credentials = new PluginCredentialStore(input.userData); await credentials.initialize();
  const settingsCredentials = installedPluginCatalog()?.credentialPort();
  if (settingsCredentials) credentials.attach("settings", settingsCredentials);
  const apps = input.services.appsService;
  credentials.attach("apps", {
    list: async () => (await Promise.all(apps.store.list().map(async app => Object.keys((await apps.configs.read(app.id)).values).map(key => `${app.id}/${encodeURIComponent(key)}`)))).flat(),
    read: async key => { const slash = key.indexOf("/"); if (slash < 1) throw new Error("Invalid App credential identity"); return (await apps.configs.read(key.slice(0, slash))).values[decodeURIComponent(key.slice(slash + 1))] ?? null; },
    write: async (key, secret) => { const slash = key.indexOf("/"); if (slash < 1) throw new Error("Invalid App credential identity"); const appId = key.slice(0, slash), configKey = decodeURIComponent(key.slice(slash + 1)); const value = await apps.configs.read(appId); if (secret === null) { delete value.values[configKey]; value.agentReadableKeys = value.agentReadableKeys.filter(id => id !== configKey); } else value.values[configKey] = secret; await apps.configs.write(appId, value); },
  });
  const rpc = new PluginHostRpcBroker({ hosts: input.hosts, credentials, cookies: { read: filter => session.fromPartition(BROWSER_PARTITION).cookies.get(filter) } });
  const executors = createOfficialToolExecutors({ ...input.services, agentPlugins: new AgentPluginInventory(input.userData), resolveEffectiveWorkspace: input.resolveEffectiveWorkspace });
  for (const plugin of officialToolPlugins) {
    const handlers = executors.get(plugin.id) ?? {};
    if (!plugin.hostInfrastructure) rpc.registerFeature(plugin.alias, handlers);
    else registry.registerHostPlugin(plugin.id, "official", `host_${plugin.alias}`, plugin.tools, handlers);
  }
  const processes = createPluginProcessRuntime({ hosts: input.hosts, registry, rpc });
  installPluginProcessRuntime(processes);
  const loadOfficialSources = async () => {
    const root = input.libraryRoot();
    return root ? ensureOfficialPluginSources(root) : null;
  };
  announceComposition("builtin-tools", { registry, rpc, apps: input.services.appsService, chats: input.services.chatsService,
    resolveEffectiveWorkspace: input.resolveEffectiveWorkspace, incarnationOf: input.incarnationOf });
  const hostRuntime = (manifest: UnifiedPluginManifest, revision: string) => {
    const plugin = officialToolPlugins.find(item => item.id === manifest.id && item.hostInfrastructure);
    if (!plugin) {
      if (manifest.contributions.some(item => item.kind === "tool" && item.executor.kind === "host")) throw new Error(`Host plugin executor unavailable: ${manifest.id}`);
      return { readiness: [], async activate() {}, async drain() {}, async dispose() {} };
    }
    const handlers = executors.get(plugin.id) ?? {};
    return {
      readiness: manifest.contributions.flatMap(item => item.kind === "tool" && item.executor.kind === "host" ? [{ contributionId: item.id, kind: "tool" as const, ready: true }] : []),
      async activate() { registry.unregisterPlugin(plugin.id); registry.registerHostPlugin(plugin.id, revision, manifest.providerAlias ?? `host_${plugin.alias}`, plugin.tools, handlers); },
      async drain() { registry.unregisterPlugin(plugin.id, revision); },
      async dispose() { registry.unregisterPlugin(plugin.id, revision); },
    };
  };
  return { registry, rpc, processes, credentials, loadOfficialSources, hostRuntime };
}
