/**
 * [INPUT]: Depends on the Chat schema, the aggregate budget, the shared Markdown fence scanner, the byte limits, and the subagent registry
 * [OUTPUT]: Provides the IO-free turn-commit kernel: fence-safe UTF-8 truncation, seq assignment, reachability subagent GC, budget convergence, and an explicit subagentsChanged verdict
 * [POS]: Pure commit kernel of the chats module; ChatStore calls it inside the serial queue, so it stays testable without a file system
 */

import { TOOL_DETAIL_BYTE_LIMIT } from "../../../shared/agent-ipc";
import {
  MESSAGE_BYTE_LIMIT,
  MESSAGE_PART_LIMIT,
  type ChatMessage,
  type ChatPart,
  type ChatRecord,
  type ChatToolPart,
  type PersistedSubagent,
  type TurnCommitInput,
  type TurnCommitResult,
} from "../../../shared/chats-ipc";
import { slicePartsProtected } from "../../../shared/chat-turn-reducer";
import { prunePersistedSubagents } from "../../../shared/subagent-registry";
import { scanFences } from "../../../shared/markdown-fences";
import {
  CHAT_BYTE_LIMIT,
  CHAT_MESSAGE_LIMIT,
  PART_TITLE_CHAR_LIMIT,
  assertSubagentBudget,
  chatRecordSchema,
  messageBytes,
  messageSchema,
  subagentsSchema,
  utf8Length,
} from "./chat-schema";

const TRUNCATED_SUFFIX = "…[已截断]";

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

export function truncateUtf8(value: string, limit = MESSAGE_BYTE_LIMIT) {
  if (utf8Length(value) <= limit) return value;
  const suffixBytes = utf8Length(TRUNCATED_SUFFIX);
  const bytes = Buffer.from(value, "utf8");
  let end = Math.max(0, limit - suffixBytes);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return `${bytes.subarray(0, end).toString("utf8")}${TRUNCATED_SUFFIX}`;
}

export function truncateMarkdownSafe(
  value: string,
  limit = MESSAGE_BYTE_LIMIT
) {
  if (utf8Length(value) <= limit) return value;
  const suffixBytes = utf8Length(TRUNCATED_SUFFIX);
  const contentLimit = Math.max(0, limit - suffixBytes);
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = value.slice(0, middle);
    if (utf8Length(candidate) <= contentLimit) low = middle;
    else high = middle - 1;
  }
  let end = low;
  const code = value.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  const crossing = scanFences(value).find(
    (fence) => fence.start < end && fence.end > end
  );
  if (crossing) end = crossing.start;
  while (
    end > 0 &&
    utf8Length(`${value.slice(0, end)}${TRUNCATED_SUFFIX}`) > limit
  ) {
    end -= 1;
  }
  return `${value.slice(0, end)}${TRUNCATED_SUFFIX}`;
}

function normalizePart(part: ChatPart): ChatPart {
  if (part.type === "subagent") return { ...part };
  if (part.type === "text") {
    // 决策 7 只限工具 detail；文本 part 仅受 32KB 消息预算约束
    return {
      ...part,
      text: truncateMarkdownSafe(part.text, MESSAGE_BYTE_LIMIT),
    };
  }
  const title =
    part.title.length > PART_TITLE_CHAR_LIMIT
      ? `${part.title.slice(0, PART_TITLE_CHAR_LIMIT - 1)}…`
      : part.title;
  return {
    ...part,
    title,
    ...(part.detail
      ? { detail: truncateUtf8(part.detail, TOOL_DETAIL_BYTE_LIMIT) }
      : {}),
  };
}

export function normalizeMessage(message: ChatMessage) {
  if (message.role !== "assistant") return messageSchema.parse(message);
  const { parts: rawParts, ...rest } = message;
  const content = truncateMarkdownSafe(message.content);
  // 超量条目保最新（收敛而非拒绝，Review 修复）
  let parts = slicePartsProtected(
    (rawParts ?? []).map(normalizePart),
    MESSAGE_PART_LIMIT
  );
  const assemble = (): ChatMessage =>
    parts.length ? { ...rest, content, parts } : { ...rest, content };
  // 决策 7：超预算先剥最旧 detail，再丢最旧 part；content 已 ≤32KB，循环必然收敛
  while (messageBytes(assemble()) > MESSAGE_BYTE_LIMIT && parts.length > 0) {
    const index = parts.findIndex((part) => part.type === "tool" && part.detail);
    if (index >= 0) {
      const { detail: _detail, ...tool } = parts[index] as ChatToolPart;
      parts = [...parts.slice(0, index), tool, ...parts.slice(index + 1)];
    } else {
      const nonChip = parts.findIndex((part) => part.type !== "subagent");
      const victim = nonChip >= 0 ? nonChip : 0;
      parts = [...parts.slice(0, victim), ...parts.slice(victim + 1)];
    }
  }
  return messageSchema.parse(assemble());
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
