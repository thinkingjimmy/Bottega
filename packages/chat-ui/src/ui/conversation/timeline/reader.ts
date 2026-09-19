/**
 * [INPUT]: Host-owned paged history reads, the window maths, the highlight helpers and the per-conversation anchor memory.
 * [OUTPUT]: Provides TimelineReader and useTimelineReader: history paging, prepend scroll compensation, deep-link seeking, focus restoration and cross-mount anchor/offset restoration.
 * [POS]: The timeline's state machine; adapters supply rows and reads, never a second window, and a port swap re-enters the transcript where the reader left it.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useScrollLockRelease, useStickToBottomContext } from "@ai-chat/ui/components/ai-elements/conversation";
import { initialTranscriptAnchor, transcriptWindow, expandTranscriptAnchor, includeTranscriptTarget, shouldRestoreTranscriptFocus, type TranscriptRow } from "./window";
import { findTranscriptTarget, highlightTranscriptTarget, scrollTranscriptTo } from "./highlight";
import { forgetTimelineAnchor, recallTimelineAnchor, rememberTimelineAnchor } from "./anchor-memory";
export type TimelineReader<Row extends TranscriptRow> = {
  messages: readonly Row[]; hasMoreBefore: boolean;
  earlier(): Promise<readonly Row[] | null | undefined>;
  materialize(id: string): Promise<readonly Row[] | null | undefined>;
  routeSearch?: string;
  /** `chatId/incarnationId`. Both hosts pass the same key so one conversation keeps one anchor across a port swap. */
  memoryKey?: string;
};
const transcriptRows = (scroller: HTMLElement) => [...scroller.querySelectorAll("[data-message-id]")].filter((node): node is HTMLElement => node instanceof HTMLElement);
/** The first row still inside the scroller, with its top edge measured both absolutely and relative to it. */
function firstVisibleRow(scroller: HTMLElement) {
  const scrollerTop = scroller.getBoundingClientRect().top;
  for (const node of transcriptRows(scroller)) {
    const box = node.getBoundingClientRect();
    if (box.bottom >= scrollerTop) return { id: node.dataset.messageId!, top: box.top, offsetTop: box.top - scrollerTop };
  }
  return null;
}
/* Sitting at the newest row is not a position worth restoring: the next mount should follow the
   conversation forward, exactly as it does today. Only a reader who scrolled away has an offset. */
const AT_BOTTOM_SLACK = 24;

export function useTimelineReader<Row extends TranscriptRow>({ messages, hasMoreBefore, earlier, materialize, routeSearch, memoryKey, setHistoryBatch }: TimelineReader<Row> & { setHistoryBatch(active: boolean): void }) {
  const { scrollRef } = useStickToBottomContext();
  const releaseScrollLock = useScrollLockRelease();
  /* Read once, at mount: a remembered anchor is this conversation's own position from the port
     it was just showing in, so the window opens there instead of on the newest page. */
  const [recalled] = useState(() => recallTimelineAnchor(memoryKey));
  const [anchor, setAnchor] = useState(() =>
    recalled?.anchor ?? initialTranscriptAnchor(messages)
  );
  const pendingRestore = useRef(recalled);
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null);
  const consumedRouteKeyRef = useRef<string | null>(null);
  const pendingRouteRef = useRef<{ key: string; id: string } | null>(null);
  const [announcement, setAnnouncement] = useState<{
    generation: number;
    count: number;
  } | null>(null);
  const compensation = useRef<{ id: string; top: number } | null>(null);
  const restoreFocusAfterExpand = useRef(false);
  const loadedCount = useRef(0);
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
      if (loadedCount.current > 0) {
        setAnnouncement((current) => ({
          generation: (current?.generation ?? 0) + 1,
          count: loadedCount.current,
        }));
      }
    }
    if (restoreFocusAfterExpand.current) {
      const first = scroller.querySelector("[data-message-id]");
      if (first instanceof HTMLElement) first.focus({ preventScroll: true });
      restoreFocusAfterExpand.current = false;
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
    const frame = requestAnimationFrame(() => setHistoryBatch(false));
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
    pendingRestore.current = null;
    // The same node set the offset was measured over; a selector would need CSS.escape for nothing.
    const node = transcriptRows(scroller).find(row => row.dataset.messageId === restore.anchor.id);
    if (!node) return;
    releaseScrollLock();
    scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - restore.offsetTop;
  }, [releaseScrollLock, scrollRef, visibleMessages]);

  const loadEarlier = useCallback(async () => {
    if (loadingEarlier.current) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (windowed.start <= 0 && !hasMoreBefore) return;
    loadingEarlier.current = true;
    setLoadingEarlierNow(true);
    releaseScrollLock();
    setHistoryBatch(true);
    const firstVisible = firstVisibleRow(scroller);
    if (firstVisible) compensation.current = { id: firstVisible.id, top: firstVisible.top };
    try {
      if (windowed.start > 0) {
        const next = expandTranscriptAnchor(messages, windowed.anchor);
        const nextStart = transcriptWindow(messages, next).start;
        restoreFocusAfterExpand.current = shouldRestoreTranscriptFocus(
          nextStart,
          document.activeElement instanceof HTMLElement &&
            document.activeElement.hasAttribute("data-load-earlier")
        );
        loadedCount.current = windowed.start - nextStart;
        setAnchor(next);
        return;
      }
      const page = await earlier();
      const known = new Set(messages.map(message => message.id));
      const added = page?.filter(message => !known.has(message.id)).length ?? 0;
      if (!page || added === 0) {
        /* 没有新行就没有位移要补：把补偿留在原地，下一次真正的加载会拿它
           去对一个早已换过内容的坐标，滚动条于是跳一下。 */
        compensation.current = null;
        setHistoryBatch(false);
        return;
      }
      loadedCount.current = added;
      setAnchor((current) => expandTranscriptAnchor(page, current));
    } catch {
      compensation.current = null;
      setHistoryBatch(false);
    } finally {
      loadingEarlier.current = false;
      setLoadingEarlierNow(false);
    }
  }, [
    earlier,
    hasMoreBefore,
    messages,
    releaseScrollLock,
    scrollRef,
    setHistoryBatch,
    windowed.anchor,
    windowed.start,
  ]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onScroll = () => {
      if (scroller.scrollTop <= 96 && scroller.scrollHeight > scroller.clientHeight) {
        void loadEarlier();
      }
      // A restore that has not run yet must not be overwritten by the mount's own scroll to bottom.
      if (pendingRestore.current || !memoryKey) return;
      if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= AT_BOTTOM_SLACK) {
        forgetTimelineAnchor(memoryKey);
        return;
      }
      const visible = firstVisibleRow(scroller);
      const row = visible && messages.find(message => message.id === visible.id);
      if (!visible || !row) return;
      rememberTimelineAnchor(memoryKey, { anchor: { id: row.id, seq: row.seq, ...(row.segment ? { segment: row.segment } : {}) }, offsetTop: visible.offsetTop });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [loadEarlier, memoryKey, messages, scrollRef]);

  const jumpTo = useCallback((id: string) => {
    const scroller = scrollRef.current;
    if (!scroller) return false;
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
        setPendingJumpId(null);
        setHistoryBatch(false);
      });
    return false;
  }, [materialize, messages, releaseScrollLock, scrollRef, setHistoryBatch]);

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

  return { messages: visibleMessages, hasEarlier: windowed.start > 0 || hasMoreBefore, loadingEarlier: loadingEarlierNow, loadEarlier, jumpTo, announcement };
}
