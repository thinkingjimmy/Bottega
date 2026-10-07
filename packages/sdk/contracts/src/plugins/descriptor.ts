/**
 * [INPUT]: Canonical SDK built-in Provider identities; Depends on Zod, the contract grammar (contracts.ts), localized text (text.ts) and the settings fields (settings.ts).
 * [OUTPUT]: Provides PLUGIN_KINDS, PLUGIN_SOURCES, TURN_ON_SETUPS, TURN_OFF_REASONS, pluginDescriptorSchema / PluginDescriptor, nativePluginId,
 *           BUILTIN_PLUGINS (Base, Workflow and the four built-in Providers with their introductions, and the first batch of Claude and Codex settings) builtinPlugin and the reserved builtin identity policy.
 * [POS]: Appendix C.1: one descriptor for every plugin (built-in feature, built-in Provider, host package, Agent-native). Memory, Tunnel,
 *        Dock and Sketch join BUILTIN_PLUGINS from their own documents. Defaults equal today's behaviour, so an untouched setting sends nothing.
 */
import { BUILTIN_PROVIDER_IDS } from "../model/provider-capabilities";
import { z } from "zod";
import { AGENT_PROVIDER_CONTRACT, BASE_CONTRACT, pluginContractSchema } from "./contracts";
import { settingFieldsSchema, type SettingField } from "./settings";
import { localizedTextSchema } from "./text";

export const PLUGIN_KINDS = ["feature", "provider"] as const;
export const PLUGIN_SOURCES = ["builtin", "package", "agent-native"] as const;
export const TURN_ON_SETUPS = ["dock-setup"] as const;
export const TURN_OFF_REASONS = ["always-on", "managed-by-agent", "project-scoped"] as const;
export type PluginKind = (typeof PLUGIN_KINDS)[number];
export type PluginSource = (typeof PLUGIN_SOURCES)[number];

export const pluginIdSchema = z.string().min(1).max(160);
export const pluginDescriptorSchema = z.object({
  id: pluginIdSchema,
  kind: z.enum(PLUGIN_KINDS),
  source: z.enum(PLUGIN_SOURCES),
  name: localizedTextSchema,
  summary: localizedTextSchema.nullable(),
  /** The longer introduction on the plugin's page; paragraphs are separated by a blank line. */
  description: localizedTextSchema.nullable().optional(),
  /** A built-in icon name: base, workflow, memory, tunnel, dock, sketch or a Provider id. */
  icon: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/).nullable(),
  provides: z.array(pluginContractSchema).max(32),
  requires: z.array(pluginContractSchema).max(32),
  turnOn: z.discriminatedUnion("mode", [z.object({ mode: z.literal("direct") }).strict(),
    z.object({ mode: z.literal("setup"), setup: z.enum(TURN_ON_SETUPS) }).strict()]),
  turnOff: z.discriminatedUnion("allowed", [z.object({ allowed: z.literal(true) }).strict(),
    z.object({ allowed: z.literal(false), reason: z.enum(TURN_OFF_REASONS) }).strict()]),
  settings: settingFieldsSchema,
  /** What the plugin may do, shown on its detail page: a copy key or a manifest's requested capability, with its id. */
  capabilities: z.array(z.object({ label: localizedTextSchema, id: z.string().max(160).nullable() }).strict()).max(64),
}).strict();
export type PluginDescriptor = z.infer<typeof pluginDescriptorSchema>;

export const nativePluginId = (backend: string, id: string) => `native:${backend}:${id}`;

const copy = (key: string) => ({ key });
const toggle = (plugin: string, id: string, appliesAt: SettingField["appliesAt"], value: boolean): SettingField => ({
  id, type: "toggle", default: value, appliesAt, owner: "store", scope: "device",
  label: copy(`plugins.builtin.${plugin}.settings.${camel(id)}.label`), description: copy(`plugins.builtin.${plugin}.settings.${camel(id)}.description`),
});
const camel = (id: string) => id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const provider = (id: string, settings: SettingField[] = []): PluginDescriptor => ({
  id, kind: "provider", source: "builtin", name: copy(`plugins.builtin.${id}.name`), summary: copy(`plugins.builtin.${id}.summary`),
  description: copy(`plugins.builtin.${id}.description`), icon: id,
  provides: [AGENT_PROVIDER_CONTRACT], requires: [], turnOn: { mode: "direct" }, turnOff: { allowed: true }, settings,
  capabilities: [{ label: copy("plugins.capability.startProcess"), id: null }, { label: copy("plugins.capability.projectFiles"), id: null },
    { label: copy("plugins.capability.network"), id: null }],
});

/** Built-in plugins in page order. Ids are the ones plugin-states.json already uses. */
export const BUILTIN_PLUGINS: readonly PluginDescriptor[] = Object.freeze([
  { id: "base", kind: "feature", source: "builtin", name: copy("plugins.builtin.base.name"), summary: copy("plugins.builtin.base.summary"),
    description: copy("plugins.builtin.base.description"), icon: "base",
    provides: [BASE_CONTRACT], requires: [], turnOn: { mode: "direct" }, turnOff: { allowed: false, reason: "always-on" }, settings: [],
    capabilities: [{ label: copy("plugins.capability.baseStore"), id: null }, { label: copy("plugins.capability.baseTools"), id: null }] },
  { id: "workflow", kind: "feature", source: "builtin", name: copy("plugins.builtin.workflow.name"), summary: copy("plugins.builtin.workflow.summary"),
    description: copy("plugins.builtin.workflow.description"),
    icon: "workflow", provides: [], requires: [BASE_CONTRACT, AGENT_PROVIDER_CONTRACT], turnOn: { mode: "direct" }, turnOff: { allowed: true }, settings: [],
    capabilities: [{ label: copy("plugins.capability.workflowColumns"), id: null }, { label: copy("plugins.capability.workflowRoles"), id: null }] },
  provider(BUILTIN_PROVIDER_IDS.claude, [
    toggle(BUILTIN_PROVIDER_IDS.claude, "memory", "session-create", true),
    toggle(BUILTIN_PROVIDER_IDS.claude, "native-subagents", "session-create", true),
    toggle(BUILTIN_PROVIDER_IDS.claude, "workflow-tool", "session-create", true),
    toggle(BUILTIN_PROVIDER_IDS.claude, "context-1m", "session-create", true),
    toggle(BUILTIN_PROVIDER_IDS.claude, "claude-in-chrome", "session-create", false),
  ]),
  provider(BUILTIN_PROVIDER_IDS.codex, [toggle(BUILTIN_PROVIDER_IDS.codex, "memory", "session-create", true), toggle(BUILTIN_PROVIDER_IDS.codex, "native-subagents", "session-create", true)]),
  provider(BUILTIN_PROVIDER_IDS.kimi),
  provider(BUILTIN_PROVIDER_IDS.opencode),
] satisfies PluginDescriptor[]);
/** Owners composed outside this table still reserve their product identity before they initialize. */
export const BUILTIN_FEATURE_IDS = Object.freeze(['memory', 'tunnel', 'dock', 'sketch'] as const);
export const RESERVED_PLUGIN_IDS: readonly string[] = Object.freeze([...BUILTIN_PLUGINS.map(plugin => plugin.id), ...BUILTIN_FEATURE_IDS]);
export const isReservedPluginId = (id: string) => RESERVED_PLUGIN_IDS.includes(id);
export const builtinPlugin = (id: string) => BUILTIN_PLUGINS.find(plugin => plugin.id === id) ?? null;
