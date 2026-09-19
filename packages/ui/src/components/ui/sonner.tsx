"use client"

/**
 * [INPUT]: Depends on React, Radix Portal, Sonner, Lucide icons, Button, shared UI text, and cn.
 * [OUTPUT]: Provides Toaster/toast plus FeedbackToaster, showFeedbackToast, FeedbackToast, and FeedbackToastAction.
 * [POS]: Body-portaled, non-draggable toast boundary; archive and App recovery reuse the same compact feedback surface.
 */

import * as React from "react"
import { X } from "lucide-react"
import { Portal } from "radix-ui"
import { Toaster as Sonner, toast, type ExternalToast, type ToasterProps } from "sonner"
import { Button } from "@ai-chat/ui/components/ui/button"
import { useUiText } from "@ai-chat/ui/lib/ui-text"
import { cn } from "@ai-chat/ui/lib/utils"

// The host supplies its resolved theme; renderer media queries can disagree.
function Toaster({ className, style, toastOptions, ...props }: ToasterProps) {
  return (
    // Electron folds drag regions in DOM order; z-index cannot escape later chrome.
    <Portal.Root asChild>
      <Sonner
        className={cn("toaster group", className)}
        style={
          {
            "--normal-bg": "var(--popover)",
            "--normal-text": "var(--popover-foreground)",
            "--normal-border": "var(--border)",
            ...style,
          } as React.CSSProperties
        }
        toastOptions={{
          ...toastOptions,
          className: cn("[-webkit-app-region:no-drag]", toastOptions?.className),
        }}
        {...props}
      />
    </Portal.Root>
  )
}

const FEEDBACK_TOASTER_ID = "product-feedback"

function FeedbackToaster({ theme }: { theme: "light" | "dark" }) {
  return (
    <Toaster
      id={FEEDBACK_TOASTER_ID}
      theme={theme}
      position="top-center"
      offset={{ top: 16 }}
      mobileOffset={{ top: 16 }}
      visibleToasts={3}
      gap={8}
      style={{
        width: "min(var(--width), calc(100vw - 2rem))",
        left: "50%",
        right: "auto",
        transform: "translateX(-50%)",
      }}
    />
  )
}

function showFeedbackToast(
  content: (id: string | number) => React.ReactElement,
  options: Omit<ExternalToast, "toasterId" | "unstyled" | "position"> = {},
) {
  return toast.custom(content, {
    duration: 8_000,
    ...options,
    toasterId: FEEDBACK_TOASTER_ID,
    unstyled: true,
    style: {
      width: "max-content",
      maxWidth: "calc(100vw - 2rem)",
      left: "50%",
      translate: "-50% 0",
      ...options.style,
    },
  })
}

function FeedbackToast({
  icon,
  title,
  description,
  onDismiss,
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  icon: React.ReactNode
  title: string
  description?: string
  onDismiss(): void
}) {
  const closeLabel = useUiText("close", "Close")
  return (
    <div
      data-slot="feedback-toast"
      className={cn("flex min-h-10 w-max max-w-[calc(100vw-2rem)] items-center rounded-[14px] border border-border/80 bg-popover py-1.5 pr-2 pl-3.5 text-popover-foreground shadow-[0_10px_30px_rgba(0,0,0,0.12)] [-webkit-app-region:no-drag] [&_button]:cursor-pointer", className)}
      {...props}
    >
      <span aria-hidden className="mr-2.5 shrink-0 [&_svg]:size-3">{icon}</span>
      <div className="mr-3 min-w-0 max-w-80 [overflow-wrap:anywhere]">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="mr-1 flex shrink-0 items-center gap-2">{children}</div>
      <Button aria-label={closeLabel} className="rounded-full" size="icon-sm" variant="ghost" type="button" onClick={onDismiss}>
        <X />
      </Button>
    </div>
  )
}

function FeedbackToastAction({ className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button type="button" size="sm" className={cn("rounded-full px-1.5 text-sm font-normal", className)} {...props} />
}

// Keep publishers and subscribers on one Sonner module instance across ESM/CJS.
export { Toaster, toast, FeedbackToaster, showFeedbackToast, FeedbackToast, FeedbackToastAction }
