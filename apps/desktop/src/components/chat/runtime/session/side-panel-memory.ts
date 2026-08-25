/**
 * [INPUT]: Depends on the SidePanelState discrimination of the chat-session-model
 * [OUTPUT]: Provides retainable SidePanel to determine the boundary between the LRU recall/rememberSidePanel and the incarnation fence
 * [POS]: The third row of the chat/runtime/session is the cross-attached registry; Each chat only retains the latest known generation, and the unknown identity does not fit into the global memory
 */

import type { SidePanelState } from "../chat-session-model";

const CLOSED: SidePanelState = { kind: "none" };
const MAX_OPENED_PANELS = 64;

/*
 * 只有自证型面板配得上跨挂载复活：tabs 是一串纯 id，落盘 Plan 的内容自足。
 * 流式 Plan 锚在活体 draft item 上，File 预览锚在 composer 的 File 对象上——
 * 换一次挂载锚点就没了，记住它们等于向用户展示一具标本。
 */
export function retainableSidePanel(state: SidePanelState) {
  return state.kind === "tabs" || (state.kind === "plan" && !state.planItemId);
}

type RememberedSidePanel = {
  incarnationId: string;
  state: SidePanelState;
};

const opened = new Map<string, RememberedSidePanel>();

function touch(chatId: string, remembered: RememberedSidePanel) {
  opened.delete(chatId);
  opened.set(chatId, remembered);
}

function evictOldest() {
  while (opened.size > MAX_OPENED_PANELS) {
    const oldest = opened.keys().next().value;
    if (oldest === undefined) return;
    opened.delete(oldest);
  }
}

/** 未知世代不得覆盖已知记忆；已知新世代则取代旧世代。 */
export function rememberSidePanel(
  chatId: string,
  incarnationId: string | null,
  state: SidePanelState
) {
  if (incarnationId === null) return;
  if (!retainableSidePanel(state)) {
    opened.delete(chatId);
    return;
  }
  touch(chatId, { incarnationId, state });
  evictOldest();
}

export function recallSidePanel(
  chatId: string,
  incarnationId: string | null
): SidePanelState {
  if (incarnationId === null) return CLOSED;
  const remembered = opened.get(chatId);
  if (!remembered || remembered.incarnationId !== incarnationId) return CLOSED;
  touch(chatId, remembered);
  return remembered.state;
}
