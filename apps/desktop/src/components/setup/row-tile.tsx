/**
 * [INPUT]: Depends on the shared cn helper.
 * [OUTPUT]: Provides SetupRowTile, the 36px rounded mark that leads every onboarding list row.
 * [POS]: Atomic presentation shared by the onboarding Agent list and the onboarding folder and capability rows.
 */
import type { ReactNode } from "react";
import { cn } from "@ai-chat/ui/lib/utils";

export function SetupRowTile({ children, className }: { children: ReactNode; className?: string }) {
  return <span aria-hidden="true" className={cn(
    "flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-muted text-foreground ring-1 ring-foreground/5 ring-inset",
    className
  )}>{children}</span>;
}
