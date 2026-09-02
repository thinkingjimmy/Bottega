/**
 * [INPUT]: Depends on canonical placement facts and App editor projection
 * [OUTPUT]: Provides Sidebar-only root Chat, App Project, and Project-child visibility predicates
 * [POS]: Sidebar projection truth table; independent from History, Search, Activity, Archive, and Base rules
 */

import { hasCanonicalChatPlacement, isEditorVisible, isEffectivelyArchived, isHistoryVisible, type AppEditorProjection, type ChatPlacementInput } from "./facts";

export const appearsInRootChats = (chat: ChatPlacementInput) =>
  hasCanonicalChatPlacement(chat) &&
  !isEffectivelyArchived(chat) &&
  isHistoryVisible(chat.startState) &&
  (chat.context.kind === "app-use" ||
    (chat.context.kind === "ordinary" && !chat.projectId));

export const appearsAsAppProject = (editor: AppEditorProjection) =>
  isEditorVisible(editor);

export const appearsInAppProject = (chat: ChatPlacementInput) =>
  hasCanonicalChatPlacement(chat) &&
  !isEffectivelyArchived(chat) &&
  isHistoryVisible(chat.startState) &&
  chat.context.kind === "app-edit" &&
  !chat.readOnlyReason;
