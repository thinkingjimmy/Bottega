/**
 * [INPUT]: Depends on ProjectsService, ChatsService managed-worktree commit authority, and incarnation-bound tools lease context
 * [OUTPUT]: Provides createProjectToolset, binding convert_chat_to_project and exact-issued commit_managed_worktree to main-owned identities
 * [POS]: Projects' only adapter into the shared built-in-tool platform; chat identity comes solely from the tool lease, so callers cannot falsify it via parameters
 */

import type { BuiltinToolset } from "../tools/registry";
import type { ProjectsService } from "./projects-service";
import type { ChatsService } from "../chats/chats-service";

export function createProjectToolset(
  projects: ProjectsService,
  chats: ChatsService
): BuiltinToolset {
  return {
    convert_chat_to_project: (args, context) =>
      projects.convertFromChat({
        lease: context.lease,
        name: args.name as string,
      }),
    commit_managed_worktree: (args, context) =>
      chats.commitManagedWorktree({
        chatId: context.lease.chatId,
        incarnationId: context.lease.incarnationId,
        message: args.message as string,
      }),
  };
}
