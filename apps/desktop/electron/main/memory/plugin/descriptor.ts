/**
 * [INPUT]: Depends on plugin descriptor/settings contracts and the main-only Memory backend registry.
 * [OUTPUT]: Provides memoryPluginDescriptor and memoryPluginText for the official Memory feature.
 * [POS]: Memory's plugin metadata; backend choices remain internal implementations of one feature.
 */
import type { PluginDescriptor } from "@bottega/contracts/plugins/descriptor";
import type { SettingField } from "@bottega/contracts/plugins/settings";
import { MEMORY_PROVIDER_DESCRIPTORS, DEFAULT_MEMORY_PROVIDER_ID } from "../providers/registry";

export const memoryPluginText = (name: string) => ({ key: `plugins.builtin.memory.${name}` });
const field = (id: string) => ({ id, owner: "adapter" as const, scope: "device" as const, appliesAt: "immediate" as const,
  label: memoryPluginText(`settings.${id.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}.label`) });

export const memoryPluginFields: SettingField[] = [
  { ...field("backend"), type: "select", default: DEFAULT_MEMORY_PROVIDER_ID,
    options: MEMORY_PROVIDER_DESCRIPTORS.map(provider => ({ value: provider.id, label: { text: provider.displayName } })) },
  { ...field("sharing-mode"), type: "select", default: "chat",
    options: ["chat", "group", "personal"].map(value => ({ value, label: memoryPluginText(`sharing.${value}`) })) },
  { ...field("phone-facade"), type: "toggle", default: false },
  { ...field("workflow-roles"), type: "toggle", default: false },
];

export function memoryPluginDescriptor(): PluginDescriptor {
  return {
    id: "memory", kind: "feature", source: "builtin", name: memoryPluginText("name"), summary: memoryPluginText("summary"), description: memoryPluginText("description"), icon: "memory",
    provides: ["bottega.memory/v1"], requires: [], turnOn: { mode: "direct" },
    turnOff: { allowed: true }, settings: memoryPluginFields,
    capabilities: ["recall", "capture", "backfill"].map(name => ({ label: memoryPluginText(`capability.${name}`), id: null })),
  };
}
