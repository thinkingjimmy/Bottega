/**
 * [INPUT]: Depends on shared message budgets, protected part retention and text boundaries.
 * [OUTPUT]: Provides the sole message normalization and fence-safe clipping kernel.
 * [POS]: Shared by desktop canonical commits and cloud interrupted materialization.
 */
import type { ChatMessage } from "../../chats/content/messages";
import type { ChatPart, ChatToolPart } from "../../chats/content/parts";
import { messageBytes, utf8Length } from "../../chats/content/parts";
import { MESSAGE_BYTE_LIMIT, MESSAGE_PART_LIMIT, TOOL_DETAIL_BYTE_LIMIT, PART_TITLE_CHAR_LIMIT } from "../../chats/content/budgets";
import { slicePartsProtected } from "../reducer";
import { scanFences } from "./markdown-fences";
import { truncateUtf8 as truncateUtf8Result } from "./truncate-utf8";
const TRUNCATED_SUFFIX = "…[已截断]";
export function truncateUtf8(value: string, limit = MESSAGE_BYTE_LIMIT) {
  return truncateUtf8Result(value, limit, TRUNCATED_SUFFIX).value;
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

export function normalizePart<Part extends ChatPart>(part: Part): Part {
  if (part.type === "subagent") return { ...part };
  if (part.type === "text") {
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

export function normalizeMessageContent<Message extends ChatMessage>(message: Message): Message {
  if (message.role !== "assistant") return message;
  const { parts: rawParts, ...rest } = message;
  const content = truncateMarkdownSafe(message.content);
  let parts = slicePartsProtected(
    (rawParts ?? []).map(normalizePart),
    MESSAGE_PART_LIMIT
  );
  const assemble = (): Message =>
    (parts.length ? { ...rest, content, parts } : { ...rest, content }) as Message;
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
  return assemble() as Message;
}
