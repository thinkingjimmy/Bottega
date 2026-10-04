/**
 * [INPUT]: Depends on React ReactNode
 * [OUTPUT]: Provides UsageRegion, a section heading with title, optional meta qualifier, an optional control beside the title, and an optional right-aligned action slot
 * [POS]: settings/usage's section-heading primitive; mirrors SettingsSection's heading geometry so in-page and cross-page headings read identically
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

/* titleAction 是作用于整段内容的控件（刷新），紧贴标题——它回答「这段数据」，
   而 action 槽留给「修好这段」的动作，两者不再挤在同一个右角。 */
export function UsageRegion({
  title,
  meta,
  titleAction,
  action,
  children,
}: {
  title: string;
  meta?: ReactNode;
  titleAction?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const titleId = `usage-region-${title.replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={titleId} className="p-4">
      <div className="flex min-h-8 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
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
          {titleAction}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
