/**
 * [INPUT]: Depends on the plugin owner contract, immutable platform support, and existing Memory settings, consent and runtime owners.
 * [OUTPUT]: Provides createMemoryPluginOwner and memoryDisableEffects for one official built-in Memory feature.
 * [POS]: Memory's plugin boundary; availability preserves service preferences, data and independently authorized rebuilds.
 */
import type { BuiltinOwner } from "../../plugins/catalog";
import type { PluginDisableImpact } from "@bottega/contracts/plugins/impact";
import type { PlatformCapabilities } from "../../../../shared/platform/platform-capabilities";
import type { ManagedRuntimeRegistry } from "../runtime/managed-registry";
import { createMemorySettingsAdapter, type MemorySettingsAdapterPorts } from "./settings-adapter";
import { memoryPluginDescriptor, memoryPluginText } from "./descriptor";
import { memoryPluginHealth } from "./health";

export type MemoryPluginPorts = MemorySettingsAdapterPorts & { runtimes: ManagedRuntimeRegistry; platformSupport: PlatformCapabilities };

export function memoryDisableEffects(): PluginDisableImpact["effects"]["items"] {
  return ["recall", "capture", "backfill", "phone", "rebuild"].map(name => ({
    kind: name === "rebuild" ? "memory-rebuild-continues" : `memory-${name}-paused`, count: 1,
    label: memoryPluginText(`effects.${name}`),
  })) as PluginDisableImpact["effects"]["items"];
}

export function createMemoryPluginOwner(ports: MemoryPluginPorts): BuiltinOwner {
  const supported = () => ports.platformSupport.capabilities.memory;
  return {
    descriptor: memoryPluginDescriptor(),
    enabled: () => ports.settings.get().memory.pluginEnabled,
    unsupported: () => supported() ? null : memoryPluginText("health.unsupported"),
    async setEnabled(enabled) {
      if (enabled && !supported()) throw new Error("plugin-unsupported");
      await ports.settingsOwner.setPluginEnabled(enabled);
    },
    adapter: createMemorySettingsAdapter(ports),
    health: () => memoryPluginHealth(ports),
    effects: async () => memoryDisableEffects(),
  };
}
