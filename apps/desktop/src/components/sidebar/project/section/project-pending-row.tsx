"use client";

/**
 * [INPUT]: Depends on i18n, lucide Loader2, lib/project-appearance's default glyph, HistoryProvider's PendingProject shape, and the sidebar menu item primitive
 * [OUTPUT]: Provides ProjectPendingRow: the row that holds a Project's place between "folder chosen" and "record written"
 * [POS]: section/'s placeholder for HistoryProvider.pendingProject; borrows ProjectItem's head geometry (24px glyph slot, pl-8 title, 20px action slot) and the "Show more" 55% foreground that says "not a member yet"; the section only mounts it once the wait has outlasted the 300ms gate
 */

import { Loader2 } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { PendingProject } from "@/components/providers/history/history-provider";
import { resolveProjectGlyph } from "@ai-chat/ui/components/workspace/navigation/appearance";
import { SidebarMenuItem } from "@ai-chat/ui/components/ui/sidebar";

export function ProjectPendingRow({ pending }: { pending: PendingProject }) {
  const { t } = useAppTranslation();
  const glyph = resolveProjectGlyph(undefined, false);
  return (
    <SidebarMenuItem aria-busy={pending.scanning || undefined} data-sidebar-pending-project="">
      <div className="relative text-sidebar-foreground/55">
        <span aria-hidden className="absolute top-1 left-1 flex size-6 items-center justify-center [&>svg]:size-4 [&>svg]:[stroke-width:1.5]">
          <glyph.Icon />
        </span>
        <div className="flex h-8 items-center gap-2 rounded-[calc(var(--radius-sm)+2px)] p-2 pr-8 pl-8 text-sm leading-5">
          <span className="min-w-0 flex-1 truncate">{pending.name}</span>
        </div>
        {/* 转圈只在计数还在跑时出现：弹窗打开后没有什么在等，行只是占着位。 */}
        {pending.scanning && (
          <span aria-hidden className="absolute top-1.5 right-1 flex size-5 items-center justify-center">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          </span>
        )}
        <span className="sr-only" role="status">{t("history.projectPending", { name: pending.name })}</span>
      </div>
    </SidebarMenuItem>
  );
}
