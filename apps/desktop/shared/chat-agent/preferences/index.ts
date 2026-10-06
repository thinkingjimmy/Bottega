/**
 * [INPUT]: Validated Chat options, stored model preferences, Provider availability and explicit-choice intent order.
 * [OUTPUT]: Preference-write schema, New Chat Agent resolution, catalog defaults, per-Agent option learning and stale-choice fences.
 * [POS]: UI-free preference policy shared by the main Settings owner and native Chat settings.
 */
import { z } from "zod";
import { backendDefaults, builtinOptions, type ChatAgentId, type ChatTurnOptions } from "../options";
import type { AppSettings } from "../../ipc/settings/settings-ipc";
import type { AgentTurnOptions, BackendModelInfo } from "../../ipc/agent/agent-ipc";

export const chatPreferenceWriteSchema = z.object({
  preferForNewChat: z.boolean().optional(),
  agentOnly: z.boolean().optional(),
  expectedModel: z.string().min(1).max(200).optional(),
}).strict().default({});
export type ChatPreferenceWrite = z.infer<typeof chatPreferenceWriteSchema>;
type Preferences = Pick<AppSettings, "defaultBackend" | "lastChatBackend" | "defaultChatOptionsByBackend">;

export function newChatBackend(settings: Preferences, available: (id: ChatAgentId) => boolean): ChatAgentId {
  return settings.lastChatBackend && available(settings.lastChatBackend) ? settings.lastChatBackend : settings.defaultBackend;
}

export function learnChatPreferences(settings: Preferences, options: ChatTurnOptions, write: ChatPreferenceWrite) {
  const builtin = builtinOptions(options);
  const current = builtin ? settings.defaultChatOptionsByBackend[builtin.backend] : undefined;
  if (write.expectedModel !== undefined && current?.model !== write.expectedModel) return null;
  const defaults = builtin && !write.agentOnly && JSON.stringify(current) !== JSON.stringify(builtin)
    ? { ...settings.defaultChatOptionsByBackend, [builtin.backend]: structuredClone(builtin) } : settings.defaultChatOptionsByBackend;
  if (defaults === settings.defaultChatOptionsByBackend && (write.preferForNewChat === false || settings.lastChatBackend === options.backend)) return null;
  return {
    defaultChatOptionsByBackend: defaults,
    ...(write.preferForNewChat !== false ? { lastChatBackend: options.backend } : {}),
  };
}

export function catalogChatOptions(options: AgentTurnOptions, model: BackendModelInfo) {
  const effort = model.defaultReasoningEffort ?? model.supportedReasoningEfforts?.[0]?.effort ?? options.reasoningEffort;
  const speed = "serviceTier" in options || model.serviceTiers !== undefined;
  return { ...options, model: model.slug, ...(effort !== undefined ? { reasoningEffort: effort } : {}),
    ...(speed ? { serviceTier: model.serviceTiers?.[0]?.id ?? "default" } : {}) };
}

export function isFactoryChatOptions(options: AgentTurnOptions) {
  return JSON.stringify(builtinOptions(options)) === JSON.stringify(backendDefaults({}, options.backend));
}

export function createChatPreferenceIntents() {
  let latest = 0;
  const backends = new Map<ChatAgentId, number>();
  return {
    begin(backend: ChatAgentId) { const intent = ++latest; backends.set(backend, intent); return intent; },
    isLatest(intent: number) { return intent === latest; },
    isLatestForBackend(backend: ChatAgentId, intent: number) { return backends.get(backend) === intent; },
  };
}
