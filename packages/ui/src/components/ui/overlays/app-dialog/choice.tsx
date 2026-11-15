"use client";

/**
 * [INPUT]: Depends on Spinner, ChevronRight, and class merging
 * [OUTPUT]: Provides DialogChoice (featured / plain / bordered option rows; busy spinner lives in the icon slot so the row never shifts) and DialogChoiceGroup (the "Other options" label above a stack of plain rows)
 * [POS]: packages/ui/src/components/ui/overlays/app-dialog; The choice-row layer of the product dialog spec (D14)
 */

import type { ComponentProps, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { cn } from "@ai-chat/ui/lib/utils";

/* ── 选项行：把「后果」贴回选项本体 ────────────────────────────────
 * 一排平权按钮只能承载动词——「重试」「新建」「放弃」；选了会怎样只能
 * 写在别处，于是要么写进描述句里替按钮转述（读者得自己配对），要么根本
 * 不写（读者只能猜）。两行的选项行让每个答案自带代价，弹窗的描述句随之
 * 可以只说事实、不再替按钮说话。
 *
 * 它不是 Button 的一种 variant：要放两行字、左对齐、随宽换行，而 Button
 * 焊死了 h-7 / whitespace-nowrap / justify-center。掰这三条比自己长一个更脏。
 *
 * 危险项静置时与安全项等重——它是正当选择而非陷阱，红只落在标题与悬停上，
 * 让人在按下之前而不是看见之时收到警告。
 *
 * 三种长相（D14，2026-11-14 定稿的 3B 方案）：
 * featured：被推荐的那个动作。muted/50 填充、无描边——有边框会被读成
 *   「单选组里已选中的那一项」，而它是动作不是状态；20px 图标、徽章焊在
 *   标题后、尾部一枚 chevron 提示「这是一整颗按钮」。
 * plain：其余动作。清单式两行，16px 图标，点了即执行。
 * bordered：装了「当前值」的盒子（单选组、Step 里的选项），选中态需要
 *   描边兜住。
 * ───────────────────────────────────────────────────────────────── */
export type DialogChoiceProps = Omit<ComponentProps<"button">, "title"> & {
  title: ReactNode;
  detail?: ReactNode;
  /** 引导标记（如「推荐」）；只在需要替读者做决定时给。 */
  badge?: ReactNode;
  tone?: "default" | "danger";
  busy?: boolean;
  /** 单选组的选中态。点了即执行的动作行不需要它——那种行没有「当前答案」。 */
  selected?: boolean;
  /** 前导标记。给了它，spinner 就住进这个槽，忙起来时行的几何一分不动。 */
  icon?: ReactNode;
  /**
   * featured：被推荐的动作（muted 填充，无描边，尾部 chevron）。
   * plain：可按的清单行。bordered：装得住选中态的盒子。
   * 判据是这一行**有没有当前值**——单选组的选中态要填色，填色需要边框兜住；
   * 点了即执行的选项没有值可存，那圈框就只是一圈没有职责的描边。
   */
  variant?: "featured" | "plain" | "bordered";
};

export function DialogChoice({
  title,
  detail,
  badge,
  tone = "default",
  busy = false,
  selected = false,
  disabled = false,
  icon,
  variant = "bordered",
  className,
  ...props
}: DialogChoiceProps) {
  const danger = tone === "danger";
  const bordered = variant === "bordered";
  const featured = variant === "featured";
  /* 槽位只要出现过就一直占位。若只在 busy 时插一个 spinner，标题会在按下的
     那一刻整体右移——页脚按钮上刚除掉的那种抖动，没有理由留在选项行里。 */
  const slot = icon !== undefined;
  return (
    <button
      data-slot="dialog-choice"
      data-variant={variant}
      type="button"
      disabled={disabled}
      className={cn(
        "group/choice cursor-pointer bg-clip-padding text-left transition-all outline-none",
        "focus-visible:ring-2 disabled:pointer-events-none",
        bordered
          ? "rounded-[0.875rem] border border-border px-3.5 py-2.5 focus-visible:border-ring dark:bg-input/30"
          : featured
            ? "rounded-[0.875rem] bg-muted/50 px-4 py-3.5"
            : "rounded-[0.875rem] px-2.5 py-2",
        danger
          ? cn(
              "hover:bg-destructive/10 focus-visible:ring-destructive/20",
              bordered && "hover:border-destructive/40 focus-visible:border-destructive/40"
            )
          : cn(
              featured
                ? "hover:bg-muted/70"
                : bordered
                  ? "hover:bg-input/50"
                  : "hover:bg-muted/60",
              "focus-visible:ring-ring/30"
            ),
        // 而真的被选中时，「填色会被读成已选中」正是要的那个读法：描边定
        // 主次，填色定「当前就是它」，两者一起才在六行里一眼认得出来。
        // 危险项选中时照样上红——静置时与安全项等重是为了不设陷阱，选中后
        // 如实告诉读者他此刻选的是哪一种，是另一回事。
        selected &&
          (danger
            ? "border-destructive/40 bg-destructive/10"
            : "border-foreground/25 bg-input/50"),
        // 只暗掉没被点的那个：正在跑的那行还要靠自己的 spinner 说话。
        disabled && !busy && "opacity-50",
        className
      )}
      {...props}
    >
      <span className="flex items-center gap-2.5">
        {slot && (
          <span
            aria-hidden={busy ? undefined : "true"}
            className={cn(
              "grid shrink-0 place-items-center",
              featured ? "size-5" : "size-4",
              danger ? "text-destructive" : "text-foreground/65",
              featured
                ? "[&_svg:not([class*='size-'])]:size-5"
                : "[&_svg:not([class*='size-'])]:size-4"
            )}
          >
            {busy ? <Spinner className="size-4" /> : icon}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span
            data-slot="dialog-choice-title"
            className={cn(
              "flex items-center gap-1.5 font-medium",
              featured || bordered ? "text-[15px]/5" : "text-sm",
              danger && "text-destructive"
            )}
          >
            {/* 没有槽位的行退回原样：spinner 直接插在标题前，行为与从前一致。 */}
            {busy && !slot && <Spinner className="size-3.5" />}
            {title}
            {badge && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 text-[11px]/[17px] font-medium text-foreground">
                {badge}
              </span>
            )}
          </span>
          {detail && (
            <span
              className="mt-[3px] block text-[13px]/[1.45] text-muted-foreground"
            >
              {detail}
            </span>
          )}
        </span>
        {featured && (
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
        )}
      </span>
    </button>
  );
}

/* ── 选项组：推荐项之外的那几行归在一个标签下 ────────────────────
 * 「其他选项」四个字替读者完成分组：上面那一行是建议，下面这些是备选。
 * ───────────────────────────────────────────────────────────────── */
export function DialogChoiceGroup({
  label,
  className,
  children,
}: {
  label?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div data-slot="dialog-choice-group" className={className}>
      {label ? (
        <p className="mt-3 mb-1 text-xs font-medium text-muted-foreground">
          {label}
        </p>
      ) : null}
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}
