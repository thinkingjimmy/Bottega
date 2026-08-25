/**
 * [INPUT]: Depends on Codex/Claude/Kimi/OpenCode descriptor with shared fixed display order
 * [OUTPUT]: Provides back-end registry, list in order, strictly search with the only runtimeRegistry
 * [POS]: The only registered centre for backends; The new back end is installed only once
 */

import {
  AGENT_BACKEND_ORDER,
  type AgentBackendId,
} from "../../../shared/agent-ipc";
import { claudeBackend } from "./claude";
import { codexBackend } from "./codex";
import { kimiBackend } from "./kimi";
import { opencodeBackend } from "./opencode";
import type { BackendDescriptor } from "./types";
import { BackendRuntimeRegistry } from "./runtime-registry";

export const backendRegistry = new Map<AgentBackendId, BackendDescriptor>([
  ["codex", codexBackend],
  ["claude", claudeBackend],
  ["kimi", kimiBackend],
  ["opencode", opencodeBackend],
]);

export const orderedBackends = () =>
  AGENT_BACKEND_ORDER.map((id) => backendRegistry.get(id)).filter(
    (value): value is BackendDescriptor => Boolean(value)
  );

export function backendById(id: AgentBackendId) {
  const backend = backendRegistry.get(id);
  if (!backend) throw new Error(`未知的 Agent 后端：${id}`);
  return backend;
}

export const backendRuntimeRegistry = new BackendRuntimeRegistry({
  descriptorFor: backendById,
});
