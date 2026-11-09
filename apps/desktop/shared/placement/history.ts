/**
 * [INPUT]: Depends on canonical chat placement facts
 * [OUTPUT]: Provides appearsInHistory, compareHistoryChats.
 * [POS]: History projection truth table; independent from all other product surfaces
 */

import { hasCanonicalChatPlacement, isEffectivelyArchived, isHistoryVisible, type ChatPlacementInput } from "./facts";

export const appearsInHistory = (chat: ChatPlacementInput) =>
  hasCanonicalChatPlacement(chat) &&
  !isEffectivelyArchived(chat) &&
  isHistoryVisible(chat.startState) &&
  chat.context.kind !== "app-edit";

export const compareHistoryChats = (left: ChatPlacementInput, right: ChatPlacementInput) =>
  right.updatedAt - left.updatedAt ||
  right.createdAt - left.createdAt ||
  left.id.localeCompare(right.id);
