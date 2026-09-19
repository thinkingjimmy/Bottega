/**
 * [INPUT]: Existing native slot, open-state and width owners plus portable panel keys.
 * [OUTPUT]: Shared panel services retaining native state when execution ports change, judged on the chat's own conversation kind.
 * [POS]: Persistence adapter; remote App/Browser leaves retain identity while their content is unavailable.
 */
import type { PanelMemory } from "@ai-chat/chat-ui/side-panel/host/memory";
import { sanitizeSlots } from "@ai-chat/chat-ui/side-panel/host/memory";
import type { ChatClassification } from "@ai-chat/cloud-protocol/chats/model";
import { panelSlotStore } from "@/components/chat/side-panel/panel-slot-store";
import { recallSidePanel, rememberSidePanel } from "@/components/chat/runtime/session/side-panel-memory";
import type { PanelSessionContext } from "@/components/chat/runtime/chat-session-model";
import type { ConversationContext } from "../../../../shared/placement/facts";
export { nativePanelWidths as desktopPanelWidths } from "@/lib/side-panel-layout";
/* The portable classification is what eligibility is judged on — an App conversation has no Base tab.
   Calling every mirrored chat "ordinary" handed the shared panel a tab the chat cannot own. */
const conversationContext = (classification: ChatClassification): ConversationContext =>
  classification.conversationKind === "ordinary" ? { kind: "ordinary" }
    : classification.conversationKind === "app-use" ? { kind: "app-use", appId: classification.appId! }
      : { kind: "app-edit", appId: classification.appId!, projectId: classification.projectId! };
export function desktopPanelMemory(classification: ChatClassification): PanelMemory {
  const context = (key: string): PanelSessionContext => {
    const [chatId, incarnationId] = JSON.parse(key) as [string, string];
    return { kind: "product", productRef: { chatId, incarnationId }, conversationContext: conversationContext(classification) };
  };
  return {
    readSlots(key, imageAllowed) {
      const value = panelSlotStore.getFor(context(key));
      return sanitizeSlots({ tabs: [...value.tabs, ...(value.active === "browser" ? ["browser"] : [])], active: value.active, touched: value.revision > 0 }, imageAllowed);
    },
    writeSlots(key, slots) {
      panelSlotStore.replace(panelSlotStore.key(context(key)), slots.tabs.filter(id => id !== "browser"), slots.active ?? "");
    },
    readOpenIntent: key => recallSidePanel(context(key)).kind !== "none",
    rememberOpenIntent: (key, open) => { const target = context(key); rememberSidePanel(target, open ? { kind: "tabs", context: target } : { kind: "none" }); },
  };
}
