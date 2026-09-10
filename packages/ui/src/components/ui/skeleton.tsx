/**
 * [INPUT]: Depends on React element props, shared class merging, and theme tokens.
 * [OUTPUT]: Provides the Skeleton loading placeholder with caller-defined dimensions.
 * [POS]: Shared UI primitive for content loading states.
 */
import { cn } from "@ai-chat/ui/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
