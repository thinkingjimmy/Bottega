"use client";

/**
 * [INPUT]: Depends on React useState, I18n, ProjectAppearance of shared, lib/project-appearance of two directories with the analyzer, popover/button original, cn and usePointerOpenedMenu
 * [OUTPUT]: Provides the Sidebar-specific ProjectAppearancePicker trigger and reusable ProjectAppearancePanel grid/commit body
 * [POS]: Project appearance surface shared by the Sidebar row and Project Settings while each consumer owns its appropriate trigger
 */

import { useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { ProjectAppearance } from "../../../../../shared/projects-ipc";
import {
  PROJECT_COLORS,
  PROJECT_ICONS,
  normalizeProjectAppearance,
  resolveProjectColor,
  resolveProjectGlyph,
} from "@/lib/project-appearance";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ai-chat/ui/components/ui/popover";
import { usePointerOpenedMenu } from "@ai-chat/ui/hooks/use-pointer-opened-menu";
import { cn } from "@ai-chat/ui/lib/utils";

/* ── 为何是裸 button 而非 SidebarMenuAction ───────────────────────
 * 那颗原语为「行尾」而生：硬编码 right-1、带 peer-hover/menu-button:（`~` 后继
 * 兄弟选择器，对排在按钮**前面**的芯片永不触发）、带 collapsible=icon 时隐藏
 * （会把 Project 的身份字形一起藏掉），还有 after:-inset-2 的隐形热区压进行内文字。
 * 行首这一枚要的东西它一样都没有，要撤的它全带着。
 *
 * 底色用 alpha 叠加而非实心 token：行 hover 时底下已是 bg-sidebar-accent，
 * 而 --accent 与 --sidebar-accent 同值——hover:bg-accent 在已 hover 的行上等于没反应。
 * foreground/10 压在 --sidebar、--sidebar-accent 还是 active 态上，差值都恒定。
 *
 * [&>svg]:size-4 与 stroke-width 不可省：这两条今天由 sidebarMenuButtonVariants 的
 * [&_svg]:size-4 与 sidebarTypographyClass 的 [&_[data-sidebar=menu-button]_svg]
 * 以**后代选择器**提供，字形一旦移出按钮就双双失效，会静默变成 24px、stroke-2。
 * ────────────────────────────────────────────────────────── */
const triggerClass =
  "flex size-6 cursor-pointer items-center justify-center rounded-[calc(var(--radius-sm)-2px)] text-sidebar-foreground ring-sidebar-ring outline-hidden transition-colors hover:bg-sidebar-foreground/10 focus-visible:ring-2 aria-expanded:bg-sidebar-foreground/10 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:[stroke-width:1.5]";

/** 两片网格同为 6 列：8 色排成 6+2，30 图标排成 6×5，面板宽度由后者单点决定。 */
const gridClass = "grid grid-cols-6 gap-1";
const cellClass =
  "flex size-8 cursor-pointer items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30";

export function ProjectAppearancePicker({
  appearance,
  className,
  dimmed,
  expanded,
  onCommit,
  projectName,
}: {
  appearance: ProjectAppearance | undefined;
  className?: string;
  dimmed?: boolean;
  expanded: boolean;
  onCommit: (appearance: ProjectAppearance) => void;
  projectName: string;
}) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const menu = usePointerOpenedMenu();
  const glyph = resolveProjectGlyph(appearance?.icon, expanded);

  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <button
          aria-label={t("projects.appearance.trigger", { name: projectName })}
          className={cn(triggerClass, dimmed && "opacity-65", className)}
          type="button"
          {...menu.triggerProps}
        >
          <glyph.Icon className={resolveProjectColor(appearance?.color).text} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-max"
        onCloseAutoFocus={menu.onCloseAutoFocus}
        side="bottom"
      >
        <ProjectAppearancePanel
          appearance={appearance}
          onCommit={onCommit}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

export function ProjectAppearancePanel({
  appearance,
  onCommit,
  onDone,
}: {
  appearance: ProjectAppearance | undefined;
  onCommit: (appearance: ProjectAppearance) => void;
  onDone: () => void;
}) {
  const { t } = useAppTranslation();
  const [draft, setDraft] = useState(() => normalizeProjectAppearance(appearance));
  const draftTint = resolveProjectColor(draft.color).text;
  const done = () => {
    const current = normalizeProjectAppearance(appearance);
    if (draft.color !== current.color || draft.icon !== current.icon) {
      onCommit(draft);
    }
    onDone();
  };
  return (
    <>
      {/* role=group rather than radiogroup: the grid intentionally uses normal Tab navigation. */}
      <div
        aria-label={t("projects.appearance.colorGroup")}
        className={gridClass}
        role="group"
      >
        {PROJECT_COLORS.map((color) => (
          <button
            aria-label={t(`projects.appearance.color.${color.id}`)}
            aria-pressed={draft.color === color.id}
            className={cellClass}
            key={color.id}
            onClick={() => setDraft((current) => ({ ...current, color: color.id }))}
            title={t(`projects.appearance.color.${color.id}`)}
            type="button"
          >
            <span
              className={cn(
                "size-6 rounded-full",
                color.swatch,
                draft.color === color.id &&
                  "ring-2 ring-foreground ring-offset-2 ring-offset-popover"
              )}
            />
          </button>
        ))}
      </div>

      <div className="my-3 border-t" />

      {/* 整片按草稿颜色染色：选色即刻重绘 30 枚预览，所见即所得。 */}
      <div
        aria-label={t("projects.appearance.iconGroup")}
        className={cn(gridClass, draftTint)}
        role="group"
      >
        {PROJECT_ICONS.map((icon) => (
          <button
            aria-label={t(`projects.appearance.icon.${icon.id}`)}
            aria-pressed={draft.icon === icon.id}
            className={cn(
              cellClass,
              draft.icon === icon.id ? "bg-muted" : "hover:bg-muted/60"
            )}
            key={icon.id}
            onClick={() => setDraft((current) => ({ ...current, icon: icon.id }))}
            title={t(`projects.appearance.icon.${icon.id}`)}
            type="button"
          >
            <icon.Icon className="size-[1.125rem] [stroke-width:1.5]" />
          </button>
        ))}
      </div>

      <div className="mt-3 flex justify-end">
        <Button onClick={done} size="lg" type="button" variant="secondary">
          {t("projects.appearance.done")}
        </Button>
      </div>
    </>
  );
}
