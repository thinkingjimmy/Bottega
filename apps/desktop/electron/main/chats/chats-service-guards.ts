/**
 * [INPUT]: Depends on the shared Chat message types and Node IO error codes
 * [OUTPUT]: Provides ChatsService status errors, first-message idempotency, the legacy renderer-write rejection, and persistence IO failure classification
 * [POS]: Pure guard boundary of the chats module; it keeps ChatsService free of side-effect-shaped conditionals
 */

import type {
  ChatMessage,
  UnsequencedUserMessage,
} from "../../../shared/chats-ipc";

const PERSISTENCE_IO_CODES = new Set([
  "EACCES",
  "EBUSY",
  "EDQUOT",
  "EIO",
  "EMFILE",
  "ENFILE",
  "ENOSPC",
  "EROFS",
]);

export function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

export function rejectLegacyRendererWrite(): never {
  throw new Error("聊天写入必须经 ConversationCoordinator 提交");
}

export function sameCanonicalFirstMessage(
  existing: ChatMessage | undefined,
  expected: UnsequencedUserMessage
) {
  return (
    existing?.role === "user" &&
    existing.id === expected.id &&
    existing.content === expected.content &&
    existing.createdAt === expected.createdAt &&
    existing.relay?.sourceSectionId === expected.relay?.sourceSectionId &&
    existing.relay?.chainId === expected.relay?.chainId &&
    !existing.attachments?.length &&
    !expected.attachments?.length
  );
}

export function isPersistenceIoError(cause: unknown) {
  return Boolean(
    cause &&
      typeof cause === "object" &&
      "code" in cause &&
      typeof cause.code === "string" &&
      PERSISTENCE_IO_CODES.has(cause.code)
  );
}
