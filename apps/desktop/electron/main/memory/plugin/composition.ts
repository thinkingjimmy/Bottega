/**
 * [INPUT]: Depends on PluginCatalog and Memory's existing settings, service and runtime change subscriptions.
 * [OUTPUT]: Provides installMemoryPlugin with one stable owner and disposable catalog subscriptions.
 * [POS]: Startup seam connecting the Memory subsystem to the plugin catalog after both have recovered.
 */
import type { PluginCatalog } from "../../plugins/catalog";
import { createMemoryPluginOwner, type MemoryPluginPorts } from "./owner";

export function installMemoryPlugin(catalog: PluginCatalog, ports: MemoryPluginPorts) {
  const owner = createMemoryPluginOwner(ports);
  const refresh = () => { void catalog.refresh().catch(cause => console.warn("[memory] plugin refresh failed", cause)); };
  const releases = [catalog.addOwnerSource(() => [owner], { reservedIds: ["memory"] }),
    ports.settings.onChanged(refresh), ports.service.onStatus(refresh), ports.runtimes.onChanged(refresh)];
  return () => { for (const release of releases.reverse()) release(); };
}
