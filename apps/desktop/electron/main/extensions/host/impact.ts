/**
 * [INPUT]: Plugin disable-impact schemas, Provider ownership, Chat summaries, dependency resolution and declared effects.
 * [OUTPUT]: Computes bounded disable-impact samples and exact totals for Chats, dependents and plugin effects.
 * [POS]: Read-only plugin lifecycle review; mutation remains with each domain owner.
 */
import { PLUGIN_IMPACT_SAMPLE, pluginDisableImpactSchema, type PluginDisableImpact, type PluginEffectKind } from "@ai-chat/cloud-protocol/contracts/plugins/impact";
import type { LocalizedText } from "@ai-chat/cloud-protocol/contracts/plugins/text";

export type ImpactPorts = {
  providersOf(installIdentity: string): Promise<readonly string[] | null>;
  chats(): readonly { id: string; title?: string | null; agent: string }[];
  dependents(installIdentity: string): Promise<ReadonlyArray<{ pluginId: string; name: LocalizedText }>>;
  effects?(installIdentity: string): Promise<ReadonlyArray<{ kind: PluginEffectKind; count: number; label: LocalizedText }>>;
  now(): number;
};
const sample = <T>(items: readonly T[]) => ({ items: items.slice(0, PLUGIN_IMPACT_SAMPLE), total: items.length });
const clip = (value: string) => value.slice(0, 256) || "—";
export async function computeDisableImpact(installIdentity: string, ports: ImpactPorts): Promise<PluginDisableImpact> {
  const supplied = await ports.providersOf(installIdentity);
  if (!supplied) throw new Error("plugin-not-installed");
  const providerIds = [...supplied];
  const chats = ports.chats().filter(chat => providerIds.includes(chat.agent));
  return pluginDisableImpactSchema.parse({
    installIdentity, providerIds,
    readOnlyChats: sample(chats.map(chat => ({ chatId: chat.id, title: chat.title ? clip(chat.title) : null }))),
    dependents: sample(await ports.dependents(installIdentity)),
    effects: sample((await ports.effects?.(installIdentity)) ?? []),
    computedAt: ports.now(),
  });
}
