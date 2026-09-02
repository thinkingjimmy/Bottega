/**
 * [INPUT]: Depends on the canonical segment/id/seq of ChatMessage and the shared segment-then-seq order key; Receiving current hits, expanding window steps and jumping targets
 * [OUTPUT]: Provides initialization of tail progression windows, cutout slots, forward extension and targeting for pure functions; anchors carry their segment so imported and native seq ranges never collide
 * [POS]: The kernel of the chat/transcript state machine; React is solely responsible for submitting and rolling compensation, where the identity/cutting semantics can be independently tested
 */

import type { ChatMessage } from "../../../../shared/chats-ipc";
import { chatSegmentRank } from "@/lib/chat-turn-attach";

export const TRANSCRIPT_WINDOW_SIZE = 60;

/* 锚点必须与消息同序：导入段与原生段各自从 seq 1 起编号，只带 seq 的锚
   在一条被收养的会话里会同时命中两条消息。段随锚一起走，比较键才唯一。 */
export type TranscriptAnchor =
  | { id: string; seq: number; segment?: ChatMessage["segment"] }
  | null;

const compareToAnchor = (
  message: ChatMessage,
  anchor: NonNullable<TranscriptAnchor>
) =>
  chatSegmentRank(message.segment) - chatSegmentRank(anchor.segment) ||
  message.seq - anchor.seq;

export const shouldRestoreTranscriptFocus = (
  nextStart: number,
  activeIsLoadTrigger: boolean
) => nextStart === 0 && activeIsLoadTrigger;

const anchorOf = (message: ChatMessage | undefined): TranscriptAnchor =>
  message
    ? {
        id: message.id,
        seq: message.seq,
        ...(message.segment ? { segment: message.segment } : {}),
      }
    : null;

export function initialTranscriptAnchor(
  messages: readonly ChatMessage[],
  size = TRANSCRIPT_WINDOW_SIZE
) {
  return anchorOf(messages[Math.max(0, messages.length - size)]);
}

export function resolveTranscriptAnchor(
  messages: readonly ChatMessage[],
  anchor: TranscriptAnchor
) {
  if (!messages.length) return null;
  if (!anchor) return initialTranscriptAnchor(messages);
  const exact = messages.find((message) => message.id === anchor.id);
  if (exact) return compareToAnchor(exact, anchor) === 0 ? anchor : anchorOf(exact);
  // canonical 裁剪只从头部移除：旧锚消失时，以「段+seq」找第一条 retained；
  // 若它也落在 retained 尾后，首条仍是唯一不会把整窗变空的安全钳位。
  return anchorOf(
    messages.find((message) => compareToAnchor(message, anchor) >= 0) ??
      messages[0]
  );
}

export function transcriptWindow(
  messages: readonly ChatMessage[],
  anchor: TranscriptAnchor
) {
  const resolved = resolveTranscriptAnchor(messages, anchor);
  if (!resolved) return { anchor: null, start: 0, messages: [] as ChatMessage[] };
  const start = Math.max(
    0,
    messages.findIndex((message) => message.id === resolved.id)
  );
  return { anchor: resolved, start, messages: messages.slice(start) };
}

export function expandTranscriptAnchor(
  messages: readonly ChatMessage[],
  anchor: TranscriptAnchor,
  size = TRANSCRIPT_WINDOW_SIZE
) {
  const current = transcriptWindow(messages, anchor);
  return anchorOf(messages[Math.max(0, current.start - size)]);
}

export function includeTranscriptTarget(
  messages: readonly ChatMessage[],
  anchor: TranscriptAnchor,
  targetId: string
) {
  const current = transcriptWindow(messages, anchor);
  const target = messages.findIndex((message) => message.id === targetId);
  return target >= 0 && target < current.start
    ? anchorOf(messages[target])
    : current.anchor;
}
