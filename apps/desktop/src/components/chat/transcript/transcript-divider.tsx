/**
 * [INPUT]: Depends on React children and the transcript's shared visual tokens
 * [OUTPUT]: Provides the reusable semantic horizontal divider row for transcript boundaries and paging controls
 * [POS]: Presentation primitive shared by imported-history, fork-lineage, and load-earlier boundaries
 */

import type { ReactNode } from "react";

export function TranscriptDividerRow({ children, role }: {
  children: ReactNode;
  role?: "separator";
}) {
  return (
    <div
      className="flex items-center gap-3 py-2 text-muted-foreground text-xs"
      role={role}
    >
      <span className="h-px flex-1 bg-border" />
      {children}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
