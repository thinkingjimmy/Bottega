/**
 * [INPUT]: Depends on canonical chat placement facts and the started-exact predicate
 * [OUTPUT]: Provides Activity-only visibility
 * [POS]: Activity projection truth table; unstarted chats stay visible elsewhere without impersonating user activity
 */

import { hasCanonicalChatPlacement, isEffectivelyArchived, isHistoryVisible, type ChatPlacementInput } from "./facts";

export const appearsInActivity = (chat: ChatPlacementInput) =>
  hasCanonicalChatPlacement(chat) &&
  !isEffectivelyArchived(chat) &&
  isHistoryVisible(chat.startState);
