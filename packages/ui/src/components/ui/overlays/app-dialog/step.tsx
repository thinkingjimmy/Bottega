"use client";

/**
 * [INPUT]: Depends on AppDialogContent/AppDialogBody/AppDialogHeader/AppDialogFooter, Radix header/title/description, and class merging
 * [OUTPUT]: Provides StepDialogContent (the one shell for step-by-step setup: "Step n of m" label with segments, optional account row, 20/28 title, 15px description, scrolling body, banded footer with Back left and Cancel/primary right, no close button) and the StepDialogProgress/StepDialogAccount types
 * [POS]: packages/ui/src/components/ui/overlays/app-dialog; The step-flow layer of the product dialog spec (D4, D5, D10)
 */

import type { ComponentProps, ReactNode } from "react";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { cn } from "@ai-chat/ui/lib/utils";
import { AppDialogBody, AppDialogContent } from "./shell";
import { AppDialogFooter } from "./parts";

export type StepDialogProgress = {
  /** 1-based index of the current step. */
  index: number;
  total: number;
  /** "Step 2 of 3" in the caller's language; the segments beside it are decorative. */
  label: string;
};

export type StepDialogAccount = {
  /** Short label; the address is `value`, not interpolated into a sentence. */
  label: ReactNode;
  value: ReactNode;
};

type StepSegment = "done" | "current" | "upcoming";

/** The current step is never painted done, so the last step is a short done bar plus a longer current bar. */
function stepSegments(progress: StepDialogProgress): StepSegment[] {
  return Array.from({ length: progress.total }, (_, index) => {
    const step = index + 1;
    if (step < progress.index) return "done";
    if (step === progress.index) return "current";
    return "upcoming";
  });
}

function segmentClass(segment: StepSegment): string {
  if (segment === "current") return "h-[3px] w-7 rounded-[2px] bg-foreground";
  if (segment === "done") return "h-[3px] w-4 rounded-[2px] bg-foreground";
  return "h-[3px] w-4 rounded-[2px] bg-border";
}

type StepDialogContentProps = Omit<
  ComponentProps<typeof AppDialogContent>,
  "title" | "children" | "showCloseButton" | "size"
> & {
  progress?: StepDialogProgress | null;
  title: ReactNode;
  description?: ReactNode;
  /** Who this step commits, shown under the title. */
  account?: StepDialogAccount;
  /** Left side of the footer, usually Back; omit on the first step. */
  back?: ReactNode;
  /** Right side of the footer: Cancel (required — it is the way out) then the primary action. */
  actions: ReactNode;
  children?: ReactNode;
  bodyClassName?: string;
};

/* ── 分步弹窗：设置流程的唯一外壳 ─────────────────────────────────
 * Dock、记忆、同步的首次设置都是「一步一问、最后确认」，从前每处各画一套：
 * 有的右上角带 ×、进度条在左、按钮浮在正文下；有的没有 ×、进度在右、页脚
 * 成带。同一种事长成两种样子，用户每次都要重新找出口。
 *
 * 不给 ×：分步流程的出口本就是页脚里恒在的「取消」（Esc 同义），× 只会与它
 * 重复，还诱导人在第二步中途误关、丢掉已选内容。这是本组件与 AppDialogContent
 * 默认值唯一相反的地方，因此由组件焊死，调用方必须在 actions 里给出取消。
 * 页脚成带（上细线 + 浅底），与正文的滚动区分开：步骤再长，动作也永远在同一处。
 * ───────────────────────────────────────────────────────────────── */
export function StepDialogContent({
  progress,
  title,
  description,
  account,
  back,
  actions,
  children,
  className,
  bodyClassName,
  ...props
}: StepDialogContentProps) {
  return (
    <AppDialogContent
      showCloseButton={false}
      // Without a description the title alone names the dialog; repeating it as a hidden
      // description would make screen readers read it twice. Explicit undefined tells Radix so.
      {...(description ? {} : { "aria-describedby": undefined })}
      className={cn("gap-0 p-0", className)}
      {...props}
    >
      <DialogHeader className="shrink-0 gap-1 px-5 pt-5 text-left">
        {progress && progress.total > 1 && (
          <div className="flex items-center justify-between gap-4">
            <p className="text-muted-foreground text-xs">{progress.label}</p>
            <span aria-hidden="true" className="flex items-center gap-1">
              {stepSegments(progress).map((segment, index) => (
                <span key={index} data-segment={segment} className={segmentClass(segment)} />
              ))}
            </span>
          </div>
        )}
        <DialogTitle className="text-xl/7 font-semibold">{title}</DialogTitle>
        {account ? (
          <p className="flex flex-wrap items-baseline gap-x-2 pt-1 text-[13px]/[1.45]">
            <span className="text-muted-foreground">{account.label}</span>
            <span className="font-medium text-foreground">{account.value}</span>
          </p>
        ) : null}
        {description ? (
          <DialogDescription
            asChild
            className="mt-2 text-[15px]/[1.4] text-muted-foreground"
          >
            <div>{description}</div>
          </DialogDescription>
        ) : null}
      </DialogHeader>
      <AppDialogBody className={cn("mx-0 mt-4 space-y-3 px-5 pb-5", bodyClassName)}>
        {children}
      </AppDialogBody>
      <AppDialogFooter band leading={back} className="px-4">
        {actions}
      </AppDialogFooter>
    </AppDialogContent>
  );
}
