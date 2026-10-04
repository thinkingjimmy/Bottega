/**
 * [INPUT]: Depends on shared Agent options (a Chat's may be a package Provider's, TASK-11 S3-b), canonical Chat facts, and switch CAS contracts
 * [OUTPUT]: Provides once-initialized per-Chat drafts (ChatTurnOptions: a draft may start on a package Provider, an existing Chat never moves to or from one, and a package Chat keeps its own options), selection generations, and receipt-authorized native/adoption consumption, in a map bounded to the 8 most recently used clean drafts (C-07)
 * [POS]: Renderer draft state; navigation preserves drafts while process restart clears them
 */

import type { AgentSwitchIntent } from "../../../shared/chat-agent/contracts";
import type { ChatRuntimeContext } from "../../../shared/ipc/content/chats-ipc";
import { backendDefaults, builtinAgent, type ChatAgentId, type ChatTurnOptions } from "../../../shared/chat-agent/options";
import { firstProviderId } from "../provider-catalog/store";

export type PendingAgent = Readonly<{
  intent: AgentSwitchIntent; generation: number; stale: boolean; submitting?: string; draftIdentity?: unknown;
  incarnationId?: string;
}>;
export type AgentDraft = Readonly<{
  canonical: ChatRuntimeContext | null; options: ChatTurnOptions;
  pending: PendingAgent | null; generation: number; loading: boolean; initialized: boolean;
  adoption?: Readonly<{ requestId: string; intentId?: string; generation: number; draftIdentity: unknown; incarnationId?: string }>;
  adoptionError?: string;
}>;
const drafts = new Map<string, AgentDraft>();
/* C-07: the map is kept to the 8 most recently used drafts, but only clean ones (a mirror of the record, rebuilt on demand) are
   dropped; a pending selection, an adoption or a submission is the person's and never evicted. */
const RETAINED = 8;
const clean = (draft: AgentDraft) => !draft.pending && !draft.adoption && !draft.adoptionError && !draft.loading;
function touch(chatId: string, draft: AgentDraft) {
  drafts.delete(chatId);
  drafts.set(chatId, draft);
  let excess = drafts.size - RETAINED;
  for (const [id, entry] of drafts) {
    if (excess <= 0) break;
    if (id !== chatId && clean(entry)) { drafts.delete(id); excess--; }
  }
}
/* A Chat's own options, a package Provider's included (TASK-11 S4 follow-up): a package Chat reopened after a restart keeps sending
   on its Provider, never on a built-in's defaults. The draft's are kept only while the record has none. */
const draftOptions = (options: ChatRuntimeContext["options"] | undefined, fallback: ChatTurnOptions): ChatTurnOptions => options ?? fallback;
const watchers = new Set<() => void>();
export const subscribeAgentDraft = (listener: () => void) => { watchers.add(listener); return () => { watchers.delete(listener); }; };
export function readAgentDraft(chatId: string): AgentDraft {
  let draft = drafts.get(chatId);
  if (!draft) draft = { canonical: null, options: backendDefaults({}, firstProviderId()), pending: null, generation: 0, loading: false, initialized: false };
  touch(chatId, draft);
  return draft;
}
export function updateAgentDraft(chatId: string, update: (state: AgentDraft) => AgentDraft) {
  const current = readAgentDraft(chatId), next = update(current);
  if (next === current) return;
  touch(chatId, next); watchers.forEach(listener => listener());
}
export function receiveCanonicalAgent(chatId: string, record: ChatRuntimeContext | null) {
  updateAgentDraft(chatId, state => {
    if (!record) return state;
    if (state.canonical && record.chatRecordRevision < state.canonical.chatRecordRevision) return state;
    const pending = state.pending;
    return { ...state, canonical: record, initialized: true,
      options: pending ? state.options : draftOptions(record.options, state.options),
      pending: pending ? { ...pending, stale: pending.intent.expectedAgentRevision !== record.agentRevision } : null };
  });
}
export function beginAgentSelection(chatId: string, backend: ChatAgentId) {
  const state = readAgentDraft(chatId);
  if (state.adoption || state.pending?.submitting) throw new Error("AGENT_SWITCH_SUBMITTING");
  const generation = state.generation + 1;
  const canonical = state.canonical;
  /* A package Provider's Chat is pinned to it (TASK-11 S3-b): main refuses the switch, and so does the draft. */
  /* A draft (no record yet) may start on any Provider; an existing Chat never moves to or from a package Provider's. */
  const expectedAgent = canonical ? builtinAgent(canonical.agent) : null, targetAgent = builtinAgent(backend);
  if (canonical && canonical.agent !== backend && (!expectedAgent || !targetAgent)) throw new Error("PROVIDER_UNAVAILABLE");
  updateAgentDraft(chatId, () => ({ ...state, generation, initialized: true, adoptionError: undefined,
    options: canonical?.agent === backend ? draftOptions(canonical.options, state.options) : backendDefaults({}, backend),
    loading: canonical?.agent !== backend,
    pending: canonical && expectedAgent && targetAgent && canonical.agent !== backend ? { generation, stale: false, intent: {
      expectedAgent, expectedAgentRevision: canonical.agentRevision,
      expectedChatRecordRevision: canonical.chatRecordRevision, targetAgent,
    } } : null,
  }));
  return generation;
}
export function undoAgentSelection(chatId: string) {
  const state = readAgentDraft(chatId);
  if (state.adoption || state.pending?.submitting) return;
  updateAgentDraft(chatId, () => ({ ...state, generation: state.generation + 1,
    options: state.canonical ? draftOptions(state.canonical.options, state.options) : state.options, pending: null, loading: false }));
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
    return { ...state, canonical: latest, options: draftOptions(latest.options, state.options), pending: null, initialized: true, loading: false };
  });
}
