/**
 * [INPUT]: Depends on shared Agent options, canonical Chat facts, and switch CAS contracts
 * [OUTPUT]: Provides once-initialized per-Chat drafts, selection generations, and receipt-authorized native/adoption consumption
 * [POS]: Renderer draft state; navigation preserves drafts while process restart clears them
 */

import type { AgentBackendId, AgentTurnOptions } from "../../../shared/agent-ipc";
import type { AgentSwitchIntent } from "../../../shared/chat-agent/contracts";
import type { ChatRuntimeContext } from "../../../shared/chats-ipc";
import { backendDefaults } from "../../../shared/chat-agent/options";

export type PendingAgent = Readonly<{
  intent: AgentSwitchIntent; generation: number; stale: boolean; submitting?: string; draftIdentity?: unknown;
  incarnationId?: string;
}>;
export type AgentDraft = Readonly<{
  canonical: ChatRuntimeContext | null; options: AgentTurnOptions;
  pending: PendingAgent | null; generation: number; loading: boolean; initialized: boolean;
  adoption?: Readonly<{ requestId: string; intentId?: string; generation: number; draftIdentity: unknown; incarnationId?: string }>;
  adoptionError?: string;
}>;
const drafts = new Map<string, AgentDraft>();
const watchers = new Set<() => void>();
export const subscribeAgentDraft = (listener: () => void) => { watchers.add(listener); return () => { watchers.delete(listener); }; };
export function readAgentDraft(chatId: string): AgentDraft {
  let draft = drafts.get(chatId);
  if (!draft) {
    draft = { canonical: null, options: backendDefaults({}, "codex"), pending: null, generation: 0, loading: false, initialized: false };
    drafts.set(chatId, draft);
  }
  return draft;
}
export function updateAgentDraft(chatId: string, update: (state: AgentDraft) => AgentDraft) {
  const current = readAgentDraft(chatId), next = update(current);
  if (next === current) return;
  drafts.set(chatId, next); watchers.forEach(listener => listener());
}
export function receiveCanonicalAgent(chatId: string, record: ChatRuntimeContext | null) {
  updateAgentDraft(chatId, state => {
    if (!record) return state;
    if (state.canonical && record.chatRecordRevision < state.canonical.chatRecordRevision) return state;
    const pending = state.pending;
    return { ...state, canonical: record, initialized: true,
      options: pending ? state.options : record.options,
      pending: pending ? { ...pending, stale: pending.intent.expectedAgentRevision !== record.agentRevision } : null };
  });
}
export function beginAgentSelection(chatId: string, backend: AgentBackendId) {
  const state = readAgentDraft(chatId);
  if (state.adoption || state.pending?.submitting) throw new Error("AGENT_SWITCH_SUBMITTING");
  const generation = state.generation + 1;
  const canonical = state.canonical;
  updateAgentDraft(chatId, () => ({ ...state, generation, initialized: true, adoptionError: undefined,
    options: canonical?.agent === backend ? canonical.options : backendDefaults({}, backend),
    loading: canonical?.agent !== backend,
    pending: canonical && canonical.agent !== backend ? { generation, stale: false, intent: {
      expectedAgent: canonical.agent, expectedAgentRevision: canonical.agentRevision,
      expectedChatRecordRevision: canonical.chatRecordRevision, targetAgent: backend,
    } } : null,
  }));
  return generation;
}
export function undoAgentSelection(chatId: string) {
  const state = readAgentDraft(chatId);
  if (state.adoption || state.pending?.submitting) return;
  updateAgentDraft(chatId, () => ({ ...state, generation: state.generation + 1,
    options: state.canonical?.options ?? state.options, pending: null, loading: false }));
}
export function clearAgentDraft(chatId: string) {
  const state = readAgentDraft(chatId);
  if (state.adoption || state.pending?.submitting) return;
  drafts.delete(chatId); watchers.forEach(listener => listener());
}
export function markAgentSubmission(chatId: string, intentId: string, generation: number, draftIdentity?: unknown, incarnationId?: string) {
  updateAgentDraft(chatId, state => state.pending?.generation === generation
    ? { ...state, pending: { ...state.pending, submitting: intentId, draftIdentity, incarnationId } } : state);
}
export function rejectAgentSubmission(chatId: string, intentId: string) {
  updateAgentDraft(chatId, state => state.pending?.submitting === intentId
    ? { ...state, pending: { ...state.pending, submitting: undefined } } : state);
}
export function consumeAgentSubmission(chatId: string, intentId: string, record: ChatRuntimeContext) {
  updateAgentDraft(chatId, state => {
    const pending = state.pending;
    const latest = state.canonical && state.canonical.chatRecordRevision > record.chatRecordRevision ? state.canonical : record;
    if (!pending || pending.submitting !== intentId || latest.agentRevision <= pending.intent.expectedAgentRevision) return state;
    if (pending.incarnationId && latest.incarnationId !== pending.incarnationId) return state;
    return { ...state, canonical: latest, options: latest.options, pending: null, initialized: true, loading: false };
  });
}
