/**
 * [INPUT]: Depends on shared Codex Snapshots/events, ChatRecord, Subagent Show names and shared turn reducer
 * [OUTPUT]: Provides attach projections with a stable message that is running in sequence; id→index overlay single-line append unordered, keeping the ledger
 * [POS]: The main-owned turn of the renderer is read only by the projection core, which is detached from the React test
 */

import {
  applyDelta,
  applyItem,
  applyItemRemoved,
  applySubagent,
  hydrateDraft,
  type TurnDraft,
} from "../../shared/chat-turn-reducer";
import type {
  AgentApprovalRequest,
  AgentEvent,
  AgentLiveSubagent,
  AgentSubagentMeta,
  AgentUserInputRequest,
  SessionServiceTierEffective,
  SessionRef,
  TurnSnapshot,
} from "../../shared/agent-ipc";
import type {
  ChatMessage,
  ChatRecord,
  PersistedSubagent,
} from "../../shared/chats-ipc";
import { displaySubagentName } from "../../shared/subagent-name";

export type ChatTurnProjection = {
  messages: ChatMessage[];
  session?: SessionRef;
  serviceTierEffective?: SessionServiceTierEffective;
  requestId?: string;
  draft: TurnDraft | null;
  approvals: AgentApprovalRequest[];
  userInputs: AgentUserInputRequest[];
  subagents: Record<string, ProjectedSubagent>;
  blocksNewTurn: boolean;
  cleanup?: TurnSnapshot["cleanup"];
  persist?: TurnSnapshot["persist"];
  terminal?: TurnSnapshot["terminal"];
  phase?: TurnSnapshot["phase"];
  retryToken?: string;
  allowedActions?: TurnSnapshot["allowedActions"];
  assistantSeq?: number;
  steeringSupported: boolean;
};

export type ProjectedSubagent = {
  meta: AgentSubagentMeta;
  detailState: AgentLiveSubagent["detailState"];
  draft: TurnDraft | null;
};

/* ============================================================
 * 投影里「不进 React 渲染树、但队列要读」的那几格：requestId 决定 steer
 * 打给谁，steeringSupported 决定 steer 还是置顶排队。
 *
 * 它此前靠一个 `[hydration]` effect 顺带刷新——水合状态每次投影都被写一
 * 次 blocksNewTurn，于是引用变化恰好成了心跳。这种「正确性挂在无关状态
 * 的副作用上」的接法，会在那个无关状态被清理时静默失效：本次把
 * blocksNewTurn 移出水合，若不同时给它自己的触发源，steering 会从
 * 「够不着」变成「彻底收不到 requestId」。投影变了就推投影状态，因果同源。
 * ============================================================ */
export type ChatProjectionStatus = Partial<
  Pick<
    ChatTurnProjection,
    | "cleanup"
    | "persist"
    | "phase"
    | "requestId"
    | "retryToken"
    | "allowedActions"
    | "assistantSeq"
    | "steeringSupported"
    | "serviceTierEffective"
  >
>;

export const projectionStatusOf = (
  projection: ChatTurnProjection
): ChatProjectionStatus => ({
  cleanup: projection.cleanup,
  persist: projection.persist,
  phase: projection.phase,
  requestId: projection.requestId,
  retryToken: projection.retryToken,
  allowedActions: projection.allowedActions,
  assistantSeq: projection.assistantSeq,
  steeringSupported: projection.steeringSupported,
  serviceTierEffective: projection.serviceTierEffective,
});

export const sameProjectionStatus = (
  left: ChatProjectionStatus,
  right: ChatProjectionStatus
) =>
  left.cleanup === right.cleanup &&
  left.persist === right.persist &&
  left.phase === right.phase &&
  left.requestId === right.requestId &&
  left.retryToken === right.retryToken &&
  left.allowedActions?.sameSession === right.allowedActions?.sameSession &&
  left.allowedActions?.freshSession === right.allowedActions?.freshSession &&
  left.allowedActions?.abandon === right.allowedActions?.abandon &&
  left.assistantSeq === right.assistantSeq &&
  left.steeringSupported === right.steeringSupported &&
  left.serviceTierEffective?.value === right.serviceTierEffective?.value &&
  left.serviceTierEffective?.reason === right.serviceTierEffective?.reason;

const projectSubagentMeta = (meta: AgentSubagentMeta): AgentSubagentMeta => ({
  ...meta,
  name: displaySubagentName(meta.name),
});

export function mergeChatMessages(
  ledger: ChatMessage[],
  incoming: readonly ChatMessage[]
): ChatMessage[] {
  const result = [...ledger];
  const ledgerIds = new Set(ledger.map((message) => message.id));
  const indexes = new Map(result.map((message, index) => [message.id, index]));
  let changed = false;
  let monotonic = true;
  for (const message of incoming) {
    const existing = indexes.get(message.id);
    if (existing !== undefined) {
      const current = result[existing];
      if (sameChatMessage(current, message)) continue;
      // 全量账本优先于本地 stale user；turn-persisted 只允许为同正文
      // assistant 补齐 parts/duration 等 canonical 字段。
      if (
        ledgerIds.has(message.id) &&
        !(
          current.role === "assistant" &&
          message.role === "assistant" &&
          current.content === message.content &&
          current.createdAt === message.createdAt
        )
      ) {
        continue;
      }
      result[existing] = message;
      if (current.seq !== message.seq) monotonic = false;
      changed = true;
      continue;
    }
    const previous = result.at(-1);
    if (previous && message.seq < previous.seq) monotonic = false;
    indexes.set(message.id, result.length);
    result.push(message);
    changed = true;
  }
  if (!changed) return ledger;
  return monotonic
    ? result
    : result.sort((left, right) => left.seq - right.seq);
}

const sameJson = (left: unknown, right: unknown) =>
  left === right || JSON.stringify(left) === JSON.stringify(right);

export function sameChatMessage(left: ChatMessage, right: ChatMessage) {
  if (
    left.role !== right.role ||
    left.id !== right.id ||
    left.content !== right.content ||
    left.createdAt !== right.createdAt ||
    left.seq !== right.seq
  ) {
    return false;
  }
  if (left.role === "assistant" && right.role === "assistant") {
    return (
      left.kind === right.kind &&
      left.isError === right.isError &&
      left.durationMs === right.durationMs &&
      sameJson(left.parts, right.parts)
    );
  }
  if (left.role === "user" && right.role === "user") {
    return (
      sameJson(left.attachments, right.attachments) &&
      sameJson(left.relay, right.relay)
    );
  }
  if (left.role === "notice" && right.role === "notice") {
    return sameJson(left.notice, right.notice);
  }
  return false;
}

const projectPersistedSubagents = (
  input: Record<string, PersistedSubagent> = {}
): Record<string, ProjectedSubagent> =>
  Object.fromEntries(
    Object.entries(input).map(([id, agent]) => [
      id,
      {
        meta: projectSubagentMeta(agent.meta),
        detailState: "available" as const,
        draft: {
          startedAt: agent.meta.spawnedAt,
          parts: agent.parts.filter((part) => part.type !== "subagent"),
          streaming: new Map(),
        },
      },
    ])
  );

const mergeLiveSubagents = (
  base: Record<string, ProjectedSubagent>,
  incoming: Record<string, AgentLiveSubagent>
) => {
  if (Object.keys(incoming).length === 0) return base;
  const result = { ...base };
  for (const [id, agent] of Object.entries(incoming)) {
    result[id] = {
      meta: projectSubagentMeta(agent.meta),
      detailState: agent.detailState,
      draft:
        agent.detailState === "unavailable"
          ? null
          : agent.draft
            ? hydrateDraft(agent.draft)
            : result[id]?.draft ?? null,
    };
  }
  return result;
};

export function projectionFromSnapshot(
  record: ChatRecord | null,
  turn: TurnSnapshot | null,
  currentMessages: readonly ChatMessage[] = []
): ChatTurnProjection {
  const messages = mergeChatMessages(record?.messages ?? [], currentMessages);
  if (!turn) {
    return {
      messages,
      session: record?.session ?? undefined,
      draft: null,
      approvals: [],
      userInputs: [],
      subagents: projectPersistedSubagents(record?.subagents),
      blocksNewTurn: false,
      steeringSupported: false,
    };
  }
  return {
    messages,
    session: turn.session ?? record?.session ?? undefined,
    serviceTierEffective: turn.serviceTierEffective,
    requestId: turn.requestId,
    draft: turn.blocksNewTurn ? hydrateDraft(turn.draft) : null,
    approvals: turn.approvals,
    userInputs: turn.userInputs,
    subagents: mergeLiveSubagents(
      projectPersistedSubagents(record?.subagents),
      turn.liveSubagents
    ),
    blocksNewTurn: turn.blocksNewTurn,
    cleanup: turn.cleanup,
    persist: turn.persist,
    terminal: turn.terminal,
    phase: turn.phase,
    retryToken: turn.retryToken,
    allowedActions: turn.allowedActions,
    assistantSeq: turn.assistantSeq,
    steeringSupported: turn.steeringSupported,
  };
}

export function applyTurnEvent(
  projection: ChatTurnProjection,
  event: AgentEvent
): ChatTurnProjection {
  if (event.type === "turn-state-changed") {
    return {
      ...projection,
      requestId: event.turn.requestId,
      session: event.turn.session ?? projection.session,
      serviceTierEffective: event.turn.serviceTierEffective,
      draft: event.turn.blocksNewTurn
        ? hydrateDraft(event.turn.draft)
        : null,
      approvals: event.turn.approvals,
      userInputs: event.turn.userInputs,
      subagents: mergeLiveSubagents(
        projection.subagents,
        event.turn.liveSubagents
      ),
      blocksNewTurn: event.turn.blocksNewTurn,
      cleanup: event.turn.cleanup,
      persist: event.turn.persist,
      terminal: event.turn.terminal,
      phase: event.turn.phase,
      retryToken: event.turn.retryToken,
      allowedActions: event.turn.allowedActions,
      assistantSeq: event.turn.assistantSeq,
      steeringSupported: event.turn.steeringSupported,
    };
  }
  if (event.type === "session") {
    return { ...projection, session: event.session };
  }
  if (event.type === "service-tier-effective") {
    return { ...projection, serviceTierEffective: event.effective };
  }
  if (event.type === "item-delta" && projection.draft) {
    return { ...projection, draft: applyDelta(projection.draft, event.itemId, event.text) };
  }
  if (event.type === "item" && projection.draft) {
    return { ...projection, draft: applyItem(projection.draft, event.item) };
  }
  if (event.type === "item-removed" && projection.draft) {
    return {
      ...projection,
      draft: applyItemRemoved(projection.draft, event.itemId),
    };
  }
  if (event.type === "approval-requested") {
    return {
      ...projection,
      approvals: projection.approvals.some(
        (approval) => approval.approvalId === event.approval.approvalId
      )
        ? projection.approvals
        : [...projection.approvals, event.approval],
    };
  }
  if (event.type === "approval-closed") {
    return {
      ...projection,
      approvals: projection.approvals.filter(
        (approval) => approval.approvalId !== event.approvalId
      ),
    };
  }
  if (event.type === "user-input-requested") {
    const rest = projection.userInputs.filter(
      (request) => request.userInputId !== event.request.userInputId
    );
    return { ...projection, userInputs: [event.request, ...rest] };
  }
  if (event.type === "user-input-closed") {
    return {
      ...projection,
      userInputs: projection.userInputs.filter(
        (request) => request.userInputId !== event.userInputId
      ),
    };
  }
  if (event.type === "subagent-update") {
    const current = projection.subagents[event.agent.agentThreadId];
    return {
      ...projection,
      draft: projection.draft
        ? applySubagent(projection.draft, event.agent)
        : projection.draft,
      subagents: {
        ...projection.subagents,
        [event.agent.agentThreadId]: {
          meta: projectSubagentMeta(event.agent),
          detailState: event.detailState,
          draft:
            event.detailState === "unavailable"
              ? null
              : current?.draft ?? null,
        },
      },
    };
  }
  if (
    event.type === "subagent-item" ||
    event.type === "subagent-item-delta"
  ) {
    const current = projection.subagents[event.agentThreadId];
    if (!current) {
      return projection;
    }
    if (current.detailState === "unavailable" || !current.draft) {
      return {
        ...projection,
        subagents: {
          ...projection.subagents,
          [event.agentThreadId]: {
            ...current,
            meta: projectSubagentMeta(event.agent),
          },
        },
      };
    }
    const draft =
      event.type === "subagent-item"
        ? applyItem(current.draft, event.item)
        : applyDelta(current.draft, event.itemId, event.text);
    return {
      ...projection,
      subagents: {
        ...projection.subagents,
        [event.agentThreadId]: {
          ...current,
          meta: projectSubagentMeta(event.agent),
          draft,
        },
      },
    };
  }
  if (event.type === "turn-persisted") {
    return {
      ...projection,
      messages: event.assistantMessage
        ? mergeChatMessages(projection.messages, [event.assistantMessage])
        : projection.messages,
      subagents: event.subagents !== undefined
        ? projectPersistedSubagents(event.subagents)
        : projection.subagents,
      terminal: event.terminal,
      persist: event.outcome,
      cleanup: event.cleanup,
      blocksNewTurn: event.blocksNewTurn,
      draft: event.blocksNewTurn ? projection.draft : null,
    };
  }
  return projection;
}
