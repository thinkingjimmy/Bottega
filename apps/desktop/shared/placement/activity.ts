/**
 * [INPUT]: Depends on canonical chat placement facts and the started-exact predicate
 * [OUTPUT]: Provides Activity-only visibility (workflow-owned Chats excluded)
 * [POS]: Activity projection truth table; unstarted chats stay visible elsewhere without impersonating user activity
 */

import { hasCanonicalChatPlacement, isEffectivelyArchived, isHistoryVisible, isWorkflowChat, type ChatPlacementInput } from "./facts";

export const appearsInActivity = (chat: ChatPlacementInput) =>
  hasCanonicalChatPlacement(chat) &&
  !isEffectivelyArchived(chat) &&
  !isWorkflowChat(chat) &&
  isHistoryVisible(chat.startState);
