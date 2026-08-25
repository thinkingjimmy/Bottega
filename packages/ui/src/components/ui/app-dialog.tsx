"use client";

/**
 * [INPUT]: Depends on React Focus control, Share Dialog/Button/SlimScroller is a tool for combining native language and cn class names
 * [OUTPUT]: Provides AppDialogContent Unified pop-up window surface, AppDialogBody single scrolling layer, and the ConfirmationDialog standard double operation with the option to close the button/surface size to confirm pop-up window ((cancelLabel missing the host ui.cancel directory; description is down <div> It's not <p>(Including the first two volumes, the first volume is available in English)
 * [POS]: The UI standard entry for the application pop-up window in the original language layer; Complex bulkheads replicate two sets of "surface + official" and simply confirm the flow directly to replicate the entire component
 */

import {
  useRef,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { useUiText } from "@ai-chat/ui/lib/ui-text";
import { cn } from "@ai-chat/ui/lib/utils";

type AppDialogContentProps = ComponentProps<typeof DialogContent>;

/* ── 表面：只管形状，不管滚动 ──────────────────────────────────────
 * 一个盒子不能同时是「有形状的边界」和「能滚的窗口」：边界要求内容被
 * 圆角裁掉，窗口要求内容能溢出。让这个 1.35rem 圆角盒子自己滚，系统
 * 滚动条不吃 border-radius 裁剪，就会骑在弧线上，看着像挂在弹窗外面。
 * 故此处 overflow-hidden 焊死，滚动权交给 AppDialogBody。
 *
 * showCloseButton 默认 true 而非 false：两个方向的代价不对等——多一个 ×
 * 只是冗余，少一个 × 就是没有可见出口的陷阱（Esc 与点外面都看不见）。
 * 默认给出口，只有自带明确退出动作的组件才声明关掉它。
 * ───────────────────────────────────────────────────────────────── */
export function AppDialogContent({
  className,
  overlayClassName,
  showCloseButton = true,
  ...props
}: AppDialogContentProps) {
  return (
    <DialogContent
      showCloseButton={showCloseButton}
      overlayClassName={cn(
        "!bg-black/15 !backdrop-blur-none",
        overlayClassName
      )}
      className={cn(
        // 上限留 5rem 而非 1rem：弹窗居中，等于上下各让开 40px——正好是顶部
        // 那条拖拽带兼红绿灯所在的高度。no-drag 已保证点得动，这一条管的是
        // 「别去盖窗口的标题栏」，两件事分别归位，不要用其中一个顶替另一个。
        // scrollbar-slim 挂在表面而非正文层：弹窗里常有嵌套滚动区，
        // 只管住 AppDialogBody 会在同一个弹窗里出现两种滚动条。
        "scrollbar-slim flex max-h-[calc(100vh-5rem)] w-[calc(100%-1rem)] flex-col gap-0 overflow-x-hidden overflow-y-hidden rounded-[1.35rem] border border-foreground/10 bg-popover p-5 text-popover-foreground shadow-2xl ring-0 sm:max-w-[32.5rem]",
        className
      )}
      {...props}
    />
  );
}

/**
 * 弹窗正文：唯一的滚动主人。
 * flex-1 给它剩余高度，min-h-0 才让它真的可收缩——单写 min-h-0 只是「允许
 * 收缩」的许可，没有任何东西要求它收缩，内容一长照样把容器撑破。
 *
 * 它就是一个 SlimScroller，只是把弹窗里那份布局约定（吃满剩余高度）一并
 * 固化。滚动条的样式与显隐随之落在这一层而非表面：ref 若经 DialogContent
 * 转发进 Radix Content 就到不了 DOM（实测属性从未落上），而本层是自持的
 * div，ref 直达。位置上也不亏——正文层几乎撑满整个弹窗，「指针在弹窗里」
 * 与「指针在正文上」实际同义，嵌套滚动区本就住在它里面，capture 一并收得到。
 */
export function AppDialogBody({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <SlimScroller
      data-slot="app-dialog-body"
      className={cn("min-h-0 flex-1 overflow-y-auto", className)}
      {...props}
    />
  );
}

export type ConfirmationDialogProps = {
  open: boolean;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  confirmTone?: "default" | "destructive";
  busy?: boolean;
  confirmDisabled?: boolean;
  showCloseButton?: boolean;
  contentClassName?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  confirmTone = "default",
  busy = false,
  confirmDisabled = false,
  showCloseButton = false,
  contentClassName,
  onOpenChange,
  onConfirm,
}: ConfirmationDialogProps) {
  /* 「取消」是这颗原语自带的那半句话，不是调用方每次都要重说一遍的参数：
     默认值走宿主目录，于是全应用的确认弹窗一次性跟着语言走。 */
  const fallbackCancel = useUiText("cancel", "Cancel");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    if (!busy) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <AppDialogContent
        aria-busy={busy}
        className={contentClassName}
        /* 它不是「用户待在里面」的表面，是一个问句加两个答案。
           Cancel 就是那个明确的退出动作，再挂一个 × 是同一条出路的第二块牌子。 */
        showCloseButton={showCloseButton}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        {/* 表面已 overflow-hidden，故这里要自带退路：min-h-0 + auto 让超长
            description 自己滚，而不是被圆角悄悄裁掉。不用 flex-1，短文案
            才不会被撑开、把 footer 顶到天边。 */}
        <DialogHeader className="min-h-0 gap-0 overflow-y-auto text-left">
          <DialogTitle className="text-xl/7 font-semibold">
            {title}
          </DialogTitle>
          {/* description 的类型是 ReactNode，落地标签却是 Radix 默认的 <p>——
              而 <p> 只收 phrasing content。于是「说清这次删除会发生什么」这种
              真正需要卡片、列表、单选组的确认，只能把每个块级元素写成
              <span className="block">：一段为了迁就容器而存在的方言，读起来
              像 HTML，语义上什么都不是，还挡住了所有现成原语（它们渲染 div）。
              asChild 把标签换成 <div>，aria-describedby 仍由 Radix 挂在同一个
              节点上，data-slot 与 className 经 Slot 合并——调用方从此想放什么
              放什么。className 仍留在 DialogDescription 上让 cn 去合并，
              移到 <div> 上会绕开 tailwind-merge，两个字号一起落下。 */}
          <DialogDescription
            asChild
            className="mt-3 text-[15px]/[1.4] text-muted-foreground"
          >
            <div>{description}</div>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-3 shrink-0 flex-row justify-end gap-3">
          <Button
            ref={cancelRef}
            type="button"
            variant="ghost"
            size="pill"
            disabled={busy}
            className="cursor-pointer text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
            onClick={close}
          >
            {cancelLabel ?? fallbackCancel}
          </Button>
          <Button
            type="button"
            variant={confirmTone}
            size="pill"
            disabled={busy || confirmDisabled}
            className={cn(
              "cursor-pointer disabled:cursor-not-allowed",
              confirmTone === "destructive" && "border-destructive/15"
            )}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
