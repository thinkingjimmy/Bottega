/**
 * [INPUT]: Depends on the existing Project store and local Chat release ports.
 * [OUTPUT]: Releases missing-Project Chat membership while the caller holds the Project gate.
 * [POS]: Local fallback beneath ProjectsService; it does not send cloud requests.
 */
import type { ProjectStore } from "../store/project-store";
import type { ProjectsServiceOptions } from "../projects-service-options";
export async function releaseLocalMissingProject(projectId: string, store: ProjectStore, options: ProjectsServiceOptions) {
  if (store.get(projectId)) throw Object.assign(new Error("Only Chats from a missing Project can be rescued."), { status: 409 });
  const chatIds = options.listChatsByProject(projectId);
  for (const chatId of chatIds) await options.releaseChatProject(chatId);
  return chatIds.length;
}
