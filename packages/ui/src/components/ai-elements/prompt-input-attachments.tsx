"use client";

/**
 * [INPUT]: Depends on attachment display primitives, cancellable Blob reading, dialog controls, and host-injected shared UI text.
 * [OUTPUT]: Provides CSP-compatible image previews, host-owned edit actions, remove controls, and an image lightbox.
 * [POS]: The attachment visual layer of ai-elements PromptInput; The attachment status and blob URL lifecycle are in context/hooks, not here
 */

import { AttachmentTile, AttachmentGroup } from "@ai-chat/ui/components/ui/attachment";
import {
  PromptInputHeader,
  usePromptInputAttachments,
} from "@ai-chat/ui/components/ai-elements/prompt-input";
import { AppDialogContent } from "@ai-chat/ui/components/ui/app-dialog";
import { Dialog, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { cn } from "@ai-chat/ui/lib/utils";
import { useUiText } from "@ai-chat/ui/lib/ui-text";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { readBlobDataUrl } from "../../lib/attachments/data-url";

export type PromptInputAttachmentsProps = Omit<
  ComponentProps<typeof PromptInputHeader>,
  "children"
> & {
  /** Host-owned editable attachments can replace the default image preview. */
  attachmentAction?: (file: ReturnType<typeof usePromptInputAttachments>["files"][number]) => { label: string; badge?: ReactNode; onClick(): void } | undefined;
};

function AttachmentImage({ file, ...props }: Omit<ComponentProps<"img">, "src"> & { file: ReturnType<typeof usePromptInputAttachments>["files"][number] }) {
  const [preview, setPreview] = useState<{ file: File; url: string }>();
  useEffect(() => {
    const nativeFile = file.nativeFile;
    if (!nativeFile) return;
    const cancellation = new AbortController();
    void readBlobDataUrl(nativeFile, cancellation.signal).then((url) => {
      if (!cancellation.signal.aborted) setPreview({ file: nativeFile, url });
    }).catch(() => {});
    return () => cancellation.abort();
  }, [file.nativeFile]);
  const src = file.nativeFile ? preview?.file === file.nativeFile ? preview.url : undefined : file.url;
  return <img {...props} src={src} />;
}

export const PromptInputAttachments = ({
  className,
  attachmentAction,
  ...props
}: PromptInputAttachmentsProps) => {
  const attachments = usePromptInputAttachments();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const attachmentLabel = useUiText("attachment", "Attachment");
  const previewLabel = useUiText("previewAttachment", "Preview attachment");
  const removeLabel = useUiText("removeAttachment", "Remove attachment");
  if (attachments.files.length === 0) return null;
  /* 放大态由 id 派生而非另存一份 file：删除正在看的那张，它自己就从列表里
     消失、弹窗随之关上。存 file 就要再写一条「删除时同步关闭」的分支，而
     那条分支迟早会漏掉某个删除入口。 */
  const preview = attachments.files.find((file) => file.id === previewId);

  return (
    <PromptInputHeader className={cn("pb-0", className)} {...props}>
      <AttachmentGroup>
        {attachments.files.map((file) => {
          const action = attachmentAction?.(file);
          const isImage = file.mediaType?.startsWith("image/") === true;
          const name = file.filename ?? attachmentLabel;

          return (
            <AttachmentTile key={file.id} image={isImage} name={name}
              removeLabel={`${removeLabel}: ${name}`} onRemove={() => attachments.remove(file.id)}
              action={{ "aria-label": action?.label ?? `${previewLabel}: ${name}`, title: action?.label,
                className: action ? "cursor-pointer" : undefined,
                onClick: () => action ? action.onClick() : setPreviewId(file.id) }}
              thumbnail={file.url ? <><AttachmentImage file={file} alt={name} className="size-full rounded-[inherit] object-cover" />{action?.badge}</> : undefined} />
          );
        })}
      </AttachmentGroup>
      {/* ── 放大态：文件名条在上，图片在下 ───────────────────────────────
          关闭键恒在表面的 top-2 right-2。若让图片顶满表面，它就压在画面右上
          角上，遇到深色截图当场读不出来——出口不可以只在浅色图上存在。让文件
          名条占住那一行：× 有了自己的底，图片从它下方起，两者不争同一块像素，
          顺带把「放大的是哪一个」也说清楚了。
          ─────────────────────────────────────────────────────────── */}
      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) setPreviewId(null);
        }}
      >
        <AppDialogContent className="w-auto max-w-[calc(100vw-3rem)] gap-2 p-2 sm:max-w-[calc(100vw-8rem)]">
          <DialogTitle className="truncate pr-8 pl-1 font-medium text-xs">
            {preview?.filename ?? attachmentLabel}
          </DialogTitle>
          {preview?.url && (
            <AttachmentImage
              file={preview}
              alt={preview.filename ?? attachmentLabel}
              className="max-h-[calc(100vh-8rem)] w-auto max-w-full self-center rounded-[0.9rem] object-contain"
            />
          )}
        </AppDialogContent>
      </Dialog>
    </PromptInputHeader>
  );
};
