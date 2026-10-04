/**
 * [INPUT]: Depends on React nodes and shared UI class composition
 * [OUTPUT]: Provides SkillRow and SkillBadge for consistent Skill identity, description, source, selection, and action presentation
 * [POS]: Shared presentation for global Library management and read-only Project Skills
 */

import type { ReactNode } from "react";
import { cn } from "@ai-chat/ui/lib/utils";

export function SkillRow({
  name,
  description,
  badges,
  selection,
  actions,
}: {
  name: string;
  description: string;
  badges: ReactNode;
  selection?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-16 items-center gap-2 py-2",
        selection ? "px-2" : "px-4"
      )}
      data-slot="skill-row"
    >
      {selection}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-sm">{name}</span>
          {badges}
        </div>
        <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs leading-relaxed">
          {description}
        </p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SkillBadge({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
      {children}
    </span>
  );
}
