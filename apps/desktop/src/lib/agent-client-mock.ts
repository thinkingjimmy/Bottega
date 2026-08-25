/**
 * [INPUT]: Depends on nanoid, shared agent-ipc/chats
 * [OUTPUT]: Provides createBrowserAgentBridge to remove the purely browser-degraded fake AgentBridgeApi, explicitly rejecting Section citations and syntax attach event streams and broadcast session activities
 * [POS]: The web browser is downloadableThe only backup agent-client in the absence of window.agent is the projection layer without any perception of the real bridge
 */

import { nanoid } from "nanoid";
import {
  applyDelta,
  applyItem,
  applySubagent,
  createDraft,
  serializeDraft,
  type TurnDraft,
} from "../../shared/chat-turn-reducer";
import type {
  AgentBridgeApi,
  AgentEvent,
  AgentEventBody,
  AgentLiveSubagent,
  ChatActivityEvent,
  TurnSnapshot,
} from "../../shared/agent-ipc";
import type { ChatPart, PersistedSubagent } from "../../shared/chats-ipc";

const MOCK_REPLY =
  "当前运行在纯浏览器环境，已回落到 **mock 流式回复**。请用 Electron 启动以连接本机 Codex CLI。";
const CHUNK_SIZE = 3;
const CHUNK_INTERVAL_MS = 40;

type MockTurn = {
  conversationId: string;
  requestId: string;
  itemId: string;
  draft: TurnDraft;
  startedAt: number;
  subagents: Record<string, AgentLiveSubagent>;
  timer: ReturnType<typeof setInterval>;
};

const mockSubagents = (startedAt: number) => {
  const specs = [
    {
      id: "mock-frontend-plugin",
      name: "Frontend plugin",
      status: "running" as const,
      text: "哥，我正在核对前端路由、第三栏布局和实时投影。",
    },
    {
      id: "mock-backend-contracts",
      name: "Backend contracts",
      status: "running" as const,
      text: "哥，我正在检查 app-server 事件与持久化边界。",
    },
    {
      id: "mock-requirements",
      name: "Requirements consistency",
      status: "completed" as const,
      text: "哥，需求核对完成：chip、详情、列表与算法头像边界一致。",
    },
  ];
  return Object.fromEntries(
    specs.map((spec, index) => {
      const draft = applyItem(createDraft(startedAt + index), {
        itemId: `${spec.id}-message`,
        kind: "agent-message",
        title: "Replied",
        text: spec.text,
        status: "completed",
      });
      return [
        spec.id,
        {
          meta: {
            agentThreadId: spec.id,
            name: spec.name,
            status: spec.status,
            spawnedAt: startedAt + index,
            lastActivityAt: startedAt + index,
          },
          detailState: "available" as const,
          draft: serializeDraft(draft),
        },
      ];
    })
  ) as Record<string, AgentLiveSubagent>;
};

const persistMockSubagents = (
  subagents: Record<string, AgentLiveSubagent>,
  now: number
): Record<string, PersistedSubagent> =>
  Object.fromEntries(
    Object.entries(subagents).map(([id, agent]) => [
      id,
      {
        meta: {
          ...agent.meta,
          status:
            agent.meta.status === "completed" ? "completed" : "interrupted",
          lastActivityAt: now,
        },
        parts: (agent.draft?.parts ?? []).map((part): ChatPart => {
          if (part.type === "text") return part;
          return {
            ...part,
            status: part.status === "running" ? "failed" : part.status,
          };
        }),
      },
    ])
  );

/**
 * 假 bridge 与真 main 走同一条 attach 事件流（turn-state-changed →
 * item-delta* → item → turn-persisted），renderer 的投影因此不需要
 * 任何"浏览器分支"——降级的差异被封死在本模块内。
 */
export function createBrowserAgentBridge(): AgentBridgeApi {
  let seq = 0;
  const listeners = new Set<(event: AgentEvent) => void>();
  const activityListeners = new Set<(event: ChatActivityEvent) => void>();
  const turns = new Map<string, MockTurn>();

  const emit = (conversationId: string, body: AgentEventBody) => {
    const event: AgentEvent = { ...body, conversationId, seq: ++seq };
    for (const listener of [...listeners]) listener(event);
  };

  const emitActivity = (event: ChatActivityEvent) => {
    for (const listener of [...activityListeners]) listener(event);
  };

  const snapshotOf = (turn: MockTurn): TurnSnapshot => ({
    requestId: turn.requestId,
    assistantSeq: 2,
    steeringSupported: false,
    phase: "active",
    cleanup: "pending",
    persist: "unprepared",
    blocksNewTurn: true,
    draft: serializeDraft(turn.draft),
    approvals: [],
    userInputs: [],
    liveSubagents: turn.subagents,
  });

  const settle = (turn: MockTurn, terminal: "done" | "cancelled") => {
    clearInterval(turn.timer);
    turns.delete(turn.conversationId);
    const now = Date.now();
    const subagents = persistMockSubagents(turn.subagents, now);
    emit(turn.conversationId, {
      requestId: turn.requestId,
      type: "turn-persisted",
      terminal,
      outcome: terminal === "done" ? "stored" : "empty",
      blocksNewTurn: false,
      cleanup: "complete",
      ...(terminal === "done"
        ? {
            assistantMessage: {
              id: `assistant_${turn.itemId}`,
              role: "assistant" as const,
              content: MOCK_REPLY,
              parts: Object.values(subagents).map((agent) => ({
                type: "subagent" as const,
                itemId: `subagent:${agent.meta.agentThreadId}`,
                agentThreadId: agent.meta.agentThreadId,
                name: agent.meta.name,
                status:
                  agent.meta.status === "completed"
                    ? "completed" as const
                    : "failed" as const,
              })),
              durationMs: now - turn.startedAt,
              createdAt: now,
              seq: 2,
            },
            subagents,
          }
        : {}),
    });
    emitActivity({
      conversationId: turn.conversationId,
      running: false,
      waiting: false,
      terminal,
    });
  };

  return {
    async send(payload) {
      if (payload.input.some((item) => item.type === "section")) {
        throw new Error("浏览器演示不支持 Section 引用，请使用 Electron 桌面端");
      }
      const conversationId = payload.scope.conversationId;
      if (turns.has(conversationId)) {
        throw new Error("当前聊天已有请求正在执行");
      }
      const chunks = Array.from(MOCK_REPLY);
      let cursor = 0;
      const startedAt = Date.now();
      const subagents = mockSubagents(startedAt);
      let draft = createDraft(startedAt);
      for (const agent of Object.values(subagents)) {
        draft = applySubagent(draft, agent.meta);
      }
      const turn: MockTurn = {
        conversationId,
        requestId: payload.requestId,
        itemId: nanoid(),
        draft,
        startedAt,
        subagents,
        timer: setInterval(() => {
          if (cursor < chunks.length) {
            const text = chunks.slice(cursor, cursor + CHUNK_SIZE).join("");
            cursor += CHUNK_SIZE;
            turn.draft = applyDelta(turn.draft, turn.itemId, text);
            emit(conversationId, {
              requestId: turn.requestId,
              type: "item-delta",
              itemId: turn.itemId,
              text,
            });
            return;
          }
          emit(conversationId, {
            requestId: turn.requestId,
            type: "item",
            item: {
              itemId: turn.itemId,
              kind: "agent-message",
              title: "Replied",
              text: MOCK_REPLY,
              status: "completed",
            },
          });
          settle(turn, "done");
        }, CHUNK_INTERVAL_MS),
      };
      turns.set(conversationId, turn);
      emit(conversationId, {
        requestId: turn.requestId,
        type: "turn-state-changed",
        turn: snapshotOf(turn),
      });
      emitActivity({ conversationId, running: true, waiting: false });
    },
    cancel(requestId) {
      for (const turn of turns.values()) {
        if (turn.requestId === requestId) settle(turn, "cancelled");
      }
    },
    respondApproval: async () => {},
    respondUserInput: async () => {},
    attachTurn: async (conversationId) => {
      const turn = turns.get(conversationId);
      return {
        lastSeq: seq,
        turn: turn ? snapshotOf(turn) : null,
        steerIntents: [],
      };
    },
    detachTurn: () => {},
    abandonFatalTurn: async () => {},
    acknowledgeCleanupFailure: async () => {},
    retryWithoutSession: async () => {},
    onEvent(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    onActivity(callback) {
      activityListeners.add(callback);
      return () => activityListeners.delete(callback);
    },
    listActivity: async () =>
      [...turns.keys()].map((conversationId) => ({
        conversationId,
        waiting: false,
      })),
    steer: async (input) => ({
      outcome: "unconsumed",
      outboxRef: input.outboxRef,
      reason: "browser mock does not support steering",
      derivedIntentId: `mock-manual-${input.outboxRef}`,
    }),
    decideSteer: async (input) => ({
      outcome: "failed",
      outboxRef: input.outboxRef,
      reason: "browser mock has no durable steer outbox",
    }),
    ackSteerIntents: async () => {},
  };
}
