/**
 * [INPUT]: Depends on Zod and localized text (text.ts).
 * [OUTPUT]: Provides pluginDisableImpactSchema, PLUGIN_EFFECT_KINDS and PluginImpactBridge: what turning a plugin off would do — Agent configurations that can no longer be chosen, workflows that can start no new run, running runs that pause after their current step, Chats that become read-only, plugins that become unusable (dependents) and the plugin's own declared effects — each as a bounded sample plus a total.
 * [POS]: The "impact before disabling" contract (what turning a plugin off would do, shown before it is turned off); the Plugins & Apps page and its fake implement the same bridge, and the desktop implements it in extensions/host/impact.ts (channel in channel.ts).
 */
import { z } from "zod";
import { localizedTextSchema } from "./text";

export const PLUGIN_IMPACT_SAMPLE = 20;
export const PLUGIN_EFFECT_KINDS = ["tunnel-sessions-closed", "tunnel-grants-revoked", "system-dock-restored", "dock-agent-unregistered",
  "dock-widgets-hidden", "memory-recall-paused", "memory-capture-paused", "memory-backfill-paused", "memory-phone-paused", "memory-rebuild-continues"] as const;
export type PluginEffectKind = (typeof PLUGIN_EFFECT_KINDS)[number];
const id = z.string().min(1).max(160);
const name = z.string().min(1).max(256);
/* A page never needs every item to decide; it shows a few and the count. */
const sample = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item).max(PLUGIN_IMPACT_SAMPLE), total: z.number().int().min(0) }).strict()
  .refine(value => value.total >= value.items.length, "total-below-sample");

export const pluginDisableImpactSchema = z.object({
  installIdentity: id,
  /** The Providers this plugin supplies; everything below follows from them. */
  providerIds: z.array(z.string().regex(/^[a-z][a-z0-9-]{1,31}$/)).max(16),
  /** Configurations using one of those Providers: they stay, but cannot be chosen while the plugin is off. */
  agentConfigs: sample(z.object({ configId: id, name }).strict()),
  /** Workflows with a step bound to such a configuration: no new run starts. */
  workflows: sample(z.object({ bindingId: id, name, projectId: id }).strict()),
  /** Runs in progress on such a step: each finishes its current step, then pauses. */
  runs: sample(z.object({ runId: id, bindingId: id, stepLabel: name.nullable() }).strict()),
  /** Chats whose Agent is one of those Providers: they stay readable, but cannot continue. */
  readOnlyChats: sample(z.object({ chatId: id, title: name.nullable() }).strict()),
  /** Plugins that would become unusable: they require a contract only this plugin satisfies now (appendix C.4). */
  dependents: sample(z.object({ pluginId: id.max(160), name: localizedTextSchema }).strict()),
  /** The plugin's own effects, from a fixed Bottega-owned list (a host package cannot report its own yet). */
  effects: sample(z.object({ kind: z.enum(PLUGIN_EFFECT_KINDS), count: z.number().int().min(0), label: localizedTextSchema }).strict()),
  computedAt: z.number().int().min(0),
}).strict();
export type PluginDisableImpact = z.infer<typeof pluginDisableImpactSchema>;

export interface PluginImpactBridge {
  /** Read-only: computing the preview changes nothing and starts nothing. */
  disableImpact(installIdentity: string): Promise<PluginDisableImpact>;
}
