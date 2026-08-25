import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@ai-chat/ui/lib/utils"

const markerVariants = cva(
  "flex items-center gap-2 text-muted-foreground text-sm",
  {
    variants: {
      variant: {
        default: "",
        border: "rounded-lg border px-3 py-2",
        separator:
          "before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Marker({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof markerVariants>) {
  return (
    <div
      data-slot="marker"
      className={cn(markerVariants({ variant }), className)}
      {...props}
    />
  )
}

function MarkerIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-icon"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center [&>svg]:size-3.5",
        className
      )}
      {...props}
    />
  )
}

function MarkerContent({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-content"
      className={cn("min-w-0 truncate", className)}
      {...props}
    />
  )
}

export { Marker, MarkerContent, MarkerIcon, markerVariants }
