/**
 * [INPUT]: Trusted first-turn submission, main member index, canonical Home ownership and existing managed Git worktree primitives.
 * [OUTPUT]: First-create Home preparation, exact member identity admission and Home-derived execution metadata.
 * [POS]: Operation-only ChatsService adapter; its Coordinator caller already owns the Project lifecycle fence.
 */
import { join } from "node:path";
import type { TrustedManualTurnSubmission } from "../../../../shared/ipc/content/sections-ipc";
import type { ChatHomeRecord } from "../../chat-home/ledger-values";
import type { ChatCreateIdentity } from "../lifecycle/chat-record-lifecycle";
import { beginAdoptedContinuation } from "../lifecycle/adopted-chat";
import { memberChatCreation, memberChatFacts } from "../projection/chat-summary";
import type { ChatStore } from "../chat-store";
import type { ChatsServiceOptions } from "./chats-service-options";

type Ports = Pick<ChatsServiceOptions, "chatHomes" | "resolveProjectWorkspace"> & { store: ChatStore; assertAdmission(): void };
export async function beginChatCreation(ports: Ports, submission: TrustedManualTurnSubmission) {
  if (submission.persistence.kind === "append") return;
  ports.assertAdmission();
  const input = submission.persistence.input, plan = memberChatCreation(input.id);
  const assertCurrent = () => {
    ports.assertAdmission();
    if (!plan) return;
    const current = memberChatCreation(input.id), facts = memberChatFacts(input.id);
    if (submission.persistence.kind !== "create" || !current || current.projectId !== input.projectId ||
      current.incarnationId !== input.incarnationId || current.isolation !== plan.isolation ||
      !facts || !submission.memberSession || Object.entries(facts).some(([key, value]) => submission.memberSession?.[key as keyof typeof facts] !== value)) {
      throw new Error("Member Home Project or incarnation identity changed");
    }
  };
  assertCurrent();
  await beginAdoptedContinuation(ports.store, submission);
  const workspaceScope = submission.persistence.kind === "create-app" ? { kind: "app" as const, appId: submission.persistence.input.appId }
    : input.projectId ? { kind: "project" as const, projectId: input.projectId } : { kind: "conversation" as const, conversationId: input.id };
  let descriptor: ChatHomeRecord["worktree"], workspace: string | undefined;
  let prepared: Awaited<ReturnType<typeof import("../../projects/git/managed-worktree").preflightManagedWorktree>> | undefined;
  if (plan?.isolation === "worktree") {
    workspace = await ports.resolveProjectWorkspace?.(plan.projectId) ?? undefined;
    if (!workspace) throw new Error("Member Project workspace is unavailable");
    const prior = ports.chatHomes?.identityForCreation(input.id);
    if (prior && (prior.intentId !== submission.intentId || !prior.worktree || prior.worktree.projectId !== plan.projectId))
      throw new Error("Member Home worktree identity changed");
    const git = await import("../../projects/git/managed-worktree");
    prepared = prior?.worktree ? undefined : await git.preflightManagedWorktree(workspace);
    if (prepared && !prepared.supported) throw new Error("Managed member worktree is unavailable on this platform");
    descriptor = prior?.worktree ?? { kind: "managed-worktree", projectId: plan.projectId, baseCommit: prepared!.baseCommit,
      branch: git.managedWorktreeBranch(input.id), relativePath: "worktree" };
  }
  assertCurrent();
  const home = await ports.chatHomes?.beginCreation({ intentId: submission.intentId, chatId: input.id,
    ...(input.incarnationId ? { incarnationId: input.incarnationId } : {}), submission, workspaceScope, stagingOwner: submission.intentId,
    ...(descriptor ? { worktree: descriptor } : {}) });
  if (!home) throw new Error("Chat Home service unavailable");
  if (descriptor) {
    try {
      assertCurrent();
      const git = await import("../../projects/git/managed-worktree");
      const { resolveGitIdentity } = await import("../../projects/git/git-runner");
      await git.createManagedWorktree({ sourceWorkspace: workspace!, worktreeDir: join(home.homeDir, descriptor.relativePath),
        baseCommit: descriptor.baseCommit, branch: descriptor.branch, expectedIdentity: prepared?.identity ?? await resolveGitIdentity(workspace!) });
      assertCurrent();
    } catch (cause) {
      try { await ports.chatHomes!.rollbackCreation(input.id); }
      catch (cleanup) { throw new AggregateError([cause, cleanup], "Member worktree preparation failed; Home cleanup requires recovery"); }
      throw cause;
    }
  }
  return home;
}
export function chatHomeExecution(home: Pick<ChatHomeRecord, "homeDir" | "worktree">, projectId: string | null): Pick<ChatCreateIdentity, "execution"> {
  if (!home.worktree) return {};
  if (home.worktree.projectId !== projectId) throw new Error("Member Home Project identity changed");
  return { execution: { kind: "managed-worktree", directory: join(home.homeDir, home.worktree.relativePath) } };
}
