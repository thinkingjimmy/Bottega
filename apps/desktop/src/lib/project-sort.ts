/**
 * [INPUT]: Depends on shared Project/ChatSummary/ProjectsSortMode contract
 * [OUTPUT]: Provides sortProjects, both sorting will be invalid/substitute Project bottom, Manual maintains substitute updatedAt DESC/id order
 * [POS]: Project sorting rules in lib, consumed by the Sidebar ProjectSection and locked by the single-section
 */

import type { ChatSummary } from "../../shared/chats-ipc";
import type {
  Project,
  ProjectsSortMode,
} from "../../shared/projects-ipc";

export function sortProjects(
  projects: Project[],
  chats: ChatSummary[],
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
  return [...projects].sort((left, right) => {
    if (left.missing !== right.missing) return left.missing ? 1 : -1;
    if (sortMode === "manual") {
      const bothPlaceholders =
        left.sortIndex === Number.MAX_SAFE_INTEGER &&
        right.sortIndex === Number.MAX_SAFE_INTEGER;
      if (bothPlaceholders) {
        return right.updatedAt - left.updatedAt || left.id.localeCompare(right.id);
      }
      return left.sortIndex - right.sortIndex || left.id.localeCompare(right.id);
    }
    const leftTime = latest.get(left.id) ?? left.updatedAt;
    const rightTime = latest.get(right.id) ?? right.updatedAt;
    return rightTime - leftTime || left.id.localeCompare(right.id);
  });
}
