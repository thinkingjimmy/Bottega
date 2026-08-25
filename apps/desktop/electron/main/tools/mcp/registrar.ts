/**
 * [INPUT]: Depends on BrowserWindow, rendererIpc, shared MCP channel, ManualMcpServersStore, manual health and package MCP masked/view Projection
 * [OUTPUT]: Provides register ManualMcpServers: list/save/remove Three receiving IPCs, authoritative manual + package health Views broadcast and external refresh input
 * [POS]: The renderer boundary of tools/mcp; The handler is only synthesized as a masked/view DTO, resolved message no export
 */

import type { BrowserWindow } from "electron";
import {
  MCP_SERVERS_CHANNEL,
  type ManualMcpServerView,
  type PackageMcpServerView,
} from "../../../../shared/mcp-servers-ipc";
import { rendererIpc } from "../../ipc-registrar";
import type { ManualMcpServersStore } from "./store";

export function registerManualMcpServers(
  window: BrowserWindow,
  rendererUrl: string,
  store: ManualMcpServersStore,
  packageProjection: () => Readonly<{
    inventoryRevision: string;
    servers: readonly PackageMcpServerView[];
  }> = () => ({ inventoryRevision: "0", servers: [] }),
  manualHealthProjection: (
    servers: readonly ManualMcpServerView[]
  ) => readonly ManualMcpServerView[] = (servers) => servers
) {
  const project = () => {
    const manual = store.project();
    const manualServers = manual.servers.filter(
      (server): server is ManualMcpServerView => server.source === "manual"
    );
    const packages = packageProjection();
    return {
      ...manual,
      inventoryRevision: packages.inventoryRevision,
      servers: [...manualHealthProjection(manualServers), ...packages.servers],
    };
  };
  const publish = () => {
    if (!window.isDestroyed()) {
      window.webContents.send(MCP_SERVERS_CHANNEL.changed, project());
    }
  };
  const stop = store.onChanged(publish);
  window.once("closed", stop);
  rendererIpc(window, rendererUrl, "拒绝非主窗口的 MCP server 请求")
    .handle(MCP_SERVERS_CHANNEL.list, project)
    .handle(MCP_SERVERS_CHANNEL.save, async (input) => {
      await store.save(input as never);
      return project();
    })
    .handle(MCP_SERVERS_CHANNEL.remove, async (input) => {
      await store.remove(input as never);
      return project();
    });
  return publish;
}
