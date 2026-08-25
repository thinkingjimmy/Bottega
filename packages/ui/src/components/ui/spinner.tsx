/**
 * [INPUT]: Depends on Lucide icon, style tool and shared UI text
 * [OUTPUT]: Provides Spinner original language with localized status name
 * [POS]: Load status icons of components/ui, consumed by desktop and Web
 */

import { cn } from "@ai-chat/ui/lib/utils"
import { useUiText } from "@ai-chat/ui/lib/ui-text"
import { Loader2Icon } from "lucide-react"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const label = useUiText("loading", "Loading")
  return (
    <Loader2Icon data-slot="spinner" role="status" aria-label={label} className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
