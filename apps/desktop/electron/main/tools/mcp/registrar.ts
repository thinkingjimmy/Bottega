/**
 * [INPUT]: Depends on BrowserWindow, rendererIpc, and the global manual MCP store and IPC contract
 * [OUTPUT]: Provides main-window global MCP listing, revision-fenced mutations, support projection, and change events
 * [POS]: Renderer authority for global manual MCP settings
 */

import type { BrowserWindow } from "electron";
import {
  MCP_SERVERS_CHANNEL,
  type ManualMcpServerView,
  type McpServersChangedEvent,
  type McpServersSnapshot,
  type RemoveManualMcpServerInput,
  type SaveManualMcpServerInput,
} from "../../../../shared/ipc/settings/mcp-servers-ipc";
import { rendererIpc } from "../../registration/ipc-registrar";
import { assertManualMcpScope, type ManualMcpServersStore } from "./store";

type ManualViewProjection = (
  servers: readonly ManualMcpServerView[]
) => readonly ManualMcpServerView[];

export function registerManualMcpServers(
  window: BrowserWindow,
  rendererUrl: string,
  store: ManualMcpServersStore,
  manualViewProjection: ManualViewProjection = (servers) => servers
) {
  const project = (snapshot: McpServersSnapshot): McpServersSnapshot => ({
    ...snapshot,
    servers: manualViewProjection(snapshot.servers),
  });

  const publish = (event?: McpServersChangedEvent) => {
    if (window.isDestroyed()) return;
    if (event) {
      window.webContents.send(MCP_SERVERS_CHANNEL.changed, event);
      return;
    }
    const snapshot = store.snapshot();
    window.webContents.send(MCP_SERVERS_CHANNEL.changed, {
      version: {
        scope: snapshot.queryScope,
        projectLifecycleRevision: null,
        scopeRevision: snapshot.globalScopeRevision,
      },
      storeRevision: snapshot.storeRevision,
    } satisfies McpServersChangedEvent);
  };
  window.once("closed", store.onChanged(publish));

  rendererIpc(rendererUrl, "拒绝非主窗口的 MCP server 请求")
    .roles("main")
    .handle(MCP_SERVERS_CHANNEL.list, (raw) => {
      if (raw !== undefined) {
        assertManualMcpScope((raw as { scope?: unknown } | null)?.scope);
      }
      return project(store.snapshot());
    })
    .handle(MCP_SERVERS_CHANNEL.save, async (raw) =>
      project(await store.save(raw as SaveManualMcpServerInput))
    )
    .handle(MCP_SERVERS_CHANNEL.remove, async (raw) =>
      project(await store.remove(raw as RemoveManualMcpServerInput))
    );
  return publish;
}
