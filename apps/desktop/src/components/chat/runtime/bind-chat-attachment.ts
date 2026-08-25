/**
 * [INPUT]: Depends on React setter/ref interface, Codex attach client, chat turn/ and ask questions about projection and hydration
 * [OUTPUT]: Provides bindChatAttachment; New generation synchronizes release of old request/Steer projections, and then sort attach/getChat/replay, record identity release, channel level item/delta stream with explicitly hydrated chat/session state
 * [POS]: The main-owned turn-binding device for chat/runtime isolates the long lifecycle protocol from the use-chat-session arrangement; Only after reading the chat booklet is the ID released
 */

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ChatStatus } from "ai";
import type { ChatMessage, ChatRecord } from "../../../../shared/chats-ipc";
import type {
  AgentBackendId,
  AgentApprovalRequest,
  AgentEvent,
  SessionRef,
  SteerOutboxProjection,
} from "../../../../shared/agent-ipc";
import type { TurnDraft } from "../../../../shared/chat-turn-reducer";
import { attachToAgent, type CodexRequest } from "@/lib/agent-client";
import {
  applyTurnEvent,
  mergeChatMessages,
  projectionFromSnapshot,
  projectionStatusOf,
  type ChatProjectionStatus,
  type ChatTurnProjection,
  type ProjectedSubagent,
} from "@/lib/chat-turn-attach";
import {
  createChatHydration,
  updateChatHydration,
  type ChatHydration,
} from "@/lib/chat-hydration";
import { errorMessage } from "@/lib/errors";
import { projectPendingUserInput } from "@/lib/chat-user-input-state";
import { primeChatMessages } from "@/lib/chat-messages-store";
import {
  messageId,
  type PendingPlanDecisionState,
  type PendingUserInputState,
} from "./chat-session-model";

type Setter<T> = Dispatch<SetStateAction<T>>;
export type BufferedProjectionEvent = Extract<
  AgentEvent,
  {
    type:
      | "item"
      | "item-delta"
      | "subagent-item"
      | "subagent-item-delta";
  }
>;

function projectionEventKey(event: BufferedProjectionEvent) {
  if (event.type === "item") return `item:${event.item.itemId}`;
  if (event.type === "item-delta") return `delta:${event.itemId}`;
  if (event.type === "subagent-item") {
    return `subagent-item:${event.agentThreadId}:${event.item.itemId}`;
  }
  return `subagent-delta:${event.agentThreadId}:${event.itemId}`;
}

export function coalesceProjectionEvent(
  pending: readonly BufferedProjectionEvent[],
  event: BufferedProjectionEvent
) {
  const next = [...pending];
  const last = next.at(-1);
  if (!last || projectionEventKey(last) !== projectionEventKey(event)) {
    next.push(event);
    return next;
  }
  if (
    (last.type === "item-delta" && event.type === "item-delta") ||
    (last.type === "subagent-item-delta" &&
      event.type === "subagent-item-delta")
  ) {
    next[next.length - 1] = {
      ...event,
      text: `${last.text}${event.text}`,
    };
  } else {
    next[next.length - 1] = event;
  }
  return next;
}

export type ChatAttachmentBinding = {
  chatId: string;
  getChat: (chatId: string) => Promise<ChatRecord | null>;
  onRecordAgent?: (agent: AgentBackendId) => void;
  onRecord?: (record: ChatRecord | null) => void;
  onSteerSnapshot?: (intents: SteerOutboxProjection[]) => void;
  refs: {
    generation: MutableRefObject<number>;
    projection: MutableRefObject<ChatTurnProjection>;
    messages: MutableRefObject<ChatMessage[]>;
    draft: MutableRefObject<TurnDraft | null>;
    request: MutableRefObject<CodexRequest | null>;
    recordExists: MutableRefObject<boolean>;
    incarnationId?: MutableRefObject<string | null>;
  };
  set: {
    hydration: Setter<ChatHydration>;
    projectionStatus: (next: ChatProjectionStatus) => void;
    hydratedChatId: Setter<string | null>;
    loading: Setter<boolean>;
    persisted: Setter<boolean>;
    messages: Setter<ChatMessage[]>;
    session: Setter<SessionRef | undefined>;
    draft: Setter<TurnDraft | null>;
    subagents: Setter<Record<string, ProjectedSubagent>>;
    approvals: Setter<AgentApprovalRequest[]>;
    activeRequestId: Setter<string | null>;
    status: Setter<ChatStatus>;
    pendingUserInput: Setter<PendingUserInputState | null>;
    pendingPlanDecision: Setter<PendingPlanDecisionState | null>;
    cancelPending: Setter<boolean>;
    approvalBusy: Setter<boolean>;
    approvalError: Setter<string>;
    queued: Setter<boolean>;
    queueNotice: Setter<string>;
  };
};

const emptyProjection = (): ChatTurnProjection => ({
  messages: [],
  draft: null,
  approvals: [],
  userInputs: [],
  subagents: {},
  blocksNewTurn: true,
  steeringSupported: false,
});

const localError = (content: string): ChatMessage => ({
  id: messageId("assistant"),
  role: "assistant",
  content,
  isError: true,
  createdAt: Date.now(),
  seq: Number.MAX_SAFE_INTEGER,
});

export function bindChatAttachment(binding: ChatAttachmentBinding) {
  const { refs, set } = binding;
  let active = true;
  let record: ChatRecord | null = null;
  let snapshot: Parameters<typeof projectionFromSnapshot>[1] = null;
  const generation = ++refs.generation.current;
  /* 同一 hook 原位切 chat 时，旧请求与旧 Steer 投影都属于上一代身份。
     新 attach 先清权威句柄，再异步读取新 chat；未知期间必须 fail closed。 */
  refs.request.current?.dispose();
  refs.request.current = null;
  set.activeRequestId(null);
  binding.onSteerSnapshot?.([]);
  set.hydration(createChatHydration(generation));
  set.hydratedChatId(null);
  set.loading(true);
  refs.projection.current = emptyProjection();

  // 本地错误提示同样必须并入投影——直写 set.messages 会被下一个事件的全量投影覆盖
  const appendLocalError = (content: string) => {
    refs.projection.current = {
      ...refs.projection.current,
      messages: mergeChatMessages(refs.projection.current.messages, [
        localError(content),
      ]),
    };
    refs.messages.current = refs.projection.current.messages;
    set.messages(refs.messages.current);
  };

  const project = (next: ChatTurnProjection) => {
    if (!active || refs.generation.current !== generation) return;
    const projected = next;
    refs.projection.current = projected;
    refs.messages.current = projected.messages;
    refs.draft.current = projected.draft;
    set.messages(projected.messages);
    set.session(projected.session);
    set.draft(projected.draft);
    set.subagents(projected.subagents);
    set.approvals(projected.approvals);
    set.activeRequestId(projected.blocksNewTurn ? projected.requestId ?? null : null);
    set.status(projected.blocksNewTurn ? "streaming" : "ready");
    set.pendingUserInput((current) =>
      projectPendingUserInput(current, projected.userInputs)
    );
    if (projected.requestId) {
      set.queued(false);
      set.queueNotice("");
    }
    set.projectionStatus(projectionStatusOf(projected));
  };

  let pendingEvents: BufferedProjectionEvent[] = [];
  let scheduled:
    | { kind: "frame"; id: number }
    | { kind: "timer"; id: number }
    | null = null;

  const flushEvents = () => {
    if (scheduled?.kind === "frame") {
      window.cancelAnimationFrame(scheduled.id);
    } else if (scheduled) {
      window.clearTimeout(scheduled.id);
    }
    scheduled = null;
    if (pendingEvents.length === 0) return;
    let next = refs.projection.current;
    for (const event of pendingEvents) next = applyTurnEvent(next, event);
    pendingEvents = [];
    project(next);
  };

  const scheduleFlush = () => {
    if (scheduled) return;
    if (
      document.visibilityState === "visible" &&
      typeof window.requestAnimationFrame === "function"
    ) {
      scheduled = {
        kind: "frame",
        id: window.requestAnimationFrame(flushEvents),
      };
    } else {
      scheduled = {
        kind: "timer",
        id: window.setTimeout(flushEvents, 16),
      };
    }
  };

  const bufferEvent = (event: BufferedProjectionEvent) => {
    pendingEvents = coalesceProjectionEvent(pendingEvents, event);
    scheduleFlush();
  };

  const handleProjectedEvent = (event: AgentEvent) => {
    if (
      event.type === "item" ||
      event.type === "item-delta" ||
      event.type === "subagent-item" ||
      event.type === "subagent-item-delta"
    ) {
      bufferEvent(event);
      return;
    }
    flushEvents();
    project(applyTurnEvent(refs.projection.current, event));
    if (event.type !== "turn-persisted") return;
    refs.request.current?.dispose();
    refs.request.current = null;
    set.cancelPending(false);
    if (!["stored", "empty", "missing"].includes(event.outcome)) return;
    set.approvalBusy(false);
    set.approvalError("");
    if (
      event.assistantMessage?.role === "assistant" &&
      event.assistantMessage.kind === "plan"
    ) {
      set.pendingPlanDecision({
        messageId: event.assistantMessage.id,
        busy: false,
        error: "",
      });
    }
  };

  const attachment = attachToAgent(binding.chatId, {
    onSnapshot(result) {
      flushEvents();
      snapshot = result.turn;
      binding.onSteerSnapshot?.(result.steerIntents);
      project(projectionFromSnapshot(record, snapshot, refs.projection.current.messages));
    },
    onEvent: handleProjectedEvent,
  });

  void attachment.ready.then(
    () => {
      if (active) {
        set.hydration((current) =>
          updateChatHydration(current, generation, { attachReplayed: true })
        );
      }
    },
    (cause) => {
      if (!active) return;
      appendLocalError(`**运行状态接管失败：** ${errorMessage(cause)}`);
    }
  );

  void binding.getChat(binding.chatId)
    .then((nextRecord) => {
      if (!active) return;
      record = nextRecord;
      binding.onRecord?.(record);
      if (record) primeChatMessages(record);
      if (record) binding.onRecordAgent?.(record.agent);
      refs.recordExists.current = Boolean(record);
      if (refs.incarnationId) {
        refs.incarnationId.current = record?.incarnationId ?? null;
      }
      set.persisted(Boolean(record));
      project(projectionFromSnapshot(record, snapshot, refs.projection.current.messages));
    })
    .catch((cause) => {
      if (!active) return;
      refs.recordExists.current = false;
      if (refs.incarnationId) refs.incarnationId.current = null;
      appendLocalError(`**聊天加载失败：** ${errorMessage(cause)}`);
    })
    .finally(() => {
      if (!active) return;
      set.hydratedChatId(binding.chatId);
      set.loading(false);
      set.hydration((current) =>
        updateChatHydration(current, generation, { chatLoaded: true })
      );
    });

  return () => {
    active = false;
    if (scheduled?.kind === "frame") {
      window.cancelAnimationFrame(scheduled.id);
    } else if (scheduled) {
      window.clearTimeout(scheduled.id);
    }
    pendingEvents = [];
    attachment.dispose();
  };
}
