/**
 * [INPUT]: Depends on AI Elements Message format, Share Button/Spinner, Codex clipboard boundaries, ResizeObserver and Plan open state
 * [OUTPUT]: Provides PlanCard, with fixed maximum height, step by step as required, open with a real click and Editing Spinner Unified rendering of the terminal/flow Plan
 * [POS]: The Plan message visual unit of chat/transcript, which is replicated by ChatTurn and ChatTurnDraft; The full content is read by the third generation
 */

import {
  MessageContent,
  MessageResponse,
} from "@ai-chat/ui/components/ai-elements/message";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { cn } from "@ai-chat/ui/lib/utils";
import {
  CheckIcon,
  CopyIcon,
  LightbulbIcon,
  Maximize2Icon,
  Minimize2Icon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { writeClipboardText } from "@/lib/agent-client";
import { capMarkdown } from "@/lib/charts/chart-markdown";

export function PlanCard({
  content,
  editing,
  isExpanded,
  onToggle,
  copyable,
}: {
  content: string;
  editing: boolean;
  isExpanded: boolean;
  onToggle?: () => void;
  copyable: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useLayoutEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    const update = () =>
      setHasMore(preview.scrollHeight > preview.clientHeight + 1);
    const frame = window.requestAnimationFrame(update);
    if (typeof ResizeObserver === "undefined") {
      return () => window.cancelAnimationFrame(frame);
    }
    const observer = new ResizeObserver(update);
    observer.observe(preview);
    if (preview.firstElementChild) observer.observe(preview.firstElementChild);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [content]);

  const activate = () => onToggle?.();

  return (
    <section className="w-full rounded-2xl border bg-background p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {editing ? (
          <Spinner
            aria-label="Plan 编辑中"
            className="size-4 text-muted-foreground"
          />
        ) : (
          <LightbulbIcon className="size-4" />
        )}
        <span className="text-sm">{editing ? "Editing" : "Plan"}</span>
        <div className="ml-auto flex items-center gap-1">
          {copyable && (
            <Button
              aria-label={copied ? "Copied" : "Copy plan"}
              className="cursor-pointer"
              onClick={() =>
                void writeClipboardText(content).then(() => setCopied(true))
              }
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          )}
          {onToggle && (
            <Button
              aria-label={isExpanded ? "收起 Plan 第三栏" : "在第三栏显示 Plan"}
              aria-pressed={isExpanded}
              className="cursor-pointer"
              onClick={onToggle}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              {isExpanded ? <Minimize2Icon /> : <Maximize2Icon />}
            </Button>
          )}
        </div>
      </div>
      <div
        ref={previewRef}
        aria-label={
          onToggle
            ? isExpanded
              ? "收起 Plan 第三栏"
              : "在第三栏显示完整 Plan"
            : undefined
        }
        className={cn(
          "relative max-h-80 overflow-hidden rounded-lg",
          onToggle &&
            "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        )}
        onClick={onToggle ? activate : undefined}
        onKeyDown={
          onToggle
            ? (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                activate();
              }
            : undefined
        }
        role={onToggle ? "button" : undefined}
        tabIndex={onToggle ? 0 : undefined}
      >
        <MessageContent className="pt-3">
          <MessageResponse isAnimating={editing}>
            {capMarkdown(content)}
          </MessageResponse>
        </MessageContent>
        {hasMore && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent via-background/85 to-background"
          />
        )}
      </div>
    </section>
  );
}
