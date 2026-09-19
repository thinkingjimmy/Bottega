"use client"
/**
 * [INPUT]: Depends on React, the radix-ui Separator primitive and cn of lib/utils.
 * [OUTPUT]: Provides Separator, decorative by default, in horizontal and vertical orientations.
 * [POS]: components/ui's single divider primitive; the desktop chat composer is its only consumer today.
 */

import * as React from "react"
import { Separator as SeparatorPrimitive } from "radix-ui"

import { cn } from "@ai-chat/ui/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
