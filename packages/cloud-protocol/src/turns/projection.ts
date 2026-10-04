/**
 * [INPUT]: Depends on the shared draft reducer, atomic replacement decoder, normalization and safe live events.
 * [OUTPUT]: Provides bounded live replay and deterministic interrupted message/Subagent projection.
 * [POS]: Client projection kernel for encrypted history recovery, remote desktop viewing and browser catch-up.
 */
import { canonicalJson } from "../encryption/encoding";
import { chatBodySchema, hashChatContent, type ChatBody } from "../chats/transcript/body";
import type { PersistedSubagent } from "../chats/content/messages";
import { utf8Length } from "../chats/content/parts";
import { MESSAGE_BYTE_LIMIT, MESSAGE_PART_LIMIT, SUBAGENT_BYTE_LIMIT, SUBAGENT_DRAFT_LIMIT } from "../chats/content/budgets";
import { applyDelta, applyItem, applyItemRemoved, applySubagent, createDraft, finalize, hydrateDraft, serializeDraft, type TurnDraft } from "./reducer";
import { resolvedInteractions } from "./interactions/reducer";
import { liveProjectionSchema, type LiveEvent, type LiveProjection } from "./live";
import type { TurnStart } from "./model";
import { normalizeMessageContent } from "./text/normalize";
import { truncateUtf8 } from "./text/truncate-utf8";
import { reduceReplacement } from "./replacement";
const clipped = (value: string) => truncateUtf8(value, MESSAGE_BYTE_LIMIT, "…[已截断]").value;
function bounded(draft: TurnDraft) {
  const streaming = [...draft.streaming].slice(-MESSAGE_PART_LIMIT).map(([id, text]) => [id, clipped(text)] as [string, string]);
  const parts = draft.parts.slice(-MESSAGE_PART_LIMIT);
  while (utf8Length(canonicalJson({ parts, streaming })) > MESSAGE_BYTE_LIMIT * 2 && (parts.length || streaming.length > 1)) {
    if (parts.length) parts.shift(); else streaming.shift();
  }
  return serializeDraft({ ...draft, parts, streaming: new Map(streaming) });
}
export const createLiveProjection = (startedAt: number): LiveProjection => ({ draft: serializeDraft(createDraft(startedAt)),
  approvals: [], userInputs: [], subagents: [], phase: "starting", terminal: null });
export function reduceLiveProjection(previous: LiveProjection, events: LiveEvent[]): LiveProjection {
  let state = structuredClone(previous);
  for (const event of events) {
    if (event.type === "replacement-begin" || event.type === "replacement-part" || event.type === "replacement-commit" || event.type === "replacement-abort") {
      state = reduceReplacement(state, event); continue;
    }
    if (state.replacement) throw new Error("LIVE_REPLACEMENT_INCOMPLETE");
    let draft = hydrateDraft(state.draft);
    switch (event.type) {
      case "item-delta": draft = applyDelta(draft, event.itemId, event.text); break;
      case "item": draft = applyItem(draft, event.item); break;
      case "item-removed": draft = applyItemRemoved(draft, event.itemId); break;
      case "phase": state.phase = event.phase; if (event.phase !== "resume-failed") delete state.recovery; break;
      case "terminal": state.terminal = event.terminal; delete state.recovery; break;
      case "approval-requested": state.approvals = [...state.approvals.filter(value => value.approvalId !== event.approval.approvalId), event.approval].slice(-20); break;
      case "approval-closed": state.approvals = state.approvals.filter(value => value.approvalId !== event.approvalId); break;
      case "user-input-requested": state.userInputs = [...state.userInputs.filter(value => value.userInputId !== event.request.userInputId), event.request].slice(-20); break;
      case "user-input-closed": state.userInputs = state.userInputs.filter(value => value.userInputId !== event.userInputId); break;
      case "subagent-update": case "subagent-item": case "subagent-item-delta": {
        const agent = event.agent, old = state.subagents.find(value => value.meta.agentThreadId === agent.agentThreadId);
        let subdraft = old?.draft ? hydrateDraft(old.draft) : createDraft(agent.spawnedAt);
        if (event.type === "subagent-item") subdraft = applyItem(subdraft, event.item);
        if (event.type === "subagent-item-delta") subdraft = applyDelta(subdraft, event.itemId, event.text);
        state.subagents = [...state.subagents.filter(value => value.meta.agentThreadId !== agent.agentThreadId),
          { meta: agent, draft: bounded(subdraft), detailState: event.type === "subagent-update" ? event.detailState : "available" as const }].slice(-SUBAGENT_DRAFT_LIMIT);
        draft = applySubagent(draft, agent); break;
      }
    }
    if (event.type === "approval-closed" || event.type === "user-input-closed") {
      if (event.resolvedBy) state.interactionResults = resolvedInteractions(state.interactionResults, {
        kind: event.type === "approval-closed" ? "approval" : "input",
        interactionId: event.type === "approval-closed" ? event.approvalId : event.userInputId, resolvedBy: event.resolvedBy });
    }
    state.draft = bounded(draft);
    for (const agent of state.subagents) {
      if (utf8Length(canonicalJson(state.subagents)) <= SUBAGENT_BYTE_LIMIT) break;
      agent.draft = undefined; agent.detailState = "unavailable"; agent.meta.resultTruncated = true;
    }
  }
  state = liveProjectionSchema.parse(state); return state;
}
export function interruptedTurnBody(turn: TurnStart, projection: LiveProjection, sealedAt: number,
  reason: "execution-unconfirmed" | "final-result-missing" | "source-error" | "source-cancelled"): ChatBody | null {
  const result = finalize(hydrateDraft(projection.draft), sealedAt, turn.planRequested, "interrupted");
  if (!result.content && !result.parts?.length) return null;
  const message = normalizeMessageContent({ id: turn.assistantMessageId, seq: turn.assistantSeq, role: "assistant" as const,
    backend: turn.backend, createdAt: turn.createdAt, turnId: turn.turnId, completion: "interrupted" as const, completionReason: reason,
    content: result.content, ...(result.parts?.length ? { parts: result.parts } : {}), durationMs: result.durationMs,
    ...(result.plan ? { kind: "plan" as const } : {}) });
  const subagents: Record<string, PersistedSubagent> = {};
  for (const agent of projection.subagents) {
    const result = finalize(hydrateDraft(agent.draft ?? serializeDraft(createDraft(agent.meta.spawnedAt))), sealedAt, true, "interrupted");
    const parts = [...(result.parts ?? []), ...(result.content ? [{ type: "text" as const, itemId: "partial-final", text: result.content }] : [])].slice(-MESSAGE_PART_LIMIT);
    const status = agent.meta.status === "completed" || agent.meta.status === "shutdown" || agent.meta.status === "errored" ? agent.meta.status : "interrupted";
    subagents[agent.meta.agentThreadId] = { meta: { ...agent.meta, status, ...(status === "interrupted" ? { completion: "interrupted", completionReason: reason } as const : {}) }, parts };
  }
  for (const agent of Object.values(subagents)) {
    if (utf8Length(canonicalJson(subagents)) <= SUBAGENT_BYTE_LIMIT) break;
    agent.parts = []; agent.meta.resultTruncated = true;
  }
  return chatBodySchema.parse({ version: 1, message: { ...message, resultHash: hashChatContent(message) },
    ...(Object.keys(subagents).length ? { subagents } : {}), attachments: [], media: [] });
}
