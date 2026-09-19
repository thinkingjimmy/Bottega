/**
 * [INPUT]: Depends on Zod and the public backend identity tuple.
 * [OUTPUT]: Provides the canonical Agent option and default-map validators plus the opaque option value schema reused by remote turns.
 * [POS]: Shared Chat options; these portable preferences never grant local execution authority.
 */
import { z } from "zod";
export const AGENT_BACKEND_ORDER = ["codex", "claude", "kimi", "opencode"] as const;
export const agentBackendIdSchema = z.enum(AGENT_BACKEND_ORDER);
/* Opaque backend config values are never normalized: persistence must preserve
   the exact catalog value, including leading/trailing printable spaces. */
const opaqueConfigValue = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\p{Cc}\p{Cf}]{1,200}$/u);
const optionValue = opaqueConfigValue;
/* Remote turns carry a model choice with the same opaque catalog values a chat stores. */
export const turnOptionValueSchema = opaqueConfigValue;
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
// OpenCode variants may omit effort; absence delegates to the provider.
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
