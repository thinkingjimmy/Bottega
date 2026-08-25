/**
 * [INPUT]: Depends on preload Exposed window.MCPServers and shared masked MCP DTO
 * [OUTPUT]: Provides list/save/remove/changed renderer thin packaging and bridge capability checks
 * [POS]: The renderer's manual MCP server is the only input; View does not directly access windows, nor does it read secret text API
 */

import type {
  McpServersBridgeApi,
  RemoveManualMcpServerInput,
  SaveManualMcpServerInput,
} from "../../shared/mcp-servers-ipc";

declare global {
  interface Window {
    mcpServers?: McpServersBridgeApi;
  }
}

export const hasMcpServersBridge = () => Boolean(window.mcpServers);

function bridge() {
  if (!window.mcpServers) throw new Error("当前环境不支持 MCP server 管理");
  return window.mcpServers;
}

export const listManualMcpServers = () => bridge().list();
export const saveManualMcpServer = (input: SaveManualMcpServerInput) =>
  bridge().save(input);
export const removeManualMcpServer = (input: RemoveManualMcpServerInput) =>
  bridge().remove(input);
export const onManualMcpServersChanged = (
  listener: Parameters<McpServersBridgeApi["onChanged"]>[0]
) => window.mcpServers?.onChanged(listener) ?? (() => {});
