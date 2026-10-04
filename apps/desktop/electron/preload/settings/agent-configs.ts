/**
 * [INPUT]: Depends on Electron IPC, the Agent-configuration bridge contract and the top-frame subscription adapter.
 * [OUTPUT]: Installs `window.agentConfigs` (AgentConfigBridge): list, offered-in-Project, create, update, enable, remove and a change subscription.
 * [POS]: Agent-configuration preload leaf for the main window; main validates every argument again and owns every write.
 */
import { contextBridge, ipcRenderer } from "electron";
import { AGENT_CONFIG_CHANNEL, type AgentConfigBridge } from "@ai-chat/cloud-protocol/agent-config/bridge";

export function installAgentConfigBridge(subscribe: <T>(channel: string) => (callback: (value: T) => void) => () => void) {
  const changed = subscribe<void>(AGENT_CONFIG_CHANNEL.changed);
  contextBridge.exposeInMainWorld("agentConfigs", {
    list: () => ipcRenderer.invoke(AGENT_CONFIG_CHANNEL.list),
    offeredIn: (projectId) => ipcRenderer.invoke(AGENT_CONFIG_CHANNEL.offeredIn, projectId),
    create: (payload) => ipcRenderer.invoke(AGENT_CONFIG_CHANNEL.create, payload),
    update: (configId, payload) => ipcRenderer.invoke(AGENT_CONFIG_CHANNEL.update, configId, payload),
    enable: (configId) => ipcRenderer.invoke(AGENT_CONFIG_CHANNEL.enable, configId),
    remove: (configId) => ipcRenderer.invoke(AGENT_CONFIG_CHANNEL.remove, configId),
    onChanged: (listener) => changed(() => listener()),
  } satisfies AgentConfigBridge);
}
