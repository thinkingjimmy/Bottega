/**
 * [INPUT]: Depends on canonical placement facts and App editor projection
 * [OUTPUT]: Provides Sidebar-only root Chat, App Project, ordinary Project Chat list, and Project-child visibility predicates; workflow-owned Chats appear in none
 * [POS]: Sidebar projection truth table; independent from History, Search, Activity, Archive, and Base rules
 */

import { hasCanonicalChatPlacement, isEditorVisible, isEffectivelyArchived, isHistoryVisible, isWorkflowChat, type AppEditorProjection, type ChatPlacementInput } from "./facts";

export const appearsInRootChats = (chat: ChatPlacementInput) =>
  hasCanonicalChatPlacement(chat) &&
  !isEffectivelyArchived(chat) &&
  !isWorkflowChat(chat) &&
  isHistoryVisible(chat.startState) &&
  (chat.context.kind === "app-use" ||
    (chat.context.kind === "ordinary" && !chat.projectId));

/** An ordinary Project's own Chat list (sidebar section, Project page, the Base's latest Chat); workflow Chats open from their run. */
export const appearsInProjectChats = (chat: ChatPlacementInput, projectId: string) =>
  chat.projectId === projectId && !isEffectivelyArchived(chat) && !isWorkflowChat(chat);

export const appearsAsAppProject = (editor: AppEditorProjection) =>
  isEditorVisible(editor);

export const appearsInAppProject = (chat: ChatPlacementInput) =>
  hasCanonicalChatPlacement(chat) &&
  !isEffectivelyArchived(chat) &&
  isHistoryVisible(chat.startState) &&
  chat.context.kind === "app-edit" &&
  !chat.readOnlyReason;
