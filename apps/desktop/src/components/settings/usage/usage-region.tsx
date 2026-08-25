/**
 * [INPUT]: Depends on React ReactNode
 * [OUTPUT]: Provides UsageRegion In the box, a section of the title is shown with a caption (title + limited language + right-hand action) and a caption
 * [POS]: The language of the settings/usage sub-module; The headings are the same as the headings in the SettingsSection, so the headings inside the page look the same as the headings between the pages
 */

import type { ReactNode } from "react";

/* ============================================================
 * 段头刻意与 SettingsSection 的标题带逐项同构：min-h-8 的高度、
 * text-sm 的半粗标题、右侧一个动作槽。于是「页面里的一段」与
 * 「卡片里的一段」长得一模一样，读者不必学两套。
 *
 * min-h-8 让有动作与没动作的段共用同一条基线——高度不该由「这段
 * 恰好有没有控件」决定；32px 也正是 TabsList 默认档的高度，段头里
 * 放一个分段控件时两者天然对齐。
 *
 * meta 是标题的限定语，不是第二个标题：Token activity 不需要它，
 * Today 需要（今天是哪一天，是这一段的属性，不是那个大数字的属性）。
 * ============================================================ */

export function UsageRegion({
  title,
  meta,
  action,
  children,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const titleId = `usage-region-${title.replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={titleId} className="p-4">
      <div className="flex min-h-8 items-center justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2
            id={titleId}
            className="min-w-0 truncate font-heading font-semibold text-sm"
          >
            {title}
          </h2>
          {meta && (
            <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
              {meta}
            </span>
          )}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
