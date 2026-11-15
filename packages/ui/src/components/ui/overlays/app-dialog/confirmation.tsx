"use client";

/**
 * [INPUT]: Depends on Dialog/AppDialog shell and parts, Button, Spinner, host UI text, React focus control, and class merging
 * [OUTPUT]: Provides ConfirmationDialog with explicit initial/return focus and dismiss policies plus responsive cancel, secondary, destructive, and primary actions whose busy spinner lands on the button that was actually pressed
 * [POS]: packages/ui/src/components/ui/overlays/app-dialog; The confirmation surface of the product dialog spec (D6–D9, D11–D13)
 */

import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog } from "@ai-chat/ui/components/ui/dialog";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { useUiText } from "@ai-chat/ui/lib/ui-text";
import { cn } from "@ai-chat/ui/lib/utils";
import { AppDialogContent } from "./shell";
import { AppDialogFooter, AppDialogHeader } from "./parts";

export type ConfirmationDialogProps = {
  open: boolean;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  secondaryLabel?: ReactNode;
  destructiveLabel?: ReactNode;
  confirmTone?: "default" | "destructive";
  initialFocus?: "cancel" | "secondary" | "destructive" | "confirm";
  busy?: boolean;
  confirmDisabled?: boolean;
  secondaryDisabled?: boolean;
  destructiveDisabled?: boolean;
  dismissible?: boolean;
  showCancel?: boolean;
  showCloseButton?: boolean;
  contentClassName?: string;
  onCloseAutoFocus?: ComponentProps<typeof AppDialogContent>["onCloseAutoFocus"];
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onSecondary?: () => void;
  onDestructive?: () => void;
};

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  secondaryLabel,
  destructiveLabel,
  confirmTone = "default",
  initialFocus = "cancel",
  busy = false,
  confirmDisabled = false,
  secondaryDisabled = false,
  destructiveDisabled = false,
  dismissible = true,
  showCancel = true,
  showCloseButton = false,
  contentClassName,
  onCloseAutoFocus,
  onOpenChange,
  onConfirm,
  onSecondary,
  onDestructive,
}: ConfirmationDialogProps) {
  /* 「取消」是这颗原语自带的那半句话，不是调用方每次都要重说一遍的参数：
     默认值走宿主目录，于是全应用的确认弹窗一次性跟着语言走。 */
  const fallbackCancel = useUiText("cancel", "Cancel");
  /* busy 只说「有动作在飞」，没说是哪一颗按钮在飞——而三颗动作按钮同时变淡
     等于谁都没在说话。记下被按的那一颗，spinner 就落在读者刚点过的地方；
     没人按过（父组件自己把 busy 打开）时它是 null，退回「只变淡」。 */
  const [pressed, setPressed] = useState<
    "confirm" | "secondary" | "destructive" | null
  >(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const secondaryRef = useRef<HTMLButtonElement>(null);
  const destructiveRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    if (!busy) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy && (next || dismissible)) onOpenChange(next);
      }}
    >
      <AppDialogContent
        aria-busy={busy}
        className={contentClassName}
        onCloseAutoFocus={onCloseAutoFocus}
        /* 它不是「用户待在里面」的表面，是一个问句加两个答案。
           Cancel 就是那个明确的退出动作，再挂一个 × 是同一条出路的第二块牌子。
           md 确认在窄屏保持居中（D11），不 docking 成 sheet。 */
        showCloseButton={showCloseButton}
        sheetOnNarrow={false}
        onEscapeKeyDown={(event) => {
          if (busy || !dismissible) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy || !dismissible) event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const targets = {
            cancel: cancelRef,
            secondary: secondaryRef,
            destructive: destructiveRef,
            confirm: confirmRef,
          };
          const preferred = targets[initialFocus];
          [preferred, cancelRef, secondaryRef, confirmRef, destructiveRef]
            .find((target) => target.current && !target.current.disabled)
            ?.current?.focus();
        }}
      >
        {/* 表面已 overflow-hidden，故这里要自带退路：min-h-0 + auto 让超长
            description 自己滚，而不是被圆角悄悄裁掉。不用 flex-1，短文案
            才不会被撑开、把 footer 顶到天边。 */}
        <AppDialogHeader
          title={title}
          description={description}
          className="min-h-0 overflow-y-auto"
        />

        <AppDialogFooter>
          {showCancel && (
            <Button
              ref={cancelRef}
              type="button"
              variant="ghost"
              size="pill"
              disabled={busy}
              className="w-full cursor-pointer text-muted-foreground hover:text-foreground disabled:cursor-not-allowed sm:w-auto"
              onClick={close}
            >
              {cancelLabel ?? fallbackCancel}
            </Button>
          )}
          {secondaryLabel && onSecondary && (
            <Button
              ref={secondaryRef}
              type="button"
              variant="outline"
              size="pill"
              disabled={busy || secondaryDisabled}
              className="w-full cursor-pointer disabled:cursor-not-allowed sm:w-auto"
              onClick={() => {
                setPressed("secondary");
                onSecondary();
              }}
            >
              {busy && pressed === "secondary" && <Spinner />}
              {secondaryLabel}
            </Button>
          )}
          {destructiveLabel && onDestructive && (
            <Button
              ref={destructiveRef}
              type="button"
              variant="destructive"
              size="pill"
              disabled={busy || destructiveDisabled}
              className="w-full cursor-pointer border-destructive/15 disabled:cursor-not-allowed sm:w-auto"
              onClick={() => {
                setPressed("destructive");
                onDestructive();
              }}
            >
              {busy && pressed === "destructive" && <Spinner />}
              {destructiveLabel}
            </Button>
          )}
          <Button
            ref={confirmRef}
            type="button"
            variant={confirmTone}
            size="pill"
            disabled={busy || confirmDisabled}
            className={cn(
              "w-full cursor-pointer disabled:cursor-not-allowed sm:w-auto",
              confirmTone === "destructive" && "border-destructive/15"
            )}
            onClick={() => {
              setPressed("confirm");
              onConfirm();
            }}
          >
            {busy && pressed === "confirm" && <Spinner />}
            {confirmLabel}
          </Button>
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
