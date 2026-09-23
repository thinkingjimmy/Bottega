/**
 * [INPUT]: Depends on canonical public option schemas and shared Agent option types
 * [OUTPUT]: Provides the exact option schema, factory defaults, pure default resolution, and the user provider-order normalizer
 * [POS]: Shared Chat option authority; persistence remains owned by SQLite and Settings
 */

import { AGENT_BACKEND_ORDER, type AgentBackendId, type AgentTurnOptions, type CodexTurnOptions } from "../agent-ipc";
import type { DefaultChatOptionsByBackend } from "../settings-ipc";

export { turnOptionsSchema, defaultsSchema } from "@ai-chat/cloud-protocol/chats/options";
import { turnOptionsSchema } from "@ai-chat/cloud-protocol/chats/options";

export const DEFAULT_CHAT_OPTIONS: CodexTurnOptions = {
  backend: "codex",
  model: "gpt-5.6-sol",
  reasoningEffort: "xhigh",
  serviceTier: "priority",
  permissionMode: "approve-for-me",
};
export const DEFAULT_CHAT_OPTIONS_BY_BACKEND: DefaultChatOptionsByBackend = {
  codex: DEFAULT_CHAT_OPTIONS,
  claude: { backend: "claude", permissionMode: "ask-for-approval" },
  kimi: { backend: "kimi", permissionMode: "ask-for-approval" },
  opencode: { backend: "opencode", permissionMode: "ask-for-approval" },
};

export function backendDefaults(defaults: DefaultChatOptionsByBackend, backend: AgentBackendId): AgentTurnOptions {
  return structuredClone(turnOptionsSchema.parse(defaults[backend] ?? DEFAULT_CHAT_OPTIONS_BY_BACKEND[backend]));
}

/** The user's picker order: persisted ids first (deduplicated), then any backend the file predates. */
export function normalizeProviderOrder(order: readonly AgentBackendId[]): AgentBackendId[] {
  const known = new Set<AgentBackendId>();
  for (const id of order) if (AGENT_BACKEND_ORDER.includes(id)) known.add(id);
  for (const id of AGENT_BACKEND_ORDER) known.add(id);
  return [...known];
}
