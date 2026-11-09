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
import type { ChatStore } from "../chat-store";
import type { ChatsServiceOptions } from "./chats-service-options";

type Ports = Pick<ChatsServiceOptions, "chatHomes"> & { store: ChatStore; assertAdmission(): void };
export async function beginChatCreation(ports: Ports, submission: TrustedManualTurnSubmission) {
  if (submission.persistence.kind === "append") return;
  ports.assertAdmission();
  const input = submission.persistence.input;
  await beginAdoptedContinuation(ports.store, submission);
  const workspaceScope = submission.persistence.kind === "create-app" ? { kind: "app" as const, appId: submission.persistence.input.appId }
    : input.projectId ? { kind: "project" as const, projectId: input.projectId } : { kind: "conversation" as const, conversationId: input.id };
  const home = await ports.chatHomes?.beginCreation({ intentId: submission.intentId, chatId: input.id,
    ...(input.incarnationId ? { incarnationId: input.incarnationId } : {}), submission, workspaceScope, stagingOwner: submission.intentId });
  if (!home) throw new Error("Chat Home service unavailable");
  return home;
}
export function chatHomeExecution(home: Pick<ChatHomeRecord, "homeDir" | "worktree">, projectId: string | null): Pick<ChatCreateIdentity, "execution"> {
  if (!home.worktree) return {};
  if (home.worktree.projectId !== projectId) throw new Error("Chat Home Project identity changed");
  return { execution: { kind: "managed-worktree", directory: join(home.homeDir, home.worktree.relativePath) } };
}
