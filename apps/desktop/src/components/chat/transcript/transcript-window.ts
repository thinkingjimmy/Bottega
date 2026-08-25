/**
 * [INPUT]: Depends on the canonical id/seq of ChatMessage; Receiving current hits, expanding window steps and jumping targets
 * [OUTPUT]: Provides initialization of tail progression windows, cutout slots, forward extension and targeting for pure functions
 * [POS]: The kernel of the chat/transcript state machine; React is solely responsible for submitting and rolling compensation, where the identity/cutting semantics can be independently tested
 */

import type { ChatMessage } from "../../../../shared/chats-ipc";

export const TRANSCRIPT_WINDOW_SIZE = 60;

export type TranscriptAnchor = { id: string; seq: number } | null;

export const shouldRestoreTranscriptFocus = (
  nextStart: number,
  activeIsLoadTrigger: boolean
) => nextStart === 0 && activeIsLoadTrigger;

const anchorOf = (message: ChatMessage | undefined): TranscriptAnchor =>
  message ? { id: message.id, seq: message.seq } : null;

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
  if (exact) return exact.seq === anchor.seq ? anchor : anchorOf(exact);
  // canonical 裁剪只从头部移除：旧锚消失时，以 seq 找第一条 retained；
  // 若 seq 也落在 retained 尾后，首条仍是唯一不会把整窗变空的安全钳位。
  return anchorOf(
    messages.find((message) => message.seq >= anchor.seq) ?? messages[0]
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
