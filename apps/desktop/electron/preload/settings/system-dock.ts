/**
 * [INPUT]: Depends on Electron IPC, the Settings → Dock channel contract, and the top-frame subscription adapter.
 * [OUTPUT]: Installs the fixed Main-only Dock commands through one exact argument-forwarding adapter and three independent subscriptions, including private preview snapshots.
 * [POS]: Settings preload leaf beside bridge.ts; the composition root only calls it for the main window on macOS, so other platforms never show a Dock page.
 */
import { contextBridge, ipcRenderer } from "electron";
import { SYSTEM_DOCK_SETTINGS_CHANNEL as CHANNEL } from "../../../shared/ipc-channels/window";
import { type DockSettingsSnapshot, type SystemDockSettingsBridge } from "../../../shared/system-dock/ipc";

export function installSystemDockSettingsBridge(subscribe: <T>(channel: string) => (callback: (value: T) => void) => () => void) {
  const {changed,widgetsChanged,widgetPreviewChanged,...methods}=CHANNEL;
  const bridge=Object.fromEntries(Object.entries(methods).map(([method,channel])=>[method,(...args:unknown[])=>ipcRenderer.invoke(channel,...args)])) as Omit<SystemDockSettingsBridge,'onChanged'|'onWidgetsChanged'|'onWidgetPreviewChanged'>;
  contextBridge.exposeInMainWorld("systemDockSettings",{
    ...bridge,
    onChanged:subscribe<DockSettingsSnapshot>(changed),
    onWidgetsChanged:subscribe<void>(widgetsChanged),
    onWidgetPreviewChanged:subscribe<import('../../../shared/system-dock/widgets/preview/contracts').WidgetPreviewSnapshot>(widgetPreviewChanged),
  } satisfies SystemDockSettingsBridge);
}
