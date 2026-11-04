/**
 * [INPUT]: Host-owned history ports, stable scroll handles, outer-row position lookup and bounded anchor memory.
 * [OUTPUT]: Provides TimelineReader and useTimelineReader: history paging, prepend scroll compensation, deep-link seeking, focus restoration, cross-mount anchor/offset restoration, and an in-place re-anchor on the newest rows when the host says its window was replaced (anchorKey).
 * [POS]: The timeline's state machine; adapters supply rows and reads, never a second window, and a port swap re-enters the transcript where the reader left it.
 */
import { flushSync } from "react-dom";
import { firstVisibleRow, atTranscriptBottom } from "./reading/position";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useScrollLockRelease, useConversationScrollElements } from "@ai-chat/ui/components/ai-elements/conversation";
import { initialTranscriptAnchor, transcriptWindow, includeTranscriptTarget, shouldRestoreTranscriptFocus, type TranscriptRow } from "./window";
import { findTranscriptTarget, highlightTranscriptTarget, scrollTranscriptTo, cancelTranscriptScroll, settleTranscriptBottom } from "./highlight";
import { forgetTimelineAnchor, recallTimelineAnchor, rememberTimelineAnchor } from "./anchor-memory";
export type TimelineReader<Row extends TranscriptRow> = {
  messages: readonly Row[]; hasMoreBefore: boolean;
  earlier(): Promise<readonly Row[] | null | undefined>;
  materialize(id: string): Promise<readonly Row[] | null | undefined>;
  routeSearch?: string;
  /** `chatId/incarnationId`. Both hosts pass the same key so one conversation keeps one anchor across a port swap. */
  memoryKey?: string;
  /** A new value says the host's rows were replaced by a different window (desktop: the projection standing in, then the window's first page). */
  anchorKey?: string;
};

export function useTimelineReader<Row extends TranscriptRow>({ messages, hasMoreBefore, earlier, materialize, routeSearch, memoryKey, anchorKey, setHistoryBatch }: TimelineReader<Row> & { setHistoryBatch(active: boolean): void }) {
  const { scrollRef, scrollToBottom, setScrollTop } = useConversationScrollElements();
  const releaseScrollLock = useScrollLockRelease();
  /* Read once, at mount: a remembered anchor is this conversation's own position from the port
     it was just showing in, so the window opens there instead of on the newest page. */
  const [recalled] = useState(() => recallTimelineAnchor(memoryKey));
  const [anchor, setAnchor] = useState(() =>
    recalled?.anchor ?? initialTranscriptAnchor(messages)
  );
  /* The reader anchors on its first render. When the host's rows are replaced by a different window, it starts over at the newest rows in
     place: the view stays mounted and pinned to the bottom, where a remount would paint a frame at the top first. A restored position wins. */
  const [anchoredFor, setAnchoredFor] = useState(anchorKey);
  if (anchorKey !== anchoredFor) {
    setAnchoredFor(anchorKey);
    if (!recalled) setAnchor(initialTranscriptAnchor(messages));
  }
  const pendingRestore = useRef(recalled);
  const entering = useRef(true);
  /* The re-anchored rows commit with the scroller still where the stand-in left it; pin to the newest row before paint, or the
     stick-to-bottom observer does it a frame or two late and the top of the new window flashes first. */
  const firstAnchor = useRef(anchoredFor);
  useLayoutEffect(() => {
    if (anchoredFor === firstAnchor.current || recalled) return;
    const scroller = scrollRef.current;
    if (scroller) setScrollTop(scroller.scrollHeight);
  }, [anchoredFor, recalled, scrollRef, setScrollTop]);
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null);
  const consumedRouteKeyRef = useRef<string | null>(null);
  const pendingRouteRef = useRef<{ key: string; id: string } | null>(null);
  const [announcement, setAnnouncement] = useState<{
    generation: number;
    count: number;
  } | null>(null);
  const compensation = useRef<{ id: string; top: number } | null>(null);
  const batchGeneration = useRef(0);
  const batchFrame = useRef(0);
  const topSentinel = useRef<HTMLDivElement | null>(null);
  const sentinelArmed = useRef(false);
  const setTopSentinel = useCallback((node: HTMLDivElement | null) => {
    topSentinel.current = node;
    if (!node || !entering.current) return;
    entering.current = false;
    // An incoming port renders before the outgoing port flushes its position.
    // A commit-time ref reads that final position before the new port paints.
    const latest = recallTimelineAnchor(memoryKey);
    pendingRestore.current = latest;
    if (latest !== recalled) setAnchor(latest?.anchor ?? initialTranscriptAnchor(messages));
  }, [memoryKey, messages, recalled]);
  const currentMessages = useRef(messages);
  const currentAnchor = useRef(anchor);
  useLayoutEffect(() => { currentMessages.current = messages; currentAnchor.current = anchor; });
  const loadingEarlier = useRef(false);
  const [loadingEarlierNow, setLoadingEarlierNow] = useState(false);
  const windowed = useMemo(
    () => transcriptWindow(messages, anchor),
    [anchor, messages]
  );
  const visibleMessages = windowed.messages;
  /* An empty read is not a clamp: the rows simply have not arrived yet, and treating it as one
     would throw away a restored anchor one frame before the transcript could honour it. */
  const anchorWasClamped =
    messages.length > 0 && anchor !== null && windowed.anchor?.id !== anchor.id;
  useLayoutEffect(() => {
    if (!anchorWasClamped) return;
    compensation.current = null;
    const frame = requestAnimationFrame(() => {
      setAnchor(windowed.anchor);
      setPendingJumpId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [anchorWasClamped, windowed.anchor]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const pendingCompensation = compensation.current;
    if (pendingCompensation) {
      const node = findTranscriptTarget(pendingCompensation.id, scroller);
      if (node) {
        scroller.scrollTop +=
          node.getBoundingClientRect().top - pendingCompensation.top;
      }
      compensation.current = null;

    }
    if (pendingJumpId && !anchorWasClamped) {
      const node = findTranscriptTarget(pendingJumpId, scroller);
      if (node) {
        scrollTranscriptTo(scroller, node, "auto");
        setPendingJumpId(null);
        highlightTranscriptTarget(node);
        const route = pendingRouteRef.current;
        if (route?.id === pendingJumpId) {
          consumedRouteKeyRef.current = route.key;
          pendingRouteRef.current = null;
        }
      }
    }
    const frame = requestAnimationFrame(() => { if (!loadingEarlier.current) setHistoryBatch(false); });
    return () => cancelAnimationFrame(frame);
  }, [
    anchorWasClamped,
    pendingJumpId,
    scrollRef,
    setHistoryBatch,
    windowed.anchor?.id,
  ]);

  /* The remembered row is only a row id until it is laid out. The first commit that has rows puts
     it back under the same pixel offset it had in the port the reader came from; a row that no
     longer exists simply releases the memory and leaves the window where the anchor clamped it. */
  useLayoutEffect(() => {
    const restore = pendingRestore.current;
    const scroller = scrollRef.current;
    if (!restore || !scroller || visibleMessages.length === 0) return;
    if (windowed.anchor?.id !== restore.anchor.id && messages.some(row => row.id === restore.anchor.id)) return;
    pendingRestore.current = null;
    // The same node set the offset was measured over; a selector would need CSS.escape for nothing.
    const node = findTranscriptTarget(restore.anchor.id, scroller);
    if (!node) return;
    releaseScrollLock();
    scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - restore.offsetTop;
  }, [messages, releaseScrollLock, scrollRef, visibleMessages, windowed.anchor?.id]);

  const cancelBatch = useCallback(() => {
    batchGeneration.current += 1;
    cancelAnimationFrame(batchFrame.current);
    loadingEarlier.current = false;
    compensation.current = null;
    if (scrollRef.current) cancelTranscriptScroll(scrollRef.current);
    setLoadingEarlierNow(false);
    setHistoryBatch(false);
  }, [scrollRef, setHistoryBatch]);

  const loadEarlier = useCallback(async () => {
    if (loadingEarlier.current) return;
    const scroller = scrollRef.current;
    if (!scroller || windowed.start <= 0 && !hasMoreBefore) return;
    const generation = ++batchGeneration.current;
    loadingEarlier.current = true;
    setLoadingEarlierNow(true);
    releaseScrollLock();
    setHistoryBatch(true);
    try {
      let page = messages;
      if (windowed.start === 0) {
        const next = await earlier();
        if (generation !== batchGeneration.current) return;
        if (!next) { cancelBatch(); return; }
        page = next;
      }
      const start = transcriptWindow(page, windowed.anchor).start;
      const target = Math.max(0, start - 60);
      const count = start - target;
      if (!count) { cancelBatch(); return; }
      const focusTrigger = document.activeElement instanceof HTMLElement && document.activeElement.hasAttribute("data-load-earlier");
      let cursor = start;
      const step = () => {
        if (generation !== batchGeneration.current || !scroller.isConnected) return;
        const first = firstVisibleRow(scroller);
        if (first) compensation.current = { id: first.id, top: first.top };
        cursor = Math.max(target, cursor - 15);
        const row = page[cursor];
        // One DOM commit per frame; a transition alone would still insert the full page at once.
        flushSync(() => setAnchor({ id: row.id, seq: row.seq, ...(row.segment ? { segment: row.segment } : {}) }));
        if (cursor > target) batchFrame.current = requestAnimationFrame(step);
        else {
          loadingEarlier.current = false;
          setLoadingEarlierNow(false);
          setHistoryBatch(false);
          setAnnouncement(current => ({ generation: (current?.generation ?? 0) + 1, count }));
          if (shouldRestoreTranscriptFocus(target, focusTrigger)) scroller.querySelector<HTMLElement>("[data-message-id]")?.focus({ preventScroll: true });
        }
      };
      batchFrame.current = requestAnimationFrame(step);
    } catch { if (generation === batchGeneration.current) cancelBatch(); }
  }, [cancelBatch, earlier, hasMoreBefore, messages, releaseScrollLock, scrollRef, setHistoryBatch, windowed.anchor, windowed.start]);

  useEffect(() => {
    const root = scrollRef.current, sentinel = topSentinel.current;
    if (!root || !sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        // Initial bottom positioning briefly exposes the sentinel before rows settle.
        if (!entry.isIntersecting) sentinelArmed.current = true;
        else if (sentinelArmed.current && root.scrollHeight > root.clientHeight) void loadEarlier();
      }
    }, { root, rootMargin: "96px 0px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadEarlier, scrollRef]);

  const reclaim = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller || !atTranscriptBottom(scroller) || loadingEarlier.current) return;
    // Do not remove an active editor, selected text or a keyboard-focused historical control.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && scroller.contains(selection.anchorNode)) return;
    const focusedRow = document.activeElement?.closest<HTMLElement>("[data-message-id]");
    const latest = initialTranscriptAnchor(currentMessages.current);
    const start = transcriptWindow(currentMessages.current, latest).start;
    if (focusedRow && currentMessages.current.slice(0, start).some(row => row.id === focusedRow.dataset.messageId)) return;
    if (latest?.id === currentAnchor.current?.id) return;
    flushSync(() => setAnchor(latest));
    settleTranscriptBottom(scroller, () => {
      setScrollTop(scroller.scrollHeight);
      void scrollToBottom({ animation: "instant" });
    });
    if (memoryKey) forgetTimelineAnchor(memoryKey);
  }, [memoryKey, scrollRef, scrollToBottom, setScrollTop]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let dirty = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let shrink: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(idle);
      if (!dirty || pendingRestore.current || !memoryKey) return;
      dirty = false;
      if (atTranscriptBottom(scroller)) { forgetTimelineAnchor(memoryKey); return; }
      const visible = firstVisibleRow(scroller);
      const row = visible && currentMessages.current.find(message => message.id === visible.id);
      if (visible && row) rememberTimelineAnchor(memoryKey, { anchor: { id: row.id, seq: row.seq, ...(row.segment ? { segment: row.segment } : {}) }, offsetTop: visible.offsetTop });
    };
    const onScroll = () => {
      dirty = true;
      clearTimeout(idle); clearTimeout(shrink);
      idle = setTimeout(flush, 150);
      shrink = setTimeout(reclaim, 2000);
    };
    const latest = () => {
      cancelBatch();
      setPendingJumpId(null);
      pendingRouteRef.current = null;
      setScrollTop(scroller.scrollHeight);
      reclaim();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("scrollend", flush);
    scroller.addEventListener("transcript-latest", latest);
    window.addEventListener("pagehide", flush);
    return () => {
      flush(); clearTimeout(shrink);
      cancelTranscriptScroll(scroller);
      batchGeneration.current += 1;
      cancelAnimationFrame(batchFrame.current);
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("scrollend", flush);
      scroller.removeEventListener("transcript-latest", latest);
      window.removeEventListener("pagehide", flush);
    };
  }, [cancelBatch, memoryKey, reclaim, scrollRef, setScrollTop]);

  const jumpTo = useCallback((id: string) => {
    const scroller = scrollRef.current;
    if (!scroller) return false;
    cancelBatch();
    const generation = batchGeneration.current;
    setPendingJumpId(null);
    if (pendingRouteRef.current?.id !== id) pendingRouteRef.current = null;
    releaseScrollLock();
    const node = findTranscriptTarget(id, scroller);
    if (node) {
      scrollTranscriptTo(scroller, node, "smooth");
      highlightTranscriptTarget(node);
      return true;
    }
    setHistoryBatch(true);
    setPendingJumpId(id);
    setAnchor((current) => includeTranscriptTarget(messages, current, id));
    void materialize(id)
      .then((snapshot) => {
        if (generation !== batchGeneration.current) return;
        if (!snapshot) {
          setPendingJumpId(null);
          setHistoryBatch(false);
          return;
        }
        setAnchor((current) =>
          includeTranscriptTarget(snapshot, current, id)
        );
      })
      .catch(() => {
        if (generation !== batchGeneration.current) return;
        setPendingJumpId(null);
        setHistoryBatch(false);
      });
    return false;
  }, [cancelBatch, materialize, messages, releaseScrollLock, scrollRef, setHistoryBatch]);

  useLayoutEffect(() => {
    const routeKey = routeSearch ?? "";
    if (consumedRouteKeyRef.current === routeKey) return;
    const searchParams = new URLSearchParams(routeSearch ?? "");
    const id = searchParams.get("m");
    if (!id && searchParams.get("fork") === "divider") {
      const divider = scrollRef.current?.querySelector("[data-fork-divider]");
      if (divider instanceof HTMLElement) {
        releaseScrollLock();
        divider.scrollIntoView({ behavior: "smooth", block: "center" });
        divider.focus({ preventScroll: true });
        highlightTranscriptTarget(divider);
        consumedRouteKeyRef.current = routeKey;
      }
      return;
    }
    if (!id) {
      pendingRouteRef.current = null;
      return;
    }
    pendingRouteRef.current = { key: routeKey, id };
    if (jumpTo(id)) {
      consumedRouteKeyRef.current = routeKey;
      pendingRouteRef.current = null;
    }
  }, [jumpTo, releaseScrollLock, routeSearch, scrollRef]);

  return { setTopSentinel, messages: visibleMessages, hasEarlier: windowed.start > 0 || hasMoreBefore, loadingEarlier: loadingEarlierNow, loadEarlier, jumpTo, announcement };
}
