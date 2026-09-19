/**
 * [INPUT]: Depends on React effects, the shared warm-intent contract, preload window.agentConnections, and the canonical settingsStore snapshot
 * [OUTPUT]: Provides warmAgentConnection with a dedupe that expires with the pool's idle close, useConversationWarmup (800 ms dwell), useComposerWarmup (focus) and the test-only resetWarmIntentDedupe, all suppressed while the Lab switch is off
 * [POS]: lib's IPC boundary for Agent connection warm-up; components must never touch the channel, and nothing observes connection state
 */

import { useCallback, useEffect } from "react";
import type {
  AgentConnectionsBridgeApi,
  WarmIntent,
} from "../../shared/agent-connections-ipc";
import { settingsStore } from "./settings-store";

declare global {
  interface Window {
    agentConnections?: AgentConnectionsBridgeApi;
  }
}

/** 打开会话后停留这么久才算「用户真的进来了」；侧栏快速滑动不触发（PRD Q2）。 */
export const WARM_DWELL_MS = 800;

/** 去重的有效期，镜像连接池的闲置关闭时限（PRD §4.4）：过了这段时间
    池里那条连接已经自己关掉了，再次聚焦理应重新预热而不是被当成重复。 */
export const WARM_DEDUPE_MS = 5 * 60_000;

const intentKey = (intent: WarmIntent) =>
  `${intent.backend}:${intent.conversationId}`;

/* ============================================================
 * 一个会话只值得一次预热意图：停留计时器与 composer 聚焦是同一个
 * 事实的两条路径，谁先到谁发，另一条就该闭嘴。只记最后一次而不是
 * 一张会无限增长的表——重新回到上一个会话本就该再说一次，那时池里
 * 的连接可能已经按闲置规则关掉了。
 *
 * 去重带时限，否则它会比连接活得久：在同一条会话里读上十分钟再回来
 * 敲字，池早已按 5 分钟闲置把连接关了，而这里仍认为「发过了」——于是
 * 那一轮又回到冷路径，恰好是本功能要消灭的那次等待。
 * ============================================================ */
let lastIntentKey: string | null = null;
let lastIntentAt = 0;

export function resetWarmIntentDedupe() {
  lastIntentKey = null;
  lastIntentAt = 0;
}

/** 发出一次预热意图；开关关闭、后端未定或本会话已发过时什么也不做。 */
export function warmAgentConnection(intent: WarmIntent | null): boolean {
  if (!intent || !intent.conversationId) return false;
  if (!settingsStore.getSnapshot().settings?.agentConnectionsEnabled) return false;
  const key = intentKey(intent);
  const now = Date.now();
  if (key === lastIntentKey && now - lastIntentAt < WARM_DEDUPE_MS) return false;
  const bridge = window.agentConnections;
  if (!bridge) return false;
  lastIntentKey = key;
  lastIntentAt = now;
  bridge.warm(intent);
  return true;
}

/** 会话视图停留满 800 ms 即预热；期间切走或换后端即取消重新起算。 */
export function useConversationWarmup(intent: WarmIntent | null) {
  const conversationId = intent?.conversationId ?? null;
  const backend = intent?.backend ?? null;
  useEffect(() => {
    if (!conversationId || !backend) return;
    const timer = setTimeout(
      () => warmAgentConnection({ conversationId, backend }),
      WARM_DWELL_MS
    );
    return () => clearTimeout(timer);
  }, [backend, conversationId]);
}

/** Composer 拿到焦点就不必再等停留计时器：用户已经在准备说话了。 */
export function useComposerWarmup(intent: WarmIntent | null) {
  const conversationId = intent?.conversationId ?? null;
  const backend = intent?.backend ?? null;
  return useCallback(() => {
    if (!conversationId || !backend) return;
    warmAgentConnection({ conversationId, backend });
  }, [backend, conversationId]);
}
