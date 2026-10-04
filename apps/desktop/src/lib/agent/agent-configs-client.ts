/**
 * [INPUT]: Depends on the Agent-configuration bridge contract (type only).
 * [OUTPUT]: Provides agentConfigsBridge (the main window's `window.agentConfigs`, or null elsewhere) and its global typing.
 * [POS]: apps/desktop/src/lib/agent; Renderer entry to Agent configurations for the TASK-21 interface; a fake implements the same AgentConfigBridge.
 */
import type { AgentConfigBridge } from "@ai-chat/cloud-protocol/agent-config/bridge";
declare global { interface Window { agentConfigs?: AgentConfigBridge } }
export const agentConfigsBridge = (): AgentConfigBridge | null => window.agentConfigs ?? null;
