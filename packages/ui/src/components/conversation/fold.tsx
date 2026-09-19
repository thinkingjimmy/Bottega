/**
 * [INPUT]: Depends on host-provided labels/content, shared resize measurement and optional conversation scroll-lock release.
 * [OUTPUT]: Provides ConversationFold with the native 12-line preview, overflow fade and accessible expansion control.
 * [POS]: Shared user-message body fold for native, remote and imported conversations.
 */
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useScrollLockRelease } from "../ai-elements/conversation";
import { Button } from "../ui/button";
import { observeSharedResize } from "./resize";

const USER_MESSAGE_PREVIEW_LINES = 12;
const DEFAULT_USER_MESSAGE_LINE_HEIGHT = 20;

function userMessageOverflows(preview: HTMLDivElement, body: HTMLDivElement) {
  const measured = Number.parseFloat(
    window.getComputedStyle(preview).lineHeight,
  );
  const lineHeight =
    Number.isFinite(measured) && measured > 0
      ? measured
      : DEFAULT_USER_MESSAGE_LINE_HEIGHT;
  return body.scrollHeight > lineHeight * USER_MESSAGE_PREVIEW_LINES + 1;
}

export function ConversationFold({
  children,
  measurementKey,
  showMore,
  showLess,
}: {
  children: ReactNode;
  measurementKey?: unknown;
  showMore: string;
  showLess: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const stopScroll = useScrollLockRelease();

  useLayoutEffect(() => {
    const preview = previewRef.current;
    const body = bodyRef.current;
    if (!preview || !body) return;
    const update = () => setHasMore(userMessageOverflows(preview, body));
    const frame = window.requestAnimationFrame(update);
    const stopPreview = observeSharedResize(preview, update);
    const stopBody = observeSharedResize(body, update);
    return () => {
      window.cancelAnimationFrame(frame);
      stopPreview();
      stopBody();
    };
  }, [measurementKey]);

  const toggle = () => {
    if (!expanded) stopScroll();
    setExpanded((current) => !current);
  };

  return (
    <>
      <div
        className={
          expanded ? "relative" : "relative max-h-[12lh] overflow-hidden"
        }
        data-user-message-preview=""
        id={contentId}
        ref={previewRef}
      >
        <div data-user-message-body="" ref={bodyRef}>
          {children}
        </div>
        {hasMore && !expanded && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent via-secondary/85 to-secondary"
            data-user-message-fade=""
          />
        )}
      </div>
      {hasMore && (
        <Button
          aria-controls={contentId}
          aria-expanded={expanded}
          className="relative -ml-2 h-8 self-start px-2 text-muted-foreground text-sm font-normal touch-manipulation touch-target-44 hover:text-foreground"
          onClick={toggle}
          size="sm"
          type="button"
          variant="ghost"
        >
          {expanded ? showLess : showMore}
          {expanded ? (
            <ChevronUp aria-hidden="true" data-icon="inline-end" />
          ) : (
            <ChevronDown aria-hidden="true" data-icon="inline-end" />
          )}
        </Button>
      )}
    </>
  );
}
