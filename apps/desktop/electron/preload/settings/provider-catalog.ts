/**
 * [INPUT]: Depends on Electron IPC, the Provider catalog channels and bridge contract (type only), and the top-frame subscription adapter.
 * [OUTPUT]: Installs `window.providerCatalog` (ProviderCatalogBridge): the current catalog snapshot and a change subscription.
 * [POS]: The Provider catalog's preload leaf for the main window (TASK-11 d4a); the renderer lists (S4) read it instead of a closed id list.
 */
import { contextBridge, ipcRenderer } from "electron";
import { PROVIDER_CATALOG_CHANNEL, type ProviderCatalogBridge, type ProviderCatalogSnapshot } from "../../../shared/providers/catalog-ipc";

export function installProviderCatalogBridge(subscribe: <T>(channel: string) => (callback: (value: T) => void) => () => void) {
  const changed = subscribe<ProviderCatalogSnapshot>(PROVIDER_CATALOG_CHANNEL.changed);
  contextBridge.exposeInMainWorld("providerCatalog", {
    snapshot: () => ipcRenderer.invoke(PROVIDER_CATALOG_CHANNEL.snapshot),
    onChanged: listener => changed(listener),
  } satisfies ProviderCatalogBridge);
}
