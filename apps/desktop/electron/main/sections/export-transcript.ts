/**
 * [INPUT]: Depends on shared ChatRecord/ChatMessage, Section Width-line rendering and export byte budget
 * [OUTPUT]: Provides explicitly declaring attachment projection mode messageLines, including attachment draft unchanging tail snapshot, and independent direct to live read_section
 * [POS]: The only source of truth for the only reading projections of the sections;@Shotshots share message projections only with read_section, not split page syntax
 */

import { SECTION_EXPORT_BYTE_LIMIT } from "../../../shared/agent-ipc";
import type { ChatMessage, ChatRecord } from "../../../shared/chats-ipc";
import {
  sectionAttachmentLine,
  type SectionAttachmentRender,
  type SectionSnapshotDraft,
} from "../../../shared/section-attachments";
import { truncateUtf8 as truncateUtf8Result } from "../../../shared/truncate-utf8";

const TRUNCATED = "\n\n[Section 转录已按字节预算截断]\n";
const DETAIL_BYTE_LIMIT = 1024;
const DETAIL_TRUNCATED = "\n[detail 已按 1 KiB 单条限额截断]";

function truncateUtf8(value: string, limit: number, suffix = TRUNCATED) {
  return truncateUtf8Result(value, limit, suffix).value;
}

function detailLines(detail: string) {
  const indented = detail
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  return truncateUtf8(
    indented,
    DETAIL_BYTE_LIMIT,
    DETAIL_TRUNCATED
  ).split("\n");
}

/**
 * `attachmentRender` 没有缺省值是刻意的：本函数同时是全局搜索的 canonical
 * 语料投影，任何一个忘了声明投影态的调用方都会把机器锚点喂进搜索 snippet。
 * 让每个读者自己说清楚自己是谁，比给一个"多半没错"的默认值安全。
 */
export function messageLines(
  message: ChatMessage,
  attachmentRender: SectionAttachmentRender
) {
  if (message.role === "notice") return [];
  const lines = [`${message.role}: ${message.content}`];
  for (const part of message.role === "assistant" ? message.parts ?? [] : []) {
    if (part.type === "tool") {
      lines.push(`  [tool:${part.tool}] ${part.title} (${part.status})`);
      if (part.detail && part.tool !== "image") {
        lines.push(...detailLines(part.detail));
      }
    } else if (part.type === "subagent") {
      lines.push(`  [subagent] ${part.name} (${part.status})`);
    } else if (part.text !== message.content) {
      lines.push(`  [process] ${part.text}`);
    }
  }
  for (const attachment of message.role === "user"
    ? message.attachments ?? []
    : []) {
    lines.push(sectionAttachmentLine(attachment, attachmentRender));
  }
  return lines;
}

type ProjectedMessage = {
  message: ChatMessage;
  text: string;
};

const transcriptMessages = (
  record: ChatRecord,
  attachmentRender: SectionAttachmentRender
): ProjectedMessage[] =>
  record.messages.flatMap((message) => {
    const lines = messageLines(message, attachmentRender);
    return lines.length ? [{ message, text: lines.join("\n") }] : [];
  });

const capturedThroughSeq = (record: ChatRecord) =>
  record.messages.reduce(
    (captured, message) => Math.max(captured, message.seq),
    Math.max(0, record.trimmedThroughSeq ?? 0)
  );

function snapshotText(
  record: ChatRecord,
  captured: number,
  messages: readonly ProjectedMessage[],
  selected: readonly ProjectedMessage[],
  body?: string
) {
  const includedFrom = selected[0]?.message.seq ?? captured + 1;
  const includedThrough = selected.at(-1)?.message.seq ?? captured;
  const firstSurviving = messages[0]?.message.seq ?? captured + 1;
  const olderOmitted =
    (selected.length > 0 && includedFrom > firstSurviving) ||
    (record.trimmedThroughSeq ?? 0) > 0;
  const header = [
    "# Section tail snapshot",
    "",
    `- id: ${record.id}`,
    `- title: ${record.title ?? "未命名"}`,
    `- agent: ${record.agent}`,
    `- incarnation: ${record.incarnationId}`,
    `- capturedThroughSeq: ${captured}`,
    `- includedFromSeq: ${includedFrom}`,
    `- includedThroughSeq: ${includedThrough}`,
    `- trimmedThroughSeq: ${record.trimmedThroughSeq ?? 0}`,
    "",
    "> 这是不可变、有界的 tail 快照；历史可能已按单消息 32 KiB 与整聊预算裁剪，此处只承诺幸存投影。",
    "",
  ].join("\n");
  const projectedBody =
    body ??
    selected
      .map((message) => `${message.text}\n\n`)
      .join("");
  const footer = olderOmitted
    ? "\n> 更旧历史未包含（includedFromSeq 之前）。read_section 是独立的 live 正向查询，不是本快照的下一页。\n"
    : "";
  return `${header}\n${projectedBody.trimEnd()}${footer}\n`;
}

type SectionSnapshotMetadata = {
  incarnation: string;
  capturedThroughSeq: number;
  includedFromSeq: number;
  includedThroughSeq: number;
  trimmedThroughSeq: number;
};

/**
 * 模块私有：产出的是带 `pending` 规划锚点的中间态，公开出去就等于把机器
 * token 递给下一个不知情的消费者。对外只留 draft（规划入口）与 live 分页。
 */
function exportSectionSnapshot(
  record: ChatRecord,
  byteLimit = SECTION_EXPORT_BYTE_LIMIT
) {
  if (!Number.isSafeInteger(byteLimit) || byteLimit <= 0) {
    throw new Error("Section 转录预算必须是正整数");
  }
  const captured = capturedThroughSeq(record);
  const messages = transcriptMessages(record, "pending");
  let selectedFrom = messages.length;
  let bodyBytes = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const projected = messages[index]!;
    const chunk = `${projected.text}\n\n`;
    const nextBodyBytes = bodyBytes + Buffer.byteLength(
      selectedFrom === messages.length ? chunk.trimEnd() : chunk,
      "utf8"
    );
    const bounds = index === messages.length - 1
      ? [projected]
      : [projected, messages.at(-1)!];
    const envelopeBytes = Buffer.byteLength(
      snapshotText(record, captured, messages, bounds, ""),
      "utf8"
    );
    if (envelopeBytes + nextBodyBytes <= byteLimit) {
      selectedFrom = index;
      bodyBytes = nextBodyBytes;
      continue;
    }
    break;
  }

  const selected = messages.slice(selectedFrom);
  let transcript = snapshotText(record, captured, messages, selected);
  if (selected.length === 0 && messages.length > 0) {
    const newest = messages.at(-1)!;
    const envelope = snapshotText(record, captured, messages, [newest], "");
    const remaining = Math.max(
      0,
      byteLimit - Buffer.byteLength(envelope, "utf8")
    );
    transcript = snapshotText(
      record,
      captured,
      messages,
      [newest],
      truncateUtf8(`${newest.text}\n`, remaining)
    );
  }
  if (Buffer.byteLength(transcript, "utf8") > byteLimit) {
    transcript = truncateUtf8(transcript, byteLimit);
  }
  const metadata: SectionSnapshotMetadata = {
    incarnation: record.incarnationId,
    capturedThroughSeq: captured,
    includedFromSeq:
      selected[0]?.message.seq ?? messages.at(-1)?.message.seq ?? captured + 1,
    includedThroughSeq:
      selected.at(-1)?.message.seq ?? messages.at(-1)?.message.seq ?? captured,
    trimmedThroughSeq: record.trimmedThroughSeq ?? 0,
  };
  return { transcript, metadata };
}

export function exportSectionSnapshotDraft(
  record: ChatRecord,
  byteLimit = SECTION_EXPORT_BYTE_LIMIT
): SectionSnapshotDraft {
  const snapshot = exportSectionSnapshot(record, byteLimit);
  const attachments = record.messages
    .filter(
      (message) =>
        message.role === "user" &&
        message.seq >= snapshot.metadata.includedFromSeq &&
        message.seq <= snapshot.metadata.includedThroughSeq
    )
    .flatMap((message) =>
      message.role === "user" ? message.attachments ?? [] : []
    );
  return {
    sectionId: record.id,
    incarnationId: record.incarnationId,
    sourceAgent: record.agent,
    capturedSeq: snapshot.metadata.capturedThroughSeq,
    includedFromSeq: snapshot.metadata.includedFromSeq,
    includedThroughSeq: snapshot.metadata.includedThroughSeq,
    transcript: snapshot.transcript,
    attachments,
  };
}

export function readSectionTranscriptPage(
  record: ChatRecord,
  byteLimit = SECTION_EXPORT_BYTE_LIMIT,
  fromSeq?: number
) {
  if (!Number.isSafeInteger(byteLimit) || byteLimit <= 0) {
    throw new Error("Section 转录预算必须是正整数");
  }
  const header = [
    "# Section live transcript",
    "",
    `- id: ${record.id}`,
    `- title: ${record.title ?? "未命名"}`,
    `- agent: ${record.agent}`,
    `- incarnation: ${record.incarnationId}`,
    `- trimmedThroughSeq: ${record.trimmedThroughSeq ?? 0}`,
    "",
    "> 这是独立 live 正向查询；from_seq 为 inclusive 起点，不是 @chat 快照续页。",
    "",
  ];
  const prefix = `${header.join("\n")}\n`;
  const messages = transcriptMessages(record, "read-section-only").filter(
    (message) => fromSeq === undefined || message.message.seq >= fromSeq
  );
  let transcript = prefix;
  let included = 0;
  let nextFromSeq: number | undefined;
  let messageTruncated = false;

  if (Buffer.byteLength(prefix, "utf8") >= byteLimit) {
    return {
      transcript: truncateUtf8(prefix, byteLimit),
      incarnation: record.incarnationId,
      trimmedThroughSeq: record.trimmedThroughSeq ?? 0,
      capturedThroughSeq: capturedThroughSeq(record),
      ...(messages[0] ? { next_from_seq: messages[0].message.seq } : {}),
    };
  }
  for (const message of messages) {
    const chunk = `${message.text}\n\n`;
    if (Buffer.byteLength(transcript + chunk, "utf8") <= byteLimit) {
      transcript += chunk;
      included += 1;
      continue;
    }
    if (included === 0) {
      const remaining = Math.max(
        0,
        byteLimit - Buffer.byteLength(prefix, "utf8") - 1
      );
      transcript = `${prefix}${truncateUtf8(chunk, remaining)}`;
      nextFromSeq = message.message.seq + 1;
      messageTruncated = true;
    } else {
      nextFromSeq = message.message.seq;
    }
    break;
  }
  return {
    transcript: transcript.trimEnd() + "\n",
    incarnation: record.incarnationId,
    trimmedThroughSeq: record.trimmedThroughSeq ?? 0,
    capturedThroughSeq: capturedThroughSeq(record),
    ...(nextFromSeq === undefined ? {} : { next_from_seq: nextFromSeq }),
    ...(messageTruncated ? { message_truncated: true as const } : {}),
  };
}
