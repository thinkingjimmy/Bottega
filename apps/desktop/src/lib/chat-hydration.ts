/**
 * [INPUT]: Depends on the shared AgentWorkspaceScope and BackendInfo contracts
 * [OUTPUT]: Keeps attach/load hydration independent of shared Agent sendability and resolves persisted workspace scope without optimistic promotion.
 * [POS]: Sole hydration coordinator in the renderer; answers only whether the chat ledger and attach data have both arrived, not whether the user can type right now
 */
import { submissionDecision } from "../../shared/agent-availability/projection";


import type {
  AgentWorkspaceScope,
  BackendInfo,
} from "../../shared/agent-ipc";

export type BackendAvailability = "checking" | "ready" | "unavailable";

export function backendAvailability(
  backend: BackendInfo | undefined,
  checking: boolean
): BackendAvailability {
  if (!backend) return checking ? "checking" : "unavailable";
  const decision = submissionDecision(backend, Date.now());
  return decision.decision === "allow" ? "ready" : decision.decision === "wait" ? "checking" : "unavailable";
}

export type DraftWorkspaceScope = Exclude<
  AgentWorkspaceScope,
  { kind: "conversation" }
>;

/* ============================================================
 * 水合 = 「账本与 attach 两路数据到齐了吗」，仅此而已。
 *
 * 这里曾经还带一个 `blocksNewTurn`，把「registry 里有活动 turn」也算作
 * 输入禁用的理由。那在消息队列出现之前是对的——那时「打字」只有一种去处
 * 就是开新 turn。队列与 steering 落地后这个等价关系被亲手拆开了：运行中
 * 打字的去处是**入队**，而入队恰恰只有运行中才有意义。判据留在旧语义上，
 * 结果是队列永远收不到条目、steer 永远没有可插入的对象——两个功能同时
 * 不可达。协议事实（有没有活动 turn）从此只由 ChatStatus 表达，水合不再
 * 兼职回答 UI 问题。
 * ============================================================ */
export type ChatHydration = {
  generation: number;
  chatLoaded: boolean;
  attachReplayed: boolean;
};

export const createChatHydration = (generation: number): ChatHydration => ({
  generation,
  chatLoaded: false,
  attachReplayed: false,
});

export function updateChatHydration(
  state: ChatHydration,
  generation: number,
  patch: Partial<Omit<ChatHydration, "generation">>
) {
  return state.generation === generation ? { ...state, ...patch } : state;
}

export const hydrationReady = (state: ChatHydration) =>
  state.chatLoaded && state.attachReplayed;

export function chatWorkspaceScope(
  conversationId: string,
  persisted: boolean,
  draftScope: DraftWorkspaceScope
): AgentWorkspaceScope {
  return persisted
    ? { kind: "conversation", conversationId }
    : draftScope;
}
