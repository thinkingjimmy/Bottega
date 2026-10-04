/**
 * [INPUT]: Depends on the provider catalog (order and each descriptor's plugin mode), the providers' plugin hooks (claude.ts, kimi.ts), and the product Extension inventory
 * [OUTPUT]: Provides ProviderPluginHooks and AgentPluginInventory: the per-provider inventory snapshot in catalog order, per-plugin enable/disable, disabled plugin ids and the frozen backend session config, each only where the provider's hooks provide it
 * [POS]: Extensions' Agent plugin boundary (provider-catalog.md, S2b area 4): generic callers ask whether a provider has a hook, never which provider it is. A provider without an inventory hook is shown from its descriptor's plugin mode: managed means the product's own plugin packages, blocked means policy-only status
 */
import type { AgentBackendId } from "../../../../shared/ipc/agent/agent-ipc";
import type { AgentPluginBackendView, AgentPluginInventoryEntry, ExtensionInventorySnapshot } from "../../../../shared/ipc/settings/extensions-ipc";
import { providerCatalog } from "../../providers/host/catalog";
import type { BackendTurnOptions } from "../../backends/types";
import { claudePlugins, type ClaudePluginOptions } from "./claude";
import { kimiPlugins, type KimiPluginOptions } from "./kimi";
import { byPluginId } from "./support";

type SessionConfig = BackendTurnOptions["backendSessionConfig"];
/** What a provider's own plugin code offers the host. Absent members mean the provider has none of it. */
export type ProviderPluginHooks = Readonly<{
  inventory(): Promise<AgentPluginBackendView>;
  /** Turns one plugin on or off in the product's overlay (never in the CLI's own files). */
  setEnabled?(pluginId: string, enabled: boolean): Promise<void>;
  disabledIds?(): Promise<readonly string[]>;
  /** The provider-private session config frozen just before spawn (e.g. projected plugin paths). */
  sessionConfig?(inventory: ExtensionInventorySnapshot): Promise<SessionConfig>;
}>;

export class AgentPluginInventory {
  private readonly hooks: Readonly<Record<string, ProviderPluginHooks>>;

  constructor(userData: string, options: ClaudePluginOptions & KimiPluginOptions = {}) {
    this.hooks = { claude: claudePlugins(userData, options), kimi: kimiPlugins(userData, options) };
  }

  private hooksOf(backendId: string) {
    return Object.hasOwn(this.hooks, backendId) ? this.hooks[backendId] : undefined;
  }

  async snapshot(inventory: ExtensionInventorySnapshot): Promise<readonly AgentPluginBackendView[]> {
    return Promise.all(providerCatalog().catalog().entries().flatMap(({ id, descriptor }): Promise<AgentPluginBackendView>[] => {
      const hooks = this.hooksOf(id);
      if (hooks) return [hooks.inventory()];
      if (descriptor.plugins?.mode === "managed") {
        return [Promise.resolve({ backendId: id, policy: "managed", inventoryState: "ready", plugins: productPlugins(inventory) } as AgentPluginBackendView)];
      }
      if (descriptor.plugins?.mode === "blocked") {
        return [Promise.resolve({ backendId: id, policy: "blocked", reason: "arbitrary-code-outside-product-fence",
          unlock: "safe-inventory-oracle-and-fenced-execution" } as AgentPluginBackendView)];
      }
      return [];
    }));
  }

  /** Refused for a provider whose plugin code cannot toggle one plugin in the product. */
  async setEnabled(backendId: string, pluginId: string, enabled: boolean) {
    const setEnabled = this.hooksOf(backendId)?.setEnabled;
    if (!setEnabled) throw new Error(`${backendId} 不支持产品内逐项启停`);
    await setEnabled(pluginId, enabled);
  }

  async disabledPluginIds(backendId: AgentBackendId): Promise<readonly string[]> {
    return (await this.hooksOf(backendId)?.disabledIds?.()) ?? [];
  }

  /* The Extension inventory is read only for a provider whose hooks freeze a session config: reading it for every turn would reach
     a store startup recovery may still hold, where no provider without plugins ever went. */
  async sessionConfig(backendId: AgentBackendId, inventory: () => ExtensionInventorySnapshot): Promise<SessionConfig> {
    const sessionConfig = this.hooksOf(backendId)?.sessionConfig;
    return sessionConfig ? sessionConfig(inventory()) : undefined;
  }
}

function productPlugins(inventory: ExtensionInventorySnapshot): readonly AgentPluginInventoryEntry[] {
  return inventory.packages.flatMap((owner) => {
    const generation = owner.generations.find((item) => item.packageGenerationId === owner.activeGenerationRef?.packageGenerationId);
    if (!generation?.admissionEvidence.adapterId.startsWith("agent-plugins-")) return [];
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
