/**
 * [INPUT]: Shared sortWorkspaceProjects and native Project/ChatSummary contracts
 * [OUTPUT]: Project sorting with readable remote origin and shared native/cloud activity inputs.
 * [POS]: Project sorting rules in lib, consumed by the Sidebar ProjectSection and locked by the single-section
 */

import { sortWorkspaceProjects } from "@ai-chat/ui/components/workspace/actions/sort";
import type { ChatSummary } from "../../shared/chats-ipc";
import type {
  Project,
  ProjectsSortMode,
} from "../../shared/projects-ipc";

export function sortProjects<T extends Pick<ChatSummary, "projectId" | "updatedAt">>(
  projects: Project[],
  chats: T[],
  sortMode: ProjectsSortMode
) {
  const latest = new Map<string, number>();
  for (const chat of chats) {
    if (!chat.projectId) continue;
    latest.set(
      chat.projectId,
      Math.max(latest.get(chat.projectId) ?? 0, chat.updatedAt)
    );
  }
  return sortWorkspaceProjects(projects, latest, sortMode, project => Boolean(project.missing && !project.cloud?.remote));
}
