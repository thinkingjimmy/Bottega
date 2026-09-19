/**
 * [INPUT]: Depends on React external-store hooks, Agent activity identities, and main-authorized presence consumption broadcasts.
 * [OUTPUT]: Provides per-chat/global activity, ordered stream/snapshot hydration, identity-scoped consumption watermarks, and active Chat claims.
 * [POS]: Renderer-lifetime activity owner; delayed snapshots and events cannot resurrect already consumed results.
 */

import type { PresentedChat, PresenceBridge } from "../../shared/presence-ipc";

declare global { interface Window { presence?: PresenceBridge; } }

import { useCallback, useSyncExternalStore } from "react";
import type {
  ChatActivityEvent,
  ChatActivitySnapshot,
} from "../../shared/agent-ipc";

/**
 * waiting=问号（agent 停下来等你回话），running=转圈，
 * done=蓝点（有新回复），failed=黄色警告（错误/取消）。缺省即后端 logo。
 *
 * waiting 压过 running：turn 确实还没结束，但「还在算」与「卡在你身上」
 * 对用户是两件事，后者要求行动。
 */
export type ChatActivity = "waiting" | "running" | "done" | "failed";

const entries = new Map<string, ChatActivity>();
// 订阅期内事件流已覆盖的会话集。entries 里「没有条目」承载两种语义：
// 「从未听说」与「已听说并消费清空」（活跃会话跑完即消费）。prime 的快照
// 生成于 main 读表那一刻，抵达 renderer 时可能已比事件流旧——分不清这
// 两种空，就会把已结束的会话填回 running，侧边栏从此永久转圈。
const seen = new Set<string>();
const terminalIdentities = new Map<string, PresentedChat>();
const consumedThrough = new Map<string, PresentedChat>();
const consumptionKey = (chatId: string, sourceId?: string) => JSON.stringify([chatId, sourceId ?? "local"]);
let stopConsumption: (() => void) | null = null;

function ensureConsumption() {
  if (stopConsumption || typeof window === "undefined" || !window.presence) return;
  const stop = window.presence.onConsumed((receipt) => {
    const previous = consumedThrough.get(consumptionKey(receipt.chatId, receipt.sourceId));
    if (!previous || receipt.terminalSeq > previous.terminalSeq) consumedThrough.set(consumptionKey(receipt.chatId, receipt.sourceId), { ...receipt });
    const current = terminalIdentities.get(receipt.chatId);
    if (current?.sourceId === receipt.sourceId && current?.incarnationId === receipt.incarnationId && current.requestId === receipt.requestId &&
        current.generation === receipt.generation && current.terminalSeq === receipt.terminalSeq) {
      terminalIdentities.delete(receipt.chatId); write(receipt.chatId, null);
    }
  });
  const refresh = () => consumeSettled(activeChatId());
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  stopConsumption = () => { stop(); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
}
const listeners = new Map<string, Set<() => void>>();
const globalListeners = new Set<() => void>();
let cachedSnapshot: ReadonlyMap<string, ChatActivity> = new Map();
/* ── 活跃声明栈：谁在看、看哪条，各自声明、各自撤销 ────────────────
 * 「用户此刻停留在哪条会话」曾是一个全局单槽加两个互不知情的写者
 * （chat 视图与全屏 Base 宿主），卸载时无条件写 null——任何挂载交错
 * 都会把别人的声明一并抹掉，用户盯着看完的会话就此误亮蓝点。
 * 声明栈让「卸载时该清谁」这个问题消失：claim 压栈、release 只撤自己，
 * 活跃值恒为栈顶；声明被覆盖后再恢复（关闭 Base 回到 chat）也重新
 * 消费终态——视线回来那一刻，「已完成」就是已读。
 * 当前会话只消费终态结果；waiting/running 是实时状态，不是未读标记。 */
const activeClaims: { chatId: string }[] = [];

const activeChatId = () => activeClaims.at(-1)?.chatId ?? null;

function consumeSettled(chatId: string | null) {
  ensureConsumption();
  if (!chatId || typeof window === "undefined" || !window.presence) return;
  const receipt = terminalIdentities.get(chatId);
  const visible = document.visibilityState === "visible" && document.hasFocus();
  void window.presence.presented(visible && receipt ? receipt : null).catch(() => {});
}

function write(chatId: string, activity: ChatActivity | null) {
  if (entries.get(chatId) === (activity ?? undefined)) return;
  if (activity) entries.set(chatId, activity);
  else entries.delete(chatId);
  cachedSnapshot = new Map(entries);
  for (const listener of listeners.get(chatId) ?? []) listener();
  for (const listener of globalListeners) listener();
}

const settled = (event: ChatActivityEvent): ChatActivity =>
  event.terminal === "cancelled" || event.terminal === "error"
    ? "failed"
    : "done";

function wasConsumed(event: ChatActivityEvent) {
  const receipt = consumedThrough.get(consumptionKey(event.conversationId, event.sourceId));
  if (!receipt || event.incarnationId !== receipt.incarnationId) return false;
  if (event.requestId === receipt.requestId && event.generation !== undefined) {
    if (event.generation !== receipt.generation) return event.generation < receipt.generation;
    return event.terminalSeq === undefined || event.terminalSeq <= receipt.terminalSeq;
  }
  return event.terminalSeq !== undefined && event.terminalSeq < receipt.terminalSeq;
}

export function receiveChatActivity(event: ChatActivityEvent) {
  ensureConsumption();
  if (wasConsumed(event)) return;
  seen.add(event.conversationId);
  const previous = terminalIdentities.get(event.conversationId);
  if (previous && previous.sourceId === event.sourceId && event.requestId === previous.requestId && event.generation !== undefined && event.generation < previous.generation) return;
  if (event.running) {
    // 待你回话是活态而非未读标记，停留在该会话也照常显示——
    // 蓝点才是"你没看过的结果"，问号是"它正等着你"。
    terminalIdentities.delete(event.conversationId);
    write(event.conversationId, event.waiting ? "waiting" : "running");
    return;
  }
  if (!event.terminal) { clearChatActivity(event.conversationId); return; }
  if (event.incarnationId && event.requestId && event.generation && event.terminalSeq) {
    terminalIdentities.set(event.conversationId, { chatId: event.conversationId, incarnationId: event.incarnationId,
      requestId: event.requestId, generation: event.generation, terminalSeq: event.terminalSeq, ...(event.sourceId ? { sourceId: event.sourceId } : {}) });
  }
  write(event.conversationId, settled(event));
  if (event.conversationId === activeChatId()) consumeSettled(event.conversationId);
}

export function connectChatActivity(ports: {
  subscribe(listener: (event: ChatActivityEvent) => void): () => void;
  read(): Promise<ChatActivitySnapshot[]>;
}) {
  // Both streams must be attached before the main process captures the initial snapshot.
  ensureConsumption();
  let active = true;
  const unsubscribe = ports.subscribe(receiveChatActivity);
  void Promise.resolve().then(() => ports.read()).then((snapshots) => {
    if (active) primeChatActivity(snapshots);
  }).catch(() => {});
  return () => { active = false; unsubscribe(); };
}

/**
 * main 冷启动/窗口重载后对齐正在运行的会话集。
 * 快照永远比订阅期内收到的事件旧，所以只填「事件流从未提过」的会话；
 * seen 里有的一律跳过——哪怕条目已被消费清空，「空」也是比快照新的真相。
 */
export function primeChatActivity(snapshots: ChatActivitySnapshot[]) {
  for (const snapshot of snapshots) {
    const { conversationId } = snapshot;
    if (!entries.has(conversationId) && !seen.has(conversationId)) {
      receiveChatActivity({ ...snapshot, running: snapshot.running ?? true });
    }
  }
}

export function clearChatActivity(chatId: string) {
  terminalIdentities.delete(chatId);
  write(chatId, null);
}

/**
 * 声明「用户正停留在这条会话」，返回撤销句柄；进入与恢复均消费 done/failed。
 * effect 用法：`useEffect(() => claimActiveChat(id), [id])`——cleanup 即 release。
 */
export function claimActiveChat(chatId: string): () => void {
  const claim = { chatId };
  activeClaims.push(claim);
  consumeSettled(chatId);
  return () => {
    const index = activeClaims.indexOf(claim);
    if (index !== -1) activeClaims.splice(index, 1);
    consumeSettled(activeChatId());
  };
}

export function subscribeChatActivity(chatId: string, listener: () => void) {
  const current = listeners.get(chatId) ?? new Set<() => void>();
  current.add(listener);
  listeners.set(chatId, current);
  return () => {
    current.delete(listener);
    if (current.size === 0) listeners.delete(chatId);
  };
}

export function readChatActivity(chatId: string): ChatActivity | undefined {
  return entries.get(chatId);
}

export function subscribeAllChatActivity(listener: () => void) {
  globalListeners.add(listener);
  return () => globalListeners.delete(listener);
}

export function readAllChatActivity() {
  return cachedSnapshot;
}

export function useChatActivity(chatId: string) {
  const subscribe = useCallback(
    (listener: () => void) => subscribeChatActivity(chatId, listener),
    [chatId]
  );
  const getSnapshot = useCallback(() => readChatActivity(chatId), [chatId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 仅测试使用：抹平模块级状态。 */
export function resetChatActivityStoreForTests() {
  const chatIds = [...entries.keys()];
  entries.clear();
  terminalIdentities.clear();
  consumedThrough.clear();
  stopConsumption?.(); stopConsumption = null;
  seen.clear();
  cachedSnapshot = new Map();
  activeClaims.length = 0;
  for (const chatId of chatIds) {
    for (const listener of listeners.get(chatId) ?? []) listener();
  }
  for (const listener of globalListeners) listener();
}
