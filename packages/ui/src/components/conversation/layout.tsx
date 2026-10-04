/**
 * [INPUT]: Depends on the shared Tailwind theme and host-owned scroll containers.
 * [OUTPUT]: Provides the transcript column geometry consumed by native and virtualized conversations.
 * [POS]: Common reading width and gutters; scrolling and row measurement remain host-owned.
 */
import type { ReactNode } from "react";
export function TranscriptDividerRow({ children, role }: { children: ReactNode; role?: "separator" }) {
  return <div className="flex items-center gap-3 py-2 text-muted-foreground text-xs" role={role}>
    <span className="h-px flex-1 bg-border" />{children}<span className="h-px flex-1 bg-border" />
  </div>;
}
export const conversationColumnClassName =
  "mx-auto w-full min-w-0 max-w-3xl p-4";
