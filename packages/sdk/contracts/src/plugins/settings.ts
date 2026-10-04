/**
 * [INPUT]: Depends on Zod and the localized-text shape (text.ts).
 * [OUTPUT]: Provides the declarative plugin settings contract: SETTINGS_LIMITS, SETTING_APPLIES_AT, settingFieldSchema / settingFieldsSchema
 *           (toggle, select, number, text, secret), settingValueSchema, settingsPatchSchema, checkSettingValue, pluginSettingsViewSchema,
 *           settingsSubmitResultSchema and the SettingsAdapter interface an existing owner (Memory, Dock) implements.
 * [POS]: One schema for built-in descriptors and host-package manifests (appendix C.5). Only values a user changed are stored; a value equal
 *        to its default sends no override. Numeric defaults and submitted values share step validation. Secrets never reach the renderer:
 *        the view carries `{ secret: "set" | "unset" }`.
 */
import { z } from "zod";
import { localizedTextSchema, type LocalizedText } from "./text";

export const SETTINGS_LIMITS = Object.freeze({ fields: 32, options: 32, textChars: 1_024, secretChars: 4_096 });
/** `immediate` is saved and live at once; the other three are the Provider descriptor's APPLIES_AT. */
export const SETTING_APPLIES_AT = ["immediate", "next-turn", "session-create", "process-start"] as const;
export type SettingAppliesAt = (typeof SETTING_APPLIES_AT)[number];

export const settingIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const base = {
  id: settingIdSchema,
  label: localizedTextSchema,
  description: localizedTextSchema.optional(),
  appliesAt: z.enum(SETTING_APPLIES_AT),
  /** `adapter`: the value already has an owner (Memory, Dock); it is read and written only through that owner, never stored here. */
  owner: z.enum(["store", "adapter"]),
  /** 0.2.0 keeps every value on this device. */
  scope: z.literal("device"),
};
const option = z.object({ value: z.string().min(1).max(64), label: localizedTextSchema }).strict();
const onNumberStep = (min: number, step: number, value: number) => {
  const steps = (value - min) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
};
export const settingFieldSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("toggle"), default: z.boolean() }).strict(),
  z.object({ ...base, type: z.literal("select"), options: z.array(option).min(1).max(SETTINGS_LIMITS.options), default: z.string() }).strict()
    .refine(field => field.options.some(item => item.value === field.default), "select-default-not-an-option")
    .refine(field => new Set(field.options.map(item => item.value)).size === field.options.length, "select-options-duplicate"),
  z.object({ ...base, type: z.literal("number"), min: z.number().finite(), max: z.number().finite(), step: z.number().finite().positive(),
    default: z.number().finite() }).strict()
    .refine(field => field.min <= field.max && field.default >= field.min && field.default <= field.max, "number-default-out-of-range")
    .refine(field => onNumberStep(field.min, field.step, field.default), "number-default-off-step"),
  z.object({ ...base, type: z.literal("text"), maxLength: z.number().int().min(1).max(SETTINGS_LIMITS.textChars), default: z.string() }).strict()
    .refine(field => field.default.length <= field.maxLength, "text-default-too-long"),
  z.object({ ...base, type: z.literal("secret") }).strict(),
]);
export type SettingField = z.infer<typeof settingFieldSchema>;
export const settingFieldsSchema = z.array(settingFieldSchema).max(SETTINGS_LIMITS.fields)
  .refine(fields => new Set(fields.map(field => field.id)).size === fields.length, "setting-id-duplicate");

export const settingValueSchema = z.union([z.boolean(), z.string().max(SETTINGS_LIMITS.secretChars), z.number().finite()]);
export type SettingValue = z.infer<typeof settingValueSchema>;
/** A submitted change: `null` clears a value (back to its default; for a secret, removes it). */
export const settingsPatchSchema = z.record(settingIdSchema, settingValueSchema.nullable())
  .refine(patch => Object.keys(patch).length > 0 && Object.keys(patch).length <= SETTINGS_LIMITS.fields, "setting-patch-size");
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** The refusal code a value earns against its field, or null when it fits. A number must also land on a step from `min`. */
export function checkSettingValue(field: SettingField, value: SettingValue): "setting-invalid" | null {
  switch (field.type) {
    case "toggle": return typeof value === "boolean" ? null : "setting-invalid";
    case "select": return typeof value === "string" && field.options.some(item => item.value === value) ? null : "setting-invalid";
    case "text": return typeof value === "string" && value.length <= field.maxLength ? null : "setting-invalid";
    case "secret": return typeof value === "string" && value.length > 0 && value.length <= SETTINGS_LIMITS.secretChars ? null : "setting-invalid";
    case "number": {
      if (typeof value !== "number" || value < field.min || value > field.max) return "setting-invalid";
      return onNumberStep(field.min, field.step, value) ? null : "setting-invalid";
    }
  }
}

export const pluginSettingsViewSchema = z.object({
  fields: settingFieldsSchema,
  /** Current values, defaults filled in; a secret shows only whether it is set. */
  values: z.record(settingIdSchema, z.union([settingValueSchema, z.object({ secret: z.enum(["set", "unset"]) }).strict()])),
  /** The ids whose value differs from its default (what "Changed · Reset" marks). */
  changed: z.array(settingIdSchema).max(SETTINGS_LIMITS.fields),
  /** A `process-start` field changed and the plugin has not restarted yet. */
  pendingRestart: z.boolean(),
}).strict();
export type PluginSettingsView = z.infer<typeof pluginSettingsViewSchema>;

const confirmation = z.object({ id: z.string().min(1).max(128), title: localizedTextSchema, body: localizedTextSchema, danger: z.boolean() }).strict();
export const settingsSubmitResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("applied"), view: pluginSettingsViewSchema }).strict(),
  z.object({ status: z.literal("confirm"), confirmation }).strict(),
  z.object({ status: z.literal("refused"), code: z.string().min(1).max(80) }).strict(),
]);
export type SettingsSubmitResult = z.infer<typeof settingsSubmitResultSchema>;

/** An owner that already holds the values (Memory's MemorySettingsOwner, Dock's DockLocalStore). Consent flows run through `confirm`. */
export interface SettingsAdapter {
  read(): Promise<Record<string, SettingValue>>;
  submit(patch: Record<string, SettingValue>, confirmation?: string): Promise<
    | { status: "applied" }
    | { status: "confirm"; confirmation: { id: string; title: LocalizedText; body: LocalizedText; danger: boolean } }
    | { status: "refused"; code: string }>;
}
