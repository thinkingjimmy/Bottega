/**
 * [INPUT]: Depends on the shared AppChatRole contract and the canonical Chat id pattern
 * [OUTPUT]: Provides assertChatId, isAppProjectMember, and assertProjectRole
 * [POS]: The stateless guard layer of the chats module; every durable IO lives in the SQLite worker
 */

import type { AppChatRole } from "../../../shared/chats-ipc";
import { CHAT_ID_PATTERN } from "./chat-schema";

type IsAppProject = (projectId: string) => boolean;

export function assertChatId(chatId: string) {
  if (!CHAT_ID_PATTERN.test(chatId)) throw new Error("聊天 id 格式无效");
}

export function isAppProjectMember(
  isAppProject: IsAppProject | undefined,
  projectId: string | null
) {
  return projectId !== null && Boolean(isAppProject?.(projectId));
}

export function assertProjectRole(
  isAppProject: IsAppProject | undefined,
  projectId: string | null,
  appRole: AppChatRole | null
) {
  if (!isAppProject) return;
  const appProject = isAppProjectMember(isAppProject, projectId);
  if (appProject && appRole === null) {
    throw Object.assign(
      new Error("App Project 成员必须经 App 专用入口指定角色"),
      { status: 403 }
    );
  }
  if (!appProject && appRole !== null) {
    throw Object.assign(
      new Error("普通 Project 聊天不能携带 App 角色"),
      { status: 403 }
    );
  }
}
