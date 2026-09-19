/**
 * [INPUT]: Depends on UI Skeleton, localized transcript controls, shared ConversationFold, ChatAttachmentMeta, live previews, and attachment read/open intents
 * [OUTPUT]: Provides localized UserMessageFold with hover feedback, directional expansion chevrons, and a 44px touch target, plus ChatUserAttachments with lazy stored previews, and side-panel image actions
 * [POS]: User-message body and attachment display unit consumed by the ChatTranscript user branch
 */

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConversationFold } from "@ai-chat/ui/components/conversation/fold";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import type { ChatAttachmentMeta } from "../../../../shared/chats-ipc";
import type { LiveAttachmentPreview } from "../runtime/chat-attachments";
import { useAppTranslation } from "@/components/providers/i18n-provider";

export function UserMessageFold({ children, measurementKey }: { children: ReactNode; measurementKey?: unknown }) {
  const { t } = useAppTranslation();
  return <ConversationFold measurementKey={measurementKey} showMore={t("chat.transcript.showMore")} showLess={t("chat.transcript.showLess")}>{children}</ConversationFold>;
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
  chatId,
  meta,
  onOpen,
}: {
  chatId: string;
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
    read(chatId, meta.id)
      .then((dataUrl) => {
        if (active) setUrl(dataUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [visible, failed, url, chatId, meta.id]);

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
  chatId,
  attachments,
  live,
  onOpen,
}: {
  chatId: string;
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
            <StoredThumb chatId={chatId} key={meta.id} meta={meta} onOpen={onOpen} />
          ))}
    </div>
  );
}
