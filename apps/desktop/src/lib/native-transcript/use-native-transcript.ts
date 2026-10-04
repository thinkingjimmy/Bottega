/**
 * [INPUT]: Depends on React external-store hooks, the shared TranscriptSession, the native TranscriptSource/rows, the chats timeline client and the
 *          chat-messages event store (for the Chat's head: newest seq, message revision, rewrites)
 * [OUTPUT]: Provides useNativeTranscript: one bounded TranscriptSession per native Chat incarnation, its snapshot as ChatMessage rows, and
 *           earlier/seek/latest actions for the timeline (TASK-25 S4d), and useWindowRows for readers that look rows up by id; after a rewrite the window stands down until the tail is re-read
 * [POS]: lib/native-transcript's React seam; the transcript view reads its window here instead of the unbounded session projection
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { TranscriptSession, type SessionHead } from "@ai-chat/chat-ui/transcript-session";
import type { ChatMessage } from "../../../shared/ipc/content/chats-ipc";
import { getChatTimelineAround, getChatTimelinePage } from "../chat/session/chats-client";
import { useChatMessages } from "../chat/state/chat-messages-store";
import { nativeTranscriptRows, nativeTranscriptSource } from "./source";

const source = nativeTranscriptSource({ timelinePage: getChatTimelinePage, timelineAround: getChatTimelineAround });
type Session = TranscriptSession<ChatMessage, ChatMessage, SessionHead>;
const IDLE = { items: [], busy: true, error: false, state: "pending" as const, canEarlier: false, latest: true };
const noop = () => () => {};

/* The window rows of each Chat's transcript, for readers outside the transcript view that look rows up by id (image tabs, visible content). */
const published = new Map<string, readonly ChatMessage[]>();
const watchers = new Map<string, Set<() => void>>();
const EMPTY: readonly ChatMessage[] = [];
function publish(chatId: string, rows: readonly ChatMessage[] | null) {
  if (rows) published.set(chatId, rows); else published.delete(chatId);
  for (const watcher of watchers.get(chatId) ?? []) watcher();
}
export function useWindowRows(chatId: string): readonly ChatMessage[] {
  const subscribe = useCallback((listener: () => void) => {
    const set = watchers.get(chatId) ?? new Set();
    set.add(listener); watchers.set(chatId, set);
    return () => { set.delete(listener); if (!set.size) watchers.delete(chatId); };
  }, [chatId]);
  const read = useCallback(() => published.get(chatId) ?? EMPTY, [chatId]);
  return useSyncExternalStore(subscribe, read, read);
}

const rowsOf = (session: Session | null) =>
  (session?.snapshot() ?? IDLE).items.map((item) => (item.kind === "native" ? item.body : item.entry));

export function useNativeTranscript(chatId: string, incarnationId: string | null | undefined, targetMessageId?: string | null) {
  const session = useMemo<Session | null>(
    () => (incarnationId ? new TranscriptSession<ChatMessage, ChatMessage, SessionHead>(chatId, source, targetMessageId ?? null, incarnationId, nativeTranscriptRows) : null),
    // A new target is a seek on the same session, not a new session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, incarnationId]
  );
  useEffect(() => {
    if (!session) return;
    session.open();
    return () => session.close();
  }, [session]);
  const snapshot = useSyncExternalStore(session?.subscribe ?? noop, session?.snapshot ?? (() => IDLE), session?.snapshot ?? (() => IDLE));

  /* The head is what the event store knows of this Chat: its newest native seq, message revision, and every rewrite (replace) as a new epoch. */
  const events = useChatMessages(chatId);
  const epoch = useRef({ key: "", value: 0 });
  useEffect(() => {
    if (!session || !events || events.incarnationId !== incarnationId) return;
    const replaceKey = `${events.incarnationId}:${events.revision}`;
    if (events.mode === "replace" && epoch.current.key !== replaceKey) epoch.current = { key: replaceKey, value: epoch.current.value + 1 };
    const headSeq = events.messages.reduce((top, row) => (row.segment === "imported" ? top : Math.max(top, row.seq)), 0);
    session.setHead({ chat: { id: chatId, incarnationId }, kind: "native", headSeq, bodyRevision: events.revision, rewriteEpoch: epoch.current.value });
  }, [chatId, events, incarnationId, session]);

  /* A rewrite (a revision) replaces the tail; until the session has re-read it, the window still holds the old rows, which must not be
     shown with the rewritten ones stitched after them. The projection stands in from the render the rewrite lands in. */
  const replaceKey = events?.mode === "replace" && events.incarnationId === incarnationId ? `${events.incarnationId}:${events.revision}` : null;
  const [settledRewrite, setSettledRewrite] = useState<string | null>(null);
  const stale = replaceKey !== null && replaceKey !== settledRewrite;
  const sawBusy = useRef(false);
  useEffect(() => {
    if (!stale) { sawBusy.current = false; return; }
    if (snapshot.busy) sawBusy.current = true;
    else if (sawBusy.current) setSettledRewrite(replaceKey);
  }, [replaceKey, snapshot.busy, stale]);
  const rows = useMemo(() => (stale ? [] : snapshot.items.map((item) => (item.kind === "native" ? item.body : item.entry))), [snapshot.items, stale]);
  useEffect(() => { publish(chatId, rows); return () => publish(chatId, null); }, [chatId, rows]);
  const earlier = useCallback(async () => { await session?.earlier(); return rowsOf(session); }, [session]);
  const seek = useCallback(async (messageId: string) => { await session?.seek(messageId); return rowsOf(session); }, [session]);
  const latest = useCallback(() => { void session?.latest(); }, [session]);
  return { rows, snapshot, earlier, seek, latest };
}
