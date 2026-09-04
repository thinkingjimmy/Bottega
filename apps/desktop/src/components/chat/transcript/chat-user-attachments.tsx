/**
 * [INPUT]: Depends on UI Button/Skeleton, localized transcript controls, conversation scroll unlock, shared ResizeObserver, ChatAttachmentMeta, live previews, and attachment read/open intents
 * [OUTPUT]: Provides localized UserMessageFold with hover feedback, directional expansion chevrons, and a 44px touch target, plus ChatUserAttachments with 12-line measurement, lazy stored previews, and side-panel image actions
 * [POS]: User-message body and attachment display unit consumed by the ChatTranscript user branch
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useScrollLockRelease } from "@ai-chat/ui/components/ai-elements/conversation";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ChatAttachmentMeta } from "../../../../shared/chats-ipc";
import type { LiveAttachmentPreview } from "../runtime/chat-attachments";
import { observeSharedResize } from "./shared-resize-observer";
import { useAppTranslation } from "@/components/providers/i18n-provider";

const USER_MESSAGE_PREVIEW_LINES = 12;
const DEFAULT_USER_MESSAGE_LINE_HEIGHT = 20;

function userMessageOverflows(
  preview: HTMLDivElement,
  body: HTMLDivElement
) {
  const measured = Number.parseFloat(
    window.getComputedStyle(preview).lineHeight
  );
  const lineHeight = Number.isFinite(measured) && measured > 0
    ? measured
    : DEFAULT_USER_MESSAGE_LINE_HEIGHT;
  return body.scrollHeight > lineHeight * USER_MESSAGE_PREVIEW_LINES + 1;
}

export function UserMessageFold({
  children,
  measurementKey,
}: {
  children: ReactNode;
  measurementKey?: unknown;
}) {
  const { t } = useAppTranslation();
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
          className="-ml-2 h-8 self-start px-2 text-muted-foreground text-sm font-normal touch-manipulation touch-target-44 hover:text-foreground"
          onClick={toggle}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t(
            expanded
              ? "chat.transcript.showLess"
              : "chat.transcript.showMore"
          )}
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

function Thumb({
  filename,
  url,
  onOpen,
}: {
  filename: string;
  url: string;
  onOpen?: () => void;
}) {
  const { t } = useAppTranslation();
  if (!url) {
    return (
      <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
        {filename}
      </span>
    );
  }
  const image = (
    <img
      alt={filename}
      className="size-16 rounded-md border object-cover"
      draggable={false}
      src={url}
      title={filename}
    />
  );
  if (!onOpen) return image;
  return (
    <button
      aria-label={t("chat.transcript.openAttachmentInSidePanel", {
        title: filename,
      })}
      className="size-16 cursor-pointer touch-manipulation rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      onClick={onOpen}
      type="button"
    >
      {image}
    </button>
  );
}

function StoredThumb({
  meta,
  onOpen,
}: {
  meta: ChatAttachmentMeta;
  onOpen?: (meta: ChatAttachmentMeta) => void;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState("");
  // 纯浏览器无 bridge：初始即降级为文件名 chip，不进入加载态
  const [failed, setFailed] = useState(() => !window.chats?.readAttachment);
  // 真视口懒加载（Review 修复）：进入视口才读取完整 dataURL，长历史不预载
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined"
  );

  useEffect(() => {
    const node = anchor.current;
    if (visible || !node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || failed || url) return;
    let active = true;
    const read = window.chats?.readAttachment;
    if (!read) return;
    read(meta.id)
      .then((dataUrl) => {
        if (active) setUrl(dataUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [visible, failed, url, meta.id]);

  if (failed) return <Thumb filename={meta.filename} url="" />;
  if (!url) return <Skeleton className="size-16 rounded-md" ref={anchor} />;
  return (
    <Thumb
      filename={meta.filename}
      onOpen={onOpen ? () => onOpen(meta) : undefined}
      url={url}
    />
  );
}

export function ChatUserAttachments({
  attachments,
  live,
  onOpen,
}: {
  attachments?: ChatAttachmentMeta[];
  live?: LiveAttachmentPreview[];
  onOpen?: (meta: ChatAttachmentMeta) => void;
}) {
  // 当次会话优先用内存预览，零 IPC 往返；历史会话经落盘副本懒加载
  const items = live?.length
    ? live.map((item, index) => ({
        key: item.filename + item.url.length,
        meta: attachments?.[index],
        ...item,
      }))
    : undefined;
  if (!items && !attachments?.length) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {items
        ? items.map((item) => {
            const meta = item.meta;
            return (
              <Thumb
                filename={item.filename}
                key={item.key}
                onOpen={meta && onOpen ? () => onOpen(meta) : undefined}
                url={item.url}
              />
            );
          })
        : attachments!.map((meta) => (
            <StoredThumb key={meta.id} meta={meta} onOpen={onOpen} />
          ))}
    </div>
  );
}
