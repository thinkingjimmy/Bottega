/**
 * [INPUT]: Depends on the plugin descriptor/settings contracts and Dock local defaults.
 * [OUTPUT]: Provides the official Dock descriptor and adapter field-to-preference mapping.
 * [POS]: Dock's catalog description; all values remain owned by DockLocalStore.
 */
import type { PluginDescriptor } from "@bottega/contracts/plugins/descriptor";
import type { SettingField } from "@bottega/contracts/plugins/settings";
import { DEFAULT_DOCK_LOCAL_STATE } from "../../../../shared/system-dock/local-state";

export const dockText = (key: string) => ({ key: `plugins.builtin.dock.${key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}` });
export const DOCK_FIELDS = {
  "show-handle": "showHandle", "privacy-mask": "privacyMask", scale: "scale", visibility: "visibility", "show-running": "showRunning",
} as const;
const common = (id: string) => ({ id, label: dockText(`settings.${id}`), appliesAt: "immediate" as const, owner: "adapter" as const, scope: "device" as const });
const defaults = DEFAULT_DOCK_LOCAL_STATE;
const settings: SettingField[] = [
  { ...common("show-handle"), type: "toggle", default: defaults.showHandle },
  { ...common("privacy-mask"), type: "toggle", default: defaults.privacyMask },
  { ...common("show-running"), type: "toggle", default: defaults.showRunningByMode.coexist },
  { ...common("scale"), type: "number", min: 0.75, max: 1.5, step: 0.05, default: defaults.scale },
  { ...common("visibility"), type: "select", default: defaults.visibility, options: [
    { value: "autohide", label: dockText("autohide") }, { value: "pinned", label: dockText("pinned") },
  ] },
];
export const DOCK_PLUGIN: PluginDescriptor = {
  id: "dock", kind: "feature", source: "builtin", name: dockText("name"), summary: dockText("summary"), description: dockText("description"), icon: "dock",
  provides: [], requires: [], turnOn: { mode: "setup", setup: "dock-setup" }, turnOff: { allowed: true }, settings,
  capabilities: [{ label: dockText("capabilities.launch"), id: null }, { label: dockText("capabilities.usage"), id: null },
    { label: dockText("capabilities.sync"), id: null }, { label: dockText("capabilities.permissions"), id: null }],
};
