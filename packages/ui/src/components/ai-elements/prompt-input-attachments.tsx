"use client";

/**
 * [INPUT]: Depends on attachment display primitives, prompt-input attachment hooks, dialog controls, and host-injected shared UI text
 * [OUTPUT]: Provides localized PromptInputAttachments preview/remove controls and the attachment-selection trigger
 * [POS]: The attachment visual layer of ai-elements PromptInput; The attachment status and blob URL lifecycle are in context/hooks, not here
 */

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@ai-chat/ui/components/ui/attachment";
import {
  PromptInputButton,
  PromptInputHeader,
  usePromptInputAttachments,
  type PromptInputButtonProps,
} from "@ai-chat/ui/components/ai-elements/prompt-input";
import { AppDialogContent } from "@ai-chat/ui/components/ui/app-dialog";
import { Dialog, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { cn } from "@ai-chat/ui/lib/utils";
import { useUiText } from "@ai-chat/ui/lib/ui-text";
import { FileIcon, PlusIcon, XIcon } from "lucide-react";
import { useState, type ComponentProps } from "react";

// ─── 输入框附件预览条：删除默认可见，仅细指针 hover 环境允许静置隐藏 ───

/* ── 命中区 44px，身形交还缩略图 ──────────────────────────────────
 * 「看起来多大」与「点得中多大」是两件事。把删除键本身撑成 size-11，命中区
 * 是达标了，代价是一枚实心圆盘盖掉 80px 缩略图一半以上的面积——hover 之后
 * 用户看见的不再是自己那张图，是一个叉。身形交回 size="icon-sm"（24px，含
 * 图标缩放），::after 独自把命中区撑到 44px：向外只扩 10px，窄于卡间 8px 的
 * gap 与卡内 4px 的角距，不会替邻卡收走点击。
 *
 * 带 relative：absolute 的是宿主 AttachmentActions，按钮自身仍在文档流里，
 * 不给包含块 ::after 会挂到卡片外面去。同理它只能长在按钮上——若这枚按钮
 * 哪天自己变成 absolute，relative 与 absolute 同属 position 组，经 cn 的
 * tailwind-merge 后写在后面的赢，本行当场拆台。
 * ────────────────────────────────────────────────────────────── */
const imageRemoveClass =
  "relative rounded-full border-background shadow-sm after:absolute after:-inset-2.5 after:content-[''] hover:bg-primary!";

export type PromptInputAttachmentsProps = Omit<
  ComponentProps<typeof PromptInputHeader>,
  "children"
>;

export const PromptInputAttachments = ({
  className,
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
          const isImage = file.mediaType?.startsWith("image/") === true;
          const name = file.filename ?? attachmentLabel;

          return (
            <Attachment
              key={file.id}
              size="sm"
              className={cn(
                "pr-1",
                isImage && "size-20 overflow-visible rounded-xl p-0"
              )}
            >
              <AttachmentMedia
                variant={isImage ? "image" : "icon"}
                className={cn(isImage && "size-full rounded-[inherit]")}
              >
                {isImage && file.url ? (
                  /* 预览用 blob URL，提交时才转换 data URL。
                     缩略图是 object-cover 的 80px 裁切，看不清全貌，故整块
                     即触发器——type=button 不可省，这里身处 PromptInput 的
                     <form> 内，默认的 submit 会让「想看清楚」变成「发出去」。 */
                  <button
                    aria-label={`${previewLabel}: ${name}`}
                    className="size-full cursor-zoom-in rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    onClick={() => setPreviewId(file.id)}
                    type="button"
                  >
                    <img
                      alt={name}
                      className="size-full rounded-[inherit] object-cover"
                      src={file.url}
                    />
                  </button>
                ) : (
                  <FileIcon />
                )}
              </AttachmentMedia>
              {!isImage && (
                <AttachmentContent>
                  <AttachmentTitle className="max-w-32">{name}</AttachmentTitle>
                </AttachmentContent>
              )}
              <AttachmentActions
                className={cn(isImage && "absolute top-1 right-1")}
              >
                <AttachmentAction
                  aria-label={`${removeLabel}: ${name}`}
                  size={isImage ? "icon-sm" : "icon-xs"}
                  variant={isImage ? "default" : "ghost"}
                  className={cn(
                    "opacity-100 motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover/attachment:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:focus-visible:opacity-100",
                    isImage && imageRemoveClass
                  )}
                  onClick={() => attachments.remove(file.id)}
                >
                  <XIcon />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
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
            <img
              alt={preview.filename ?? attachmentLabel}
              className="max-h-[calc(100vh-8rem)] w-auto max-w-full self-center rounded-[0.9rem] object-contain"
              src={preview.url}
            />
          )}
        </AppDialogContent>
      </Dialog>
    </PromptInputHeader>
  );
};

// ─── 加号按钮：点击直接弹文件选择器（不经菜单） ───

export type PromptInputAttachmentsTriggerProps = PromptInputButtonProps;

export const PromptInputAttachmentsTrigger = ({
  className,
  children,
  onClick,
  ...props
}: PromptInputAttachmentsTriggerProps) => {
  const attachments = usePromptInputAttachments();
  const label = useUiText("addAttachments", "Add attachments");
  return (
    <PromptInputButton
      aria-label={label}
      className={cn("rounded-full", className)}
      tooltip={label}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) attachments.openFileDialog();
      }}
      {...props}
    >
      {children ?? <PlusIcon className="size-4" />}
    </PromptInputButton>
  );
};
