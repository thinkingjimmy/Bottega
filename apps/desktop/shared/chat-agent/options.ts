/**
 * [INPUT]: Depends on Zod and shared Agent option types
 * [OUTPUT]: Provides the exact option schema, factory defaults, and pure default resolution
 * [POS]: Shared Chat option authority; persistence remains owned by SQLite and Settings
 */

import { z } from "zod";
import type { AgentBackendId, AgentTurnOptions, CodexTurnOptions } from "../agent-ipc";
import type { DefaultChatOptionsByBackend } from "../settings-ipc";

/* Opaque backend config values are never normalized: persistence must preserve
   the exact catalog value, including leading/trailing printable spaces. */
const opaqueConfigValue = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\p{Cc}\p{Cf}]{1,200}$/u);
const optionValue = opaqueConfigValue;
const permissionMode = z.enum([
  "ask-for-approval",
  "approve-for-me",
  "full-access",
]);
const codexOptionsSchema = z
  .object({
    backend: z.literal("codex"),
    model: optionValue,
    reasoningEffort: opaqueConfigValue,
    serviceTier: opaqueConfigValue,
    permissionMode,
  })
  .strict();
const claudeOptionsSchema = z
  .object({
    backend: z.literal("claude"),
    model: optionValue.optional(),
    reasoningEffort: opaqueConfigValue.optional(),
    serviceTier: opaqueConfigValue.optional(),
    permissionMode,
  })
  .strict();
const kimiOptionsSchema = z
  .object({
    backend: z.literal("kimi"),
    model: optionValue.optional(),
    reasoningEffort: opaqueConfigValue.optional(),
    permissionMode,
  })
  .strict();
/* OpenCode 的 effort 随模型 variants 浮动：无 variants 的模型在 wire 上
   没有 effort 配置项，故字段可选——缺省即交回 CLI 自己决定。 */
const opencodeOptionsSchema = z
  .object({
    backend: z.literal("opencode"),
    model: optionValue.optional(),
    reasoningEffort: opaqueConfigValue.optional(),
    permissionMode,
  })
  .strict();
export const turnOptionsSchema = z.discriminatedUnion("backend", [
  codexOptionsSchema,
  claudeOptionsSchema,
  kimiOptionsSchema,
  opencodeOptionsSchema,
]);
export const defaultsSchema = z
  .object({
    codex: codexOptionsSchema.optional(),
    claude: claudeOptionsSchema.optional(),
    kimi: kimiOptionsSchema.optional(),
    opencode: opencodeOptionsSchema.optional(),
  })
  .strict();
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
