/**
 * [INPUT]: Depends on the process-global renderer IPC registrar, the Agent-configuration bridge channels and AgentConfigService.
 * [OUTPUT]: Provides registerAgentConfigs: the main window's `agent-configs:*` handlers (list, offered-in, create, update, enable, remove) and the `changed` push.
 * [POS]: agent-configs' renderer boundary; only the main window's top frame may call it, and every write goes through the service.
 */
import type { BrowserWindow } from "electron";
import { z } from "zod";
import { AGENT_CONFIG_CHANNEL } from "@ai-chat/cloud-protocol/agent-config/bridge";
import { rendererIpc } from "../registration/ipc-registrar";
import type { AgentConfigService } from "./service";

const id = z.string().min(1).max(128);

export function registerAgentConfigs(service: AgentConfigService, window: BrowserWindow, rendererUrl: string) {
  rendererIpc(rendererUrl, "agent configurations are available to the main window only")
    .roles("main")
    .handle(AGENT_CONFIG_CHANNEL.list, () => service.list())
    .handle(AGENT_CONFIG_CHANNEL.offeredIn, (projectId) => service.offeredIn(id.parse(projectId)))
    .handle(AGENT_CONFIG_CHANNEL.create, (payload) => service.create(payload))
    .handle(AGENT_CONFIG_CHANNEL.update, (configId, payload) => service.update(id.parse(configId), payload))
    .handle(AGENT_CONFIG_CHANNEL.enable, (configId) => service.enable(id.parse(configId)))
    .handle(AGENT_CONFIG_CHANNEL.remove, (configId) => service.remove(id.parse(configId)));
  /* One nudge per change; the renderer re-reads the list, so a burst of sync writes costs one read each, never a stale view. */
  const release = service.onChanged(() => { if (!window.isDestroyed()) window.webContents.send(AGENT_CONFIG_CHANNEL.changed); });
  window.once("closed", release);
}
