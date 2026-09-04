/**
 * [INPUT]: Depends on canonical Chat metadata, Chat Home ownership, managed worktree shape/top-level validation, and bounded Git metadata discovery
 * [OUTPUT]: Provides managed-worktree ownership and shape validation, shared Git read-only roots, and the Full Access permission ceiling
 * [POS]: Main-window security helper that keeps managed execution policy separate from renderer/Agent bridge assembly
 */

import { join } from "node:path";
import type { ChatHomeService } from "../chat-home/chat-home-service";
import type { ChatMetadata } from "../chats/chat-summary";
import { runGit } from "../projects/git/git-runner";
import { assertManagedWorktreeShape } from "../projects/git/managed-worktree";

type OwnershipPort = Pick<ChatHomeService, "verifyOwnership">;

export async function resolveManagedWorktreeAccess(
  chat: ChatMetadata | null | undefined,
  workspace: string,
  homes: OwnershipPort
) {
  if (chat?.executionKind !== "managed-worktree") {
    return { active: false, readOnlyRoots: [] as string[] };
  }
  const home = await homes.verifyOwnership(chat.id);
  const worktree = home?.worktree ? join(home.homeDir, home.worktree.relativePath) : null;
  if (!worktree || chat.executionDir !== worktree || workspace !== worktree) {
    throw new Error("MANAGED_WORKTREE_OWNERSHIP_MISMATCH");
  }
  /* owned Home 证明路径归属；lstat 与 Git 再证明路径之下没有 symlink 间接层。 */
  const identity = await assertManagedWorktreeShape(worktree);
  return {
    active: true,
    readOnlyRoots: [
      identity.commonDir,
      (await runGit(worktree, ["rev-parse", "--absolute-git-dir"])).trim(),
    ],
  };
}

export function assertManagedWorktreePermission(
  chat: ChatMetadata | null | undefined,
  permissionMode: string | undefined
) {
  if (chat?.executionKind === "managed-worktree" && permissionMode === "full-access") {
    throw new Error("MANAGED_WORKTREE_FULL_ACCESS_FORBIDDEN");
  }
}
