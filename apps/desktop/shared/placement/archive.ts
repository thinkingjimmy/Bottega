/**
 * [INPUT]: Depends on canonical chat placement facts and history visibility
 * [OUTPUT]: Provides appearsInArchive.
 * [POS]: Archive projection truth table; only read-only legacy Edit transcripts are forced here without explicit archive state
 */

import { hasCanonicalChatPlacement, isEffectivelyArchived, isHistoryVisible, type ChatPlacementInput } from "./facts";

export const appearsInArchive = (chat: ChatPlacementInput) =>
  hasCanonicalChatPlacement(chat) &&
  (chat.readOnlyReason === "legacy-app-not-editable" ||
  (isEffectivelyArchived(chat) && isHistoryVisible(chat.startState)));
