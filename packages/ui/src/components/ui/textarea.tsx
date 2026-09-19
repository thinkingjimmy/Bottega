/**
 * [INPUT]: Depends on React native textarea props and cn of lib/utils.
 * [OUTPUT]: Provides Textarea with field-sizing-content auto-growth, suppressed manual resize and accessible focus/invalid states.
 * [POS]: components/ui's single multi-line text primitive, sibling to input.tsx; composers layer their own chrome on top of it.
 */
import * as React from "react"

import { cn } from "@ai-chat/ui/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full resize-none rounded-md border border-input bg-input/20 px-2 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-xs/relaxed dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
