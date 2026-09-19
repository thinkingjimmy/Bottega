/**
 * [INPUT]: Depends on the Chat schema, the aggregate budget, the shared Markdown fence scanner and UTF-8 truncation, the byte limits, and the subagent registry
 * [OUTPUT]: Provides the IO-free turn-commit kernel: fence-safe UTF-8 truncation, seq assignment, reachability subagent GC, budget convergence, and an explicit subagentsChanged verdict
 * [POS]: Pure commit kernel of the chats module; ChatStore calls it inside the serial queue, so it stays testable without a file system
 */

import {
  type ChatMessage,
  type ChatRecord,
  type PersistedSubagent,
  type TurnCommitInput,
  type TurnCommitResult,
} from "../../../shared/chats-ipc";
import { slicePartsProtected } from "../../../shared/chat-turn-reducer";
import { prunePersistedSubagents } from "../../../shared/subagent-registry";
import {
  CHAT_BYTE_LIMIT,
  CHAT_MESSAGE_LIMIT,
  assertSubagentBudget,
  chatRecordSchema,
  messageBytes,
  messageSchema,
  subagentsSchema,
} from "./chat-schema";

import { normalizePart, normalizeMessageContent } from "@ai-chat/cloud-protocol/turns/text/normalize";
import { MESSAGE_PART_LIMIT } from "@ai-chat/cloud-protocol/chats/content/budgets";
export { truncateUtf8, truncateMarkdownSafe } from "@ai-chat/cloud-protocol/turns/text/normalize";

export class ChatNotFoundError extends Error {
  override name = "ChatNotFoundError";
}

export class ChatMessageInvariantError extends Error {
  override name = "ChatMessageInvariantError";
}

export class ChatLedgerCorruptError extends Error {
  override name = "ChatLedgerCorruptError";
}

export const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

export function fallbackTitle(firstMessage: string) {
  return Array.from(firstMessage.trim()).slice(0, 30).join("") || "新聊天";
}

export function normalizeMessage(message: ChatMessage) {
  return messageSchema.parse(normalizeMessageContent(message));
}

/* 裁剪必须现场记账：被丢掉的那截 seq 事后无处可查，
   记忆的授权证据与交付水位全靠这一个数字对齐（D9）。 */
function trimToBudget(messages: ChatMessage[], trimmedThroughSeq = 0) {
  const retained = [...messages];
  let trimmed = trimmedThroughSeq;
  let bytes = retained.reduce(
    (total, message) => total + messageBytes(message),
    0
  );
  while (
    retained.length > CHAT_MESSAGE_LIMIT ||
    bytes > CHAT_BYTE_LIMIT
  ) {
    const removed = retained.shift();
    if (!removed) break;
    bytes -= messageBytes(removed);
    trimmed = Math.max(trimmed, removed.seq);
  }
  return {
    retained,
    trimmedThroughSeq: trimmed,
    trimmed: retained.length !== messages.length,
  };
}

function normalizeSubagents(input: Record<string, PersistedSubagent> = {}) {
  const parsed = subagentsSchema.parse(input);
  return Object.fromEntries(
    Object.entries(parsed).map(([id, agent]) => [
      id,
      {
        ...agent,
        parts: slicePartsProtected(
          agent.parts.map(normalizePart),
          MESSAGE_PART_LIMIT
        ),
      },
    ])
  );
}

/** 串行队列内唯一允许提交 assistant/subagents 的纯函数。 */
export function applyTurnCommit(
  currentRecord: ChatRecord,
  canonicalInput: TurnCommitInput
): TurnCommitResult {
  const message = canonicalInput.message
    ? normalizeMessage(canonicalInput.message)
    : undefined;
  const existing = message
    ? currentRecord.messages.find((item) => item.id === message.id)
    : undefined;
  if (existing && !same(existing, message)) {
    throw new ChatMessageInvariantError(`消息 ${message!.id} 已存在但内容不一致`);
  }
  const subagentsDirty = canonicalInput.subagentsDelta !== undefined;
  const appended = Boolean(message && !existing);
  const trim = appended
    ? trimToBudget(
        [...currentRecord.messages, message!].sort(
          (left, right) => left.seq - right.seq
        ),
        currentRecord.trimmedThroughSeq
      )
      : {
        retained: currentRecord.messages,
        trimmedThroughSeq: currentRecord.trimmedThroughSeq ?? 0,
        trimmed: false,
      };
  const messages = trim.retained;
  const subagentsRebuilt = subagentsDirty || trim.trimmed;
  let reachableSubagents = currentRecord.subagents ?? {};
  if (subagentsRebuilt) {
    const subagents = subagentsDirty
      ? normalizeSubagents({
          ...(currentRecord.subagents ?? {}),
          ...canonicalInput.subagentsDelta,
        })
      : currentRecord.subagents ?? {};
    const referencedSubagents = new Set(
      messages.flatMap((item) =>
        (item.role === "assistant" ? item.parts ?? [] : []).flatMap((part) =>
          part.type === "subagent" ? [part.agentThreadId] : []
        )
      )
    );
    reachableSubagents = prunePersistedSubagents(
      Object.fromEntries(
        Object.entries(subagents).filter(
          ([id, agent]) =>
            referencedSubagents.has(id) || agent.meta.origin === "spawn"
        )
      )
    ).subagents;
    assertSubagentBudget(reachableSubagents);
  }
  const record = chatRecordSchema.parse({
    ...currentRecord,
    messages,
    ...(trim.trimmedThroughSeq > 0
      ? { trimmedThroughSeq: trim.trimmedThroughSeq }
      : {}),
    nextSeq: message
      ? Math.max(currentRecord.nextSeq, message.seq + 1)
      : currentRecord.nextSeq,
    ...(Object.keys(reachableSubagents).length
      ? { subagents: reachableSubagents }
      : { subagents: undefined }),
    updatedAt: appended
      ? Math.max(currentRecord.updatedAt, message!.createdAt)
      : currentRecord.updatedAt,
  });
  return {
    record,
    ...(message ? { storedMessage: existing ?? message } : {}),
    appended,
    subagentsChanged: subagentsRebuilt,
  };
}
