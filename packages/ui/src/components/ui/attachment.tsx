/**
 * [INPUT]: Depends on React, class-variance-authority, shared Button, and cn
 * [OUTPUT]: Provides shared AttachmentTile and Attachment, AttachmentMedia, AttachmentContent, AttachmentTitle, AttachmentActions, AttachmentAction, and AttachmentGroup chip primitives
 * [POS]: The attachment chip layer of components/ui consumed by ai-elements PromptInputAttachments
 */

import { FileIcon, XIcon } from "lucide-react"
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { Button } from "@ai-chat/ui/components/ui/button"
import { cn } from "@ai-chat/ui/lib/utils"

const attachmentVariants = cva(
  "group/attachment relative flex items-center gap-2 rounded-lg border bg-background text-sm",
  {
    variants: {
      size: {
        default: "p-2",
        sm: "p-1.5",
        xs: "p-1",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function Attachment({
  className,
  size,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof attachmentVariants>) {
  return (
    <div
      data-slot="attachment"
      className={cn(attachmentVariants({ size }), className)}
      {...props}
    />
  )
}

function AttachmentMedia({
  className,
  variant = "icon",
  ...props
}: React.ComponentProps<"div"> & { variant?: "icon" | "image" }) {
  return (
    <div
      data-slot="attachment-media"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground",
        variant === "image" && "bg-transparent [&>img]:size-full [&>img]:object-cover",
        "[&>svg]:size-4",
        className
      )}
      {...props}
    />
  )
}

function AttachmentContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-content"
      className={cn("flex min-w-0 flex-col", className)}
      {...props}
    />
  )
}

function AttachmentTitle({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="attachment-title"
      className={cn("truncate font-medium text-xs", className)}
      {...props}
    />
  )
}

function AttachmentActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-actions"
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  )
}

function AttachmentAction({
  className,
  variant = "ghost",
  size = "icon-xs",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="attachment-action"
      type="button"
      variant={variant}
      size={size}
      className={cn(className)}
      {...props}
    />
  )
}

function AttachmentGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-group"
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  )
}

export {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
}

/** Shared presentation only; hosts own file data, preview lifetimes and upload actions. */
export function AttachmentTile({ image, name, thumbnail, action, removeLabel, onRemove, disabled,
  mediaClassName, children, className, ...props }: Omit<React.ComponentProps<"div">, "children"> & {
  image: boolean; name: string; thumbnail?: React.ReactNode;
  action?: Omit<React.ComponentProps<"button">, "children">;
  removeLabel: string; onRemove(): void; disabled?: boolean;
  mediaClassName?: string; children?: React.ReactNode;
}) {
  return <Attachment size="sm" className={cn("pr-1", image && "size-20 overflow-visible rounded-xl p-0", className)} {...props}>
    <AttachmentMedia variant={image ? "image" : "icon"} className={cn(image && "size-full rounded-[inherit]", mediaClassName)}>
      {image && thumbnail ? <button type="button" {...action} className={cn("relative size-full rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring/40 cursor-zoom-in", action?.className)}>{thumbnail}</button> : <FileIcon />}
    </AttachmentMedia>
    {!image && <AttachmentContent><AttachmentTitle className="max-w-32">{name}</AttachmentTitle></AttachmentContent>}
    <AttachmentActions className={cn(image && "absolute top-1 right-1")}>
      <AttachmentAction aria-label={removeLabel} size={image ? "icon-sm" : "icon-xs"} variant={image ? "default" : "ghost"} disabled={disabled} onClick={onRemove}
        className={cn("opacity-100 motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover/attachment:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:focus-visible:opacity-100", image && "relative rounded-full border-background shadow-sm after:absolute after:-inset-2.5 after:content-[''] hover:bg-primary!")}><XIcon /></AttachmentAction>
    </AttachmentActions>
    {children}
  </Attachment>;
}
