/**
 * [INPUT]: No runtime dependencies.
 * [OUTPUT]: AGENT_BACKEND_ORDER, AgentBackendId and isBuiltinAgentId.
 * [POS]: Closed built-in identity for narrow consumers; package Provider IDs use the open grammar.
 */
export const AGENT_BACKEND_ORDER = ["codex", "claude", "kimi", "opencode"] as const;
export type AgentBackendId = (typeof AGENT_BACKEND_ORDER)[number];
export function isBuiltinAgentId(value: unknown): value is AgentBackendId {
  return typeof value === "string" && (AGENT_BACKEND_ORDER as readonly string[]).includes(value);
}
