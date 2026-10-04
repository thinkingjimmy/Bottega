/**
 * [INPUT]: Depends on renderer IPC, plugin channels and settings validation, the catalog's owner effects and computeDisableImpact.
 * [OUTPUT]: Provides registerPlugins: the main window's `plugins:*` handlers (list, detail, set-enabled, disable-impact, settings, set-settings) and the `changed` push.
 * [POS]: plugins' renderer boundary (I9): only the main window's top frame may call it; refusals carry the contract's stable codes. Secrets
 *        cross only inward (a submitted value); what goes back is the settings view, where a secret is only set or unset.
 */
import type { BrowserWindow } from "electron";
import { z } from "zod";
import { PLUGINS_CHANNEL } from "@ai-chat/cloud-protocol/contracts/plugins/channel";
import { settingsPatchSchema } from "@ai-chat/cloud-protocol/contracts/plugins/settings";
import { rendererIpc } from "../registration/ipc-registrar";
import { computeDisableImpact, type ImpactPorts } from "../extensions/host/impact";
import type { PluginCatalog } from "./catalog";

const pluginId = z.string().min(1).max(160);
const confirmation = z.string().min(1).max(128).optional();

export function registerPlugins(catalog: PluginCatalog, impact: Omit<ImpactPorts, "providersOf" | "dependents">, window: BrowserWindow, rendererUrl: string) {
  rendererIpc(rendererUrl, "plugins are available to the main window only")
    .roles("main")
    .handle(PLUGINS_CHANNEL.list, () => catalog.list())
    .handle(PLUGINS_CHANNEL.detail, (id) => catalog.detail(pluginId.parse(id)))
    .handle(PLUGINS_CHANNEL.setEnabled, (id, enabled) => catalog.setEnabled(pluginId.parse(id), z.boolean().parse(enabled)))
    .handle(PLUGINS_CHANNEL.disableImpact, (id) => computeDisableImpact(pluginId.parse(id), { ...impact,
      providersOf: plugin => catalog.providersOf(plugin), dependents: plugin => catalog.dependentsOf(plugin),
      effects: async plugin => [...await catalog.effectsOf(plugin), ...(await impact.effects?.(plugin) ?? [])] }))
    .handle(PLUGINS_CHANNEL.settings, (id) => catalog.settings(pluginId.parse(id)))
    .handle(PLUGINS_CHANNEL.setSettings, (id, patch, answer) => catalog.setSettings(pluginId.parse(id), settingsPatchSchema.parse(patch), confirmation.parse(answer)));
  const release = catalog.onChanged(() => { if (!window.isDestroyed()) window.webContents.send(PLUGINS_CHANNEL.changed); });
  window.once("closed", release);
}
