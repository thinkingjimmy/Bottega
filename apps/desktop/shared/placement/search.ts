/**
 * [INPUT]: Depends on canonical Chat placement, BaseNavigation, and typed product destinations
 * [OUTPUT]: Provides Search-only Chat destinations and Base eligibility
 * [POS]: Search projection truth table; never indexes dormant/internal facts or emits a raw App route
 */

import {
  hasCanonicalChatPlacement,
  isEffectivelyArchived,
  isHistoryVisible,
  type BaseNavigation,
  type ChatPlacementInput,
  type ProductDestination,
} from "./facts";

export const appearsInSearchBase = (
  navigation: BaseNavigation,
  conversationVisible = true
) =>
  navigation.kind !== "internal-app" &&
  (navigation.kind !== "conversation-contained" || conversationVisible);

export function searchDestination(chat: ChatPlacementInput): ProductDestination | null {
  if (!hasCanonicalChatPlacement(chat)) return null;
  if (!isHistoryVisible(chat.startState)) return null;
  if (
    isEffectivelyArchived(chat) ||
    chat.readOnlyReason === "legacy-app-not-editable"
  ) {
    return { kind: "archive", target: "chat", id: chat.id };
  }
  if (chat.context.kind === "app-use") {
    return {
      kind: "app-use-chat",
      appId: chat.context.appId,
      chatId: chat.id,
      incarnationId: chat.incarnationId,
    };
  }
  if (chat.context.kind === "app-edit") {
    return {
      kind: "app-editor-chat",
      appId: chat.context.appId,
      projectId: chat.context.projectId,
      chatId: chat.id,
      incarnationId: chat.incarnationId,
    };
  }
  return { kind: "chat", chatId: chat.id };
}
