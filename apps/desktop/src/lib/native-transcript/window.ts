/**
 * [INPUT]: Depends on the shared ChatMessage shape
 * [OUTPUT]: Provides recentTurns and lastCanonicalSeq (the minimal session projection and its canonical tail), conversationRows (window ∪ projection for lookups by id), windowedMessages: the rows the native transcript renders from the bounded window and the session projection,
 *           and windowGap: the rows missing between the window and the projection's newer rows, named before the first newer row
 * [POS]: Pure rule of lib/native-transcript, used by the desktop ChatTranscript (TASK-25 S4d)
 */

import type { ChatMessage } from "../../../shared/ipc/content/chats-ipc";

/** A local-only row (a local error) sorts after everything with this seq; it is never a canonical position. */
const LOCAL_SEQ = Number.MAX_SAFE_INTEGER;
const newestNative = (window: readonly ChatMessage[]) => window.reduce((top, row) => (row.segment === "imported" ? top : Math.max(top, row.seq)), 0);
const newerRows = (window: readonly ChatMessage[], projected: readonly ChatMessage[]) => {
  const shown = new Set(window.map((row) => row.id)), newest = newestNative(window);
  return projected.filter((row) => !shown.has(row.id) && row.segment !== "imported" && row.seq > newest);
};

/** Window rows, followed at the newest messages by the projection's newer native or local rows; the projection alone until the first page lands. */
export function windowedMessages(window: readonly ChatMessage[], projected: readonly ChatMessage[], latest: boolean): ChatMessage[] {
  if (!window.length) return [...projected];
  if (!latest) return [...window];
  const tail = newerRows(window, projected);
  return tail.length ? [...window, ...tail] : [...window];
}

/**
 * D-05: the newer rows that follow the window at the newest messages must not hide what the window lacks (a lagging or failed read).
 * Native seqs within one rewrite epoch run without holes, so the difference is the count; past the imported prefix it is unknown.
 */
export function windowGap(window: readonly ChatMessage[], projected: readonly ChatMessage[], latest: boolean): { before: string; count: number | null } | null {
  if (!window.length || !latest) return null;
  const first = newerRows(window, projected).find((row) => row.seq !== LOCAL_SEQ);
  if (!first) return null;
  const newest = newestNative(window);
  if (newest === 0) return first.seq > 1 ? { before: first.id, count: null } : null;
  return first.seq > newest + 1 ? { before: first.id, count: first.seq - newest - 1 } : null;
}



/**
 * The session projection keeps only what its readers need (TASK-25 S4d step 3): the last `turns` turns, counted from the last user
 * messages (native or imported), plus local rows. History lives in the transcript window, not here.
 */
export function recentTurns(messages: readonly ChatMessage[], turns = 2): ChatMessage[] {
  let seen = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]!.role === "user" && ++seen === turns) return messages.slice(index);
  }
  return [...messages];
}

/** The newest canonical seq, ignoring local-only rows. */
export function lastCanonicalSeq(messages: readonly ChatMessage[]): number | undefined {
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index]!.seq !== LOCAL_SEQ) return messages[index]!.seq;
  return undefined;
}

/** Everything this Chat has on hand for a lookup by id (an image tab, visible content): the transcript window plus the projection. */
export function conversationRows(window: readonly ChatMessage[], projected: readonly ChatMessage[]): ChatMessage[] {
  if (!window.length) return [...projected];
  const shown = new Set(window.map((row) => row.id));
  return [...window, ...projected.filter((row) => !shown.has(row.id))];
}
