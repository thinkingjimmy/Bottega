/**
 * [INPUT]: Depends on the main BrowserWindow, renderer-scoped IPC, and the shared warm-intent schema
 * [OUTPUT]: Registers the main-window warm-intent channel and forwards validated intents to a connection sink
 * [POS]: Main admission boundary for Agent connection warm-up; owns no pool and answers nothing
 */

import type { BrowserWindow } from "electron";
import {
  AGENT_CONNECTIONS_CHANNEL,
  warmIntentSchema,
  type WarmIntent,
} from "../../shared/agent-connections-ipc";
import { rendererIpc } from "./ipc-registrar";

export type AgentConnectionSink = {
  warm(intent: WarmIntent): void;
};

/* ============================================================
 * 预热是纯粹的建议：池可以忽略它、可以失败、可以根本不存在。
 * 所以这条通道是 send 而非 invoke，且吞掉一切异常——renderer 既
 * 不等待也无处显示结果（PRD §3「失败态不打扰用户」、Q6「不加 UI」）。
 * 校验仍然照做：意图来自 renderer，畸形输入不该进到池里。
 * ============================================================ */
export function registerAgentConnections(
  window: BrowserWindow,
  rendererUrl: string,
  sink: AgentConnectionSink,
  { register = rendererIpc } = {}
) {
  register(rendererUrl, "Warm intents require the main window").on(
    AGENT_CONNECTIONS_CHANNEL.warm,
    (...args: unknown[]) => {
      if (window.isDestroyed() || args.length !== 1) return;
      const intent = warmIntentSchema.safeParse(args[0]);
      if (!intent.success) return;
      try {
        sink.warm(intent.data);
      } catch {
        /* 预热失败只会让下一轮回到冷路径，不该冒泡成一次 renderer 异常。 */
      }
    }
  );
}
