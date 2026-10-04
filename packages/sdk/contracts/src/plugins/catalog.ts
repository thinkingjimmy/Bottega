/**
 * [INPUT]: Depends on Zod, the plugin descriptor enums (descriptor.ts), localized text (text.ts), the settings view (settings.ts) and the
 *           disable-impact bridge (impact.ts).
 * [OUTPUT]: Provides pluginViewSchema / PluginView (one card of the plugins page), pluginDetailSchema / PluginDetail (a plugin's introduction and settings pages),
 *           PLUGIN_ERRORS and PluginsBridge: list, detail, turn on or off, settings read and submit, change subscription, disable impact.
 * [POS]: Appendix C.3. Availability is separate from the switch: `unsupported` cannot be turned on, `blocked` stays on and names what it
 *        waits for; a `setup` plugin is never turned on directly. The desktop plugin catalog builds both shapes.
 */
import { z } from "zod";
import { pluginContractSchema, BLOCK_REASONS } from "./contracts";
import { PLUGIN_KINDS, PLUGIN_SOURCES, TURN_OFF_REASONS, TURN_ON_SETUPS, pluginIdSchema } from "./descriptor";
import type { PluginImpactBridge } from "./impact";
import { pluginSettingsViewSchema, type PluginSettingsView, type SettingsPatch, type SettingsSubmitResult } from "./settings";
import { localizedTextSchema } from "./text";

const text = z.string().min(1).max(256);
export const blockedBySchema = z.array(z.object({ contract: pluginContractSchema, reason: z.enum(BLOCK_REASONS) }).strict()).max(32);
export const availabilitySchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("usable") }).strict(),
  z.object({ state: z.literal("unsupported"), reason: z.literal("platform"), detail: localizedTextSchema }).strict(),
  z.object({ state: z.literal("blocked"), blockedBy: blockedBySchema }).strict(),
]);
export type PluginAvailability = z.infer<typeof availabilitySchema>;

export const pluginViewSchema = z.object({
  id: pluginIdSchema,
  name: localizedTextSchema,
  summary: localizedTextSchema.nullable(),
  icon: z.object({ builtin: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/) }).strict().nullable(),
  kind: z.enum(PLUGIN_KINDS),
  source: z.enum(PLUGIN_SOURCES),
  official: z.boolean(),
  /** App-owned builtin: app version; editable source: active manifest version; package: packageVersion; Agent-native: null. */
  version: z.string().max(40).nullable(),
  /** The user's switch (Memory: enabled && !paused). */
  enabled: z.boolean(),
  availability: availabilitySchema,
  turnOn: z.discriminatedUnion("mode", [z.object({ mode: z.literal("direct") }).strict(),
    z.object({ mode: z.literal("setup"), setup: z.enum(TURN_ON_SETUPS) }).strict()]),
  turnOff: z.discriminatedUnion("allowed", [z.object({ allowed: z.literal(true) }).strict(),
    z.object({ allowed: z.literal(false), reason: z.enum(TURN_OFF_REASONS) }).strict()]),
  hasSettings: z.boolean(),
  /** Provider plugins: the Agent configurations that use it. */
  usedBy: z.array(text).max(64).optional(),
  /** Workflow: the Projects it is set up in. */
  workflowIn: z.array(text).max(64).optional(),
  /** Agent-native manager, and canonical source location for native or editable local plugins. */
  managedBy: z.string().max(32).optional(),
  origin: z.string().max(512).optional(),
  turnedOffAt: z.number().int().min(0).optional(),
}).strict();
export type PluginView = z.infer<typeof pluginViewSchema>;

const fact = z.object({ label: localizedTextSchema, value: localizedTextSchema, level: z.enum(["ok", "attention", "error"]).optional() }).strict();
export const pluginHealthSchema = z.object({
  level: z.enum(["ok", "attention", "error", "unknown"]),
  summary: localizedTextSchema,
  facts: z.array(fact).max(16),
  checkedAt: z.number().int().min(0).nullable(),
}).strict();
export type PluginHealth = z.infer<typeof pluginHealthSchema>;

export const pluginDetailSchema = pluginViewSchema.extend({
  /** The plugin page's introduction, or null when the plugin has none. */
  description: localizedTextSchema.nullable(),
  provides: z.array(pluginContractSchema).max(32),
  /** Resolved: each required contract with the usable plugins that satisfy it now (empty when it is not met). */
  requires: z.array(z.object({ contract: pluginContractSchema, satisfiedBy: z.array(pluginIdSchema).max(64) }).strict()).max(32),
  /** Plugins that require something this plugin provides. */
  dependents: z.array(pluginIdSchema).max(64),
  health: pluginHealthSchema,
  settings: pluginSettingsViewSchema.nullable(),
  capabilities: z.array(z.object({ label: localizedTextSchema, id: z.string().max(160).nullable() }).strict()).max(64),
  /** Built-in plugins: the page names of related settings the detail page links to. */
  related: z.array(z.enum(["providers", "agent-configs", "usage", "skills", "memory", "dock"])).max(8),
}).strict();
export type PluginDetail = z.infer<typeof pluginDetailSchema>;

/** Stable codes a refusal carries as its message. */
export const PLUGIN_ERRORS = ["plugin-not-found", "plugin-always-on", "plugin-not-switchable", "plugin-reinstall-required", "plugin-busy",
  "plugin-setup-required", "plugin-unsupported", "setting-invalid", "setting-unknown"] as const;
export type PluginError = (typeof PLUGIN_ERRORS)[number];

export interface PluginsBridge extends PluginImpactBridge {
  list(): Promise<PluginView[]>;
  detail(pluginId: string): Promise<PluginDetail>;
  /** Turning on needs no confirmation; the page confirms turning off after showing disableImpact. A `setup` plugin refuses direct turn-on. */
  setEnabled(pluginId: string, enabled: boolean): Promise<void>;
  settings(pluginId: string): Promise<PluginSettingsView>;
  /** `confirmation` answers a previous `confirm` result by its id. */
  setSettings(pluginId: string, patch: SettingsPatch, confirmation?: string): Promise<SettingsSubmitResult>;
  onChanged(listener: () => void): () => void;
}
