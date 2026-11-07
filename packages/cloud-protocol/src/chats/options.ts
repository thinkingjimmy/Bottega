/**
 * [INPUT]: Zod, the canonical SDK keyed identities and the shared portable Agent identity leaf.
 * [OUTPUT]: Provides the canonical Agent option and default-map validators, the permission-mode enum and the opaque option value schema reused by remote turns and Agent configurations, including immutable first-send mode snapshots.
 * [POS]: Shared Chat options; these portable preferences never grant local execution authority.
 */
import { z } from "zod";
import { pluginModeSelectionSchema } from "@bottega/contracts/plugins/platform/selection/mode";
import { BUILTIN_PROVIDER_IDS } from "./backend-id";
export * from "./backend-id";
export { agentBackendIdSchema } from "./identity/index";
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
export const permissionModeSchema = permissionMode;
const codexOptionsSchema = z
  .object({
    backend: z.literal(BUILTIN_PROVIDER_IDS.codex),
    model: optionValue,
    reasoningEffort: opaqueConfigValue,
    serviceTier: opaqueConfigValue,
    permissionMode,
    mode: pluginModeSelectionSchema.optional(),
  })
  .strict();
const claudeOptionsSchema = z
  .object({
    backend: z.literal(BUILTIN_PROVIDER_IDS.claude),
    model: optionValue.optional(),
    reasoningEffort: opaqueConfigValue.optional(),
    serviceTier: opaqueConfigValue.optional(),
    permissionMode,
    mode: pluginModeSelectionSchema.optional(),
  })
  .strict();
const kimiOptionsSchema = z
  .object({
    backend: z.literal(BUILTIN_PROVIDER_IDS.kimi),
    model: optionValue.optional(),
    reasoningEffort: opaqueConfigValue.optional(),
    permissionMode,
    mode: pluginModeSelectionSchema.optional(),
  })
  .strict();
// OpenCode variants may omit effort; absence delegates to the provider.
const opencodeOptionsSchema = z
  .object({
    backend: z.literal(BUILTIN_PROVIDER_IDS.opencode),
    model: optionValue.optional(),
    reasoningEffort: opaqueConfigValue.optional(),
    permissionMode,
    mode: pluginModeSelectionSchema.optional(),
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
    [BUILTIN_PROVIDER_IDS.codex]: codexOptionsSchema.optional(),
    [BUILTIN_PROVIDER_IDS.claude]: claudeOptionsSchema.optional(),
    [BUILTIN_PROVIDER_IDS.kimi]: kimiOptionsSchema.optional(),
    [BUILTIN_PROVIDER_IDS.opencode]: opencodeOptionsSchema.optional(),
  })
  .strict();
