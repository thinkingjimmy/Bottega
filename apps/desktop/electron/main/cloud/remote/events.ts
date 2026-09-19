/**
 * [INPUT]: Depends on local Agent events and shared closed live-output contracts.
 * [OUTPUT]: Projects bounded live events and exact approval decisions while excluding local paths and option identifiers.
 * [POS]: Main-only live publication adapter; response authority is separately validated by command intake.
 */
import type { AgentEvent, TurnSnapshot } from "../../../../shared/agent-ipc";
import { liveEventSchema, turnChunkSchema, hashTurnChunk, type LiveEvent, type TurnChunk } from "@ai-chat/cloud-protocol/turns/live";
import { agentTurnItemSchema, liveSubagentMetaSchema } from "@ai-chat/cloud-protocol/turns/items";
import { truncateUtf8 } from "../../../../shared/truncate-utf8";
import { redactImageDetails } from "../../gallery/agent-image-projection";
import { MESSAGE_BYTE_LIMIT, TOOL_DETAIL_BYTE_LIMIT, PART_TITLE_CHAR_LIMIT } from "@ai-chat/cloud-protocol/chats/content/budgets";
import { createLiveProjection, reduceLiveProjection } from "@ai-chat/cloud-protocol/turns/projection";
const trim = (text: string | undefined, bytes = 16000) => {
  if (text === undefined) return undefined;
  const wireBudget = bytes + 2;
  let value = truncateUtf8(text, bytes, "…").value;
  while (new TextEncoder().encode(JSON.stringify(value)).length > wireBudget) {
    bytes = Math.floor(bytes * 0.8); value = truncateUtf8(text, bytes, "…").value;
  }
  return value;
};
const item = (value: Extract<AgentEvent, { type: "item" }>["item"]) => agentTurnItemSchema.strip().parse({ ...value,
  title: value.title.slice(0, PART_TITLE_CHAR_LIMIT), text: trim(value.text, MESSAGE_BYTE_LIMIT), detail: trim(value.detail, TOOL_DETAIL_BYTE_LIMIT) });
export function projectLiveEvent(event: AgentEvent): LiveEvent[] {
  event = redactImageDetails(event);
  let value: unknown;
  switch (event.type) {
    case "session": case "service-tier-effective": return [];
    case "turn-state-changed": return [liveEventSchema.parse({ type: "phase", phase: event.turn.phase }),
      ...(event.turn.terminal ? [liveEventSchema.parse({ type: "terminal", terminal: event.turn.terminal })] : [])];
    case "turn-persisted": return [{ type: "terminal", terminal: event.terminal }];
    case "item": value = { type: event.type, item: item(event.item) }; break;
    case "subagent-item": value = { type: event.type, agentThreadId: event.agentThreadId, agent: liveSubagentMetaSchema.strip().parse(event.agent), item: item(event.item) }; break;
    case "item-delta": case "subagent-item-delta": {
      const texts: string[] = []; let rest = event.text;
      while (rest) { const part = truncateUtf8(rest, 8000).value; texts.push(part); rest = rest.slice(part.length); }
      return texts.map(text => liveEventSchema.parse({ type: event.type, itemId: event.itemId, text,
        ...(event.type === "subagent-item-delta" ? { agentThreadId: event.agentThreadId, agent: liveSubagentMetaSchema.strip().parse(event.agent) } : {}) }));
    }
    case "approval-requested": {
      const a = event.approval;
      value = { type: event.type, approval: { approvalId: a.approvalId, kind: a.kind, purpose: a.purpose, command: trim(a.command, 4000),
        reason: trim(a.reason, 4000), diff: trim(a.diff, 32 * 1024), networkHost: a.networkHost, agentName: a.agentName,
        remoteAllowed: true, canAcceptForSession: a.canAcceptForSession,
        choices: a.choices?.slice(0, 10).map(choice => ({ label: choice.label.slice(0, 200), tone: choice.tone, decision: choice.decision })) } }; break;
    }
    case "user-input-requested": {
      const r = event.request;
      value = { type: event.type, request: { userInputId: r.userInputId, itemId: r.itemId, agentName: r.agentName, expiresAt: r.expiresAt,
        questions: r.questions.slice(0, 20).map(q => ({ id: q.id, header: q.header?.slice(0, 128), question: trim(q.question, 600),
          options: q.options?.slice(0, 5).map(option => ({ label: option.label.slice(0, 80), description: trim(option.description, 80) })),
          multiSelect: q.multiSelect, required: q.required, isOther: q.isOther, isSecret: q.isSecret })) } }; break;
    }
    default: { const { requestId: _request, conversationId: _chat, seq: _seq, ...body } = event; value = body; }
  }
  return [liveEventSchema.parse(value)];
}
export function chunkEvents(events: readonly LiveEvent[], afterSeq: number): TurnChunk[] {
  const chunks: TurnChunk[] = []; let pending: LiveEvent[] = [];
  const flush = () => { if (pending.length) { const value = { seq: afterSeq + chunks.length + 1, events: pending };
    chunks.push(turnChunkSchema.parse({ ...value, payloadHash: hashTurnChunk(value) })); pending = []; } };
  for (const event of events) {
    const candidate = { seq: afterSeq + chunks.length + 1, events: [...pending, event] };
    if (!turnChunkSchema.safeParse({ ...candidate, payloadHash: hashTurnChunk(candidate) }).success) flush();
    pending.push(event);
  }
  flush(); return chunks;
}
export function* projectBoundedEvents(event: AgentEvent): Generator<LiveEvent> {
  if (event.type !== "item-delta" && event.type !== "subagent-item-delta") { yield* projectLiveEvent(event); return; }
  for (let offset = 0; offset < event.text.length;) {
    const text = truncateUtf8(event.text.slice(offset), 8000).value;
    yield* projectLiveEvent({ ...event, text }); offset += text.length;
  }
}
function snapshotEvents(turn: TurnSnapshot): LiveEvent[] {
  turn = redactImageDetails(turn);
  const events: LiveEvent[] = [{ type: "phase", phase: turn.phase }];
  for (const part of turn.draft.parts) {
    if (part.type === "text") events.push({ type: "item", item: item({ itemId: part.itemId, kind: part.kind === "plan" ? "plan" : "agent-message", title: "", text: part.text, status: "completed" }) });
    else if (part.type === "tool") events.push({ type: "item", item: item({ itemId: part.itemId, kind: part.tool, title: part.title, detail: part.detail, status: part.status, failure: part.failure, severity: part.severity }) });
  }
  for (const [itemId, text] of turn.draft.streaming) {
    if (turn.draft.plan?.itemId === itemId) events.push({ type: "item", item: { itemId, kind: "plan", title: "", text: "", status: "running" } });
    events.push(...projectLiveEvent({ type: "item-delta", requestId: turn.requestId, conversationId: "snapshot", seq: 0, itemId, text: trim(text, MESSAGE_BYTE_LIMIT)! }));
  }
  for (const agent of Object.values(turn.liveSubagents)) {
    events.push({ type: "subagent-update", agent: agent.meta, detailState: agent.detailState });
    for (const part of agent.draft?.parts ?? []) {
      if (part.type === "subagent") continue;
      events.push({ type: "subagent-item", agentThreadId: agent.meta.agentThreadId, agent: agent.meta, item: item(part.type === "text" ?
        { itemId: part.itemId, kind: part.kind === "plan" ? "plan" : "agent-message", title: "", text: part.text, status: "completed" } :
        { itemId: part.itemId, kind: part.tool, title: part.title, detail: part.detail, status: part.status, failure: part.failure, severity: part.severity }) });
    }
    for (const [itemId, text] of agent.draft?.streaming ?? []) {
      if (agent.draft?.plan?.itemId === itemId) events.push({ type: "subagent-item", agentThreadId: agent.meta.agentThreadId, agent: agent.meta,
        item: { itemId, kind: "plan", title: "", text: "", status: "running" } });
      events.push(...projectLiveEvent({ type: "subagent-item-delta", requestId: turn.requestId, conversationId: "snapshot", seq: 0, agentThreadId: agent.meta.agentThreadId, agent: agent.meta, itemId, text: trim(text, MESSAGE_BYTE_LIMIT)! }));
    }
  }
  for (const approval of turn.approvals) events.push(...projectLiveEvent({ type: "approval-requested", requestId: turn.requestId, conversationId: "snapshot", seq: 0, approval }));
  for (const request of turn.userInputs) events.push(...projectLiveEvent({ type: "user-input-requested", requestId: turn.requestId, conversationId: "snapshot", seq: 0, request }));
  for (const result of turn.interactionResults ?? []) events.push(result.kind === "approval" ?
    { type: "approval-closed", approvalId: result.interactionId, resolvedBy: result.resolvedBy } :
    { type: "user-input-closed", userInputId: result.interactionId, resolvedBy: result.resolvedBy });
  if (turn.terminal) events.push({ type: "terminal", terminal: turn.terminal });
  return events.map(event => liveEventSchema.parse(event));
}
export function projectTurnSnapshot(turn: TurnSnapshot) {
  const projection = reduceLiveProjection(createLiveProjection(turn.draft.startedAt), snapshotEvents(turn));
  const order = new Map(turn.draft.parts.map((part, index) => [part.itemId, index]));
  projection.draft.parts.sort((a, b) => (order.get(a.itemId) ?? Infinity) - (order.get(b.itemId) ?? Infinity));
  if (turn.phase === "resume-failed" && turn.retryToken) projection.recovery = { retryToken: turn.retryToken, generation: turn.generation ?? 1,
    allowedActions: turn.allowedActions ?? { sameSession: false, freshSession: false, abandon: false } };
  return projection;
}
