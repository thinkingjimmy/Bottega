/**
 * [INPUT]: Depends on AI Elements message primitives, localized Plan controls, clipboard, ResizeObserver, and controlled side-panel expansion state
 * [OUTPUT]: Provides PlanCard with a bounded preview, localized editing/copy/expand controls, and keyboard-equivalent activation
 * [POS]: Plan message unit of chat/transcript, shared by final and streaming turns while the side panel owns full-content display
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
import { useAppTranslation } from "@/components/providers/i18n-provider";

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
  const { t } = useAppTranslation();
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
            aria-label={t("chat.transcript.plan.editingAria")}
            className="size-4 text-muted-foreground"
          />
        ) : (
          <LightbulbIcon className="size-4" />
        )}
        <span className="text-sm">
          {t(
            editing
              ? "chat.transcript.plan.editing"
              : "chat.transcript.plan.title"
          )}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {copyable && (
            <Button
              aria-label={t(
                copied
                  ? "chat.transcript.plan.copied"
                  : "chat.transcript.plan.copy"
              )}
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
              aria-label={t(
                isExpanded
                  ? "chat.transcript.plan.collapsePanel"
                  : "chat.transcript.plan.showPanel"
              )}
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
              ? t("chat.transcript.plan.collapsePanel")
              : t("chat.transcript.plan.showFullPanel")
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
