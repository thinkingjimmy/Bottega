/**
 * [INPUT]: Depends on the window module's anchor shape; it touches no DOM and no React.
 * [OUTPUT]: Provides rememberTimelineAnchor/recallTimelineAnchor/forgetTimelineAnchor — a bounded per-conversation memory of the anchor row and its pixel offset.
 * [POS]: The timeline's cross-mount continuity store; reader.ts is its only production caller, and the two hosts share it by passing the same conversation key.
 */
import type { TranscriptAnchor } from "./window";

export type TimelineAnchorMemory = {
  /** The row the window opens on when the transcript is mounted again. */
  anchor: NonNullable<TranscriptAnchor>;
  /** That row's top edge in pixels, measured from the scroller's own top edge. */
  offsetTop: number;
};

/* Switching the executor re-mounts the transcript from the other port. Without a memory the
   new mount opens on the newest rows and the reader scrolls to the bottom, which reads as the
   conversation jumping away mid-sentence. The key carries the incarnation, so a forked or
   re-imported conversation never inherits a stale offset; the bound keeps a long session's
   worth of conversations without growing without limit. */
const MEMORY_LIMIT = 32;
const remembered = new Map<string, TimelineAnchorMemory>();

export function rememberTimelineAnchor(key: string | undefined, memory: TimelineAnchorMemory) {
  if (!key) return;
  remembered.delete(key);
  remembered.set(key, memory);
  while (remembered.size > MEMORY_LIMIT) {
    const oldest = remembered.keys().next().value;
    if (oldest === undefined) return;
    remembered.delete(oldest);
  }
}

export function recallTimelineAnchor(key: string | undefined) {
  if (!key) return null;
  const memory = remembered.get(key);
  if (!memory) return null;
  remembered.delete(key);
  remembered.set(key, memory);
  return memory;
}

/** A conversation that is gone — deleted, archived away or re-incarnated — keeps no offset. */
export function forgetTimelineAnchor(key: string) {
  remembered.delete(key);
}
