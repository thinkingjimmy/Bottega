/**
 * [INPUT]: Depends on canonical public option schemas and shared Agent option types
 * [OUTPUT]: Provides the exact option schema, factory defaults, and pure default resolution
 * [POS]: Shared Chat option authority; persistence remains owned by SQLite and Settings
 */

import type { AgentBackendId, AgentTurnOptions, CodexTurnOptions } from "../agent-ipc";
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
