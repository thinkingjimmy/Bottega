/**
 * [INPUT]: Depends on PluginCatalog's builtin owner port, DockService/DockSetup and the local preference validator.
 * [OUTPUT]: Provides dockPluginOwner and attachDockPlugin: single-owner switch/settings, health, effects and change notifications.
 * [POS]: Dock's plugin adapter; setup and disable retain the original lifecycle authority and stores.
 */
import { PluginError, type BuiltinOwner, type PluginCatalog } from "../../plugins/catalog";
import { dockPreferencePatchSchema } from "../../../../shared/system-dock/local-state";
import { checkSettingValue, type SettingValue } from "@bottega/contracts/plugins/settings";
import type { DockService } from "../service";
import type { DockSetup } from "../setup";
import { DOCK_FIELDS, DOCK_PLUGIN, dockText } from "./descriptor";
import { dockEffects, dockHealth } from "./health";

export function dockPluginOwner(service: DockService, setup: DockSetup): BuiltinOwner {
  const loaded = () => { if (!service.initialized) throw new Error("DOCK_NOT_READY"); };
  return {
    descriptor: DOCK_PLUGIN,
    enabled: () => service.settingsSnapshot().state.enabled,
    unsupported: () => service.capability.supported ? null : dockText(`unsupportedReason.${service.capability.reason}`),
    async setEnabled(enabled) {
      loaded();
      if (enabled) throw new PluginError("plugin-setup-required");
      await setup.disable();
    },
    health: async () => dockHealth(service.settingsSnapshot(), service.initialized),
    effects: async () => dockEffects(service.settingsSnapshot()),
    adapter: {
      async read() {
        const state = service.settingsSnapshot().state;
        return { "show-handle": state.showHandle, "privacy-mask": state.privacyMask, scale: state.scale, visibility: state.visibility,
          "show-running": state.showRunningByMode.coexist };
      },
      async submit(patch: Record<string, SettingValue>) {
        loaded();
        const entries = Object.entries(patch);
        if (entries.some(([id]) => !(id in DOCK_FIELDS))) return { status: "refused", code: "setting-unknown" };
        if (entries.some(([id, value]) => checkSettingValue(DOCK_PLUGIN.settings.find(field => field.id === id)!, value))) return { status: "refused", code: "setting-invalid" };
        const parsed = dockPreferencePatchSchema.safeParse(Object.fromEntries(entries.map(([id, value]) => [DOCK_FIELDS[id as keyof typeof DOCK_FIELDS], value])));
        if (!parsed.success) return { status: "refused", code: "setting-invalid" };
        await setup.setPreference(parsed.data);
        return { status: "applied" };
      },
    },
  };
}
export function attachDockPlugin(catalog: PluginCatalog, service: DockService, setup: DockSetup) {
  const owner = dockPluginOwner(service, setup);
  const remove = catalog.addOwnerSource(() => [owner], { reservedIds: ["dock"] });
  let previous = "";
  const release = service.onSettings(snapshot => {
    // Layout/window frames are frequent; only catalog facts need a plugin-wide refresh.
    const facts = JSON.stringify([snapshot.state, snapshot.capability, snapshot.actualMode, snapshot.phase, snapshot.suspendReason,
      snapshot.registration, snapshot.recovery, snapshot.sync, snapshot.accessibility, snapshot.automation]);
    if (facts === previous) return;
    previous = facts;
    void catalog.refresh().catch(cause => console.warn("[system-dock] plugin refresh failed", cause));
  });
  return () => { release(); remove(); };
}
