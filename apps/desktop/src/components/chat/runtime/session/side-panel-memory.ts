/**
 * [INPUT]: Depends on PanelSessionContext identity helpers and SidePanelState
 * [OUTPUT]: Provides bounded generation-fenced recall/remember operations for self-attesting panel state
 * [POS]: Cross-mount side-panel memory for chat/runtime/session; empty draft generations never enter global storage
 */

import {
  panelConversationKey,
  panelGenerationKey,
  type PanelSessionContext,
  type SidePanelState,
} from "../chat-session-model";

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
  generationKey: string;
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
  context: PanelSessionContext,
  state: SidePanelState
) {
  const conversationKey = panelConversationKey(context);
  const generationKey = panelGenerationKey(context);
  // draft 没有可验证代际，不能覆盖同 conversation key 的已知产品记忆。
  if (!generationKey) return;
  if (!retainableSidePanel(state)) {
    opened.delete(conversationKey);
    return;
  }
  touch(conversationKey, { generationKey, state });
  evictOldest();
}

export function recallSidePanel(
  context: PanelSessionContext
): SidePanelState {
  const conversationKey = panelConversationKey(context);
  const remembered = opened.get(conversationKey);
  if (
    !remembered ||
    remembered.generationKey !== panelGenerationKey(context)
  ) {
    return CLOSED;
  }
  touch(conversationKey, remembered);
  return remembered.state;
}
