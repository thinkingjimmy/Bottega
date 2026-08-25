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

function AttachmentDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="attachment-description"
      className={cn("truncate text-muted-foreground text-xs", className)}
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
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  attachmentVariants,
}
