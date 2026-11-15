"use client";

/**
 * [INPUT]: Depends on shared Dialog/Button primitives, host UI text, React context size tier, and class merging
 * [OUTPUT]: Provides AppDialogHeader (20/28 title + 15px description), AppDialogFooter (leading slot, right-aligned pill group, banded on lg/xl, stacked primary-on-top below sm), AppDialogCancel (localized ghost close; DialogClose wrapper only when no onClick is given), AppDialogField (13/500 label, helper or error wiring aria-invalid), AppDialogAlert (SettingsAlert-shaped inline error/warning above the footer)
 * [POS]: packages/ui/src/components/ui/overlays/app-dialog; The header/footer/field/alert parts of the product dialog spec (D4–D10, D13, D15)
 */

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { useUiText } from "@ai-chat/ui/lib/ui-text";
import { cn } from "@ai-chat/ui/lib/utils";
import { SettingsInlineAlert } from "@ai-chat/ui/components/settings/alert";
import { useAppDialogSize } from "./shell";

/* ── 头部：20/28 标题 + 15px 描述（D4/D5）──────────────────────────
 * description 经 DialogDescription asChild 落地为 <div>：Radix 默认的 <p>
 * 只收 phrasing content，卡片、列表、单选组这些真正的「说明」都是块级——
 * asChild 后调用方想放什么放什么，aria-describedby 仍挂在同一节点上。
 *
 * 没有 description 时，调用方必须在 AppDialogContent 上传
 * aria-describedby={undefined}——否则 Radix 会因为找不到描述节点而告警，
 * 沉默的回退是把标题再读一遍。
 * ───────────────────────────────────────────────────────────────── */
export function AppDialogHeader({
  title,
  description,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <DialogHeader className={cn("shrink-0 gap-0 text-left", className)}>
      <DialogTitle className="text-xl/7 font-semibold">{title}</DialogTitle>
      {children}
      {description ? (
        <DialogDescription
          asChild
          className="mt-2 text-[15px]/[1.4] text-muted-foreground"
        >
          <div>{description}</div>
        </DialogDescription>
      ) : null}
    </DialogHeader>
  );
}

/* ── 页脚：右对齐的 pill 组（D7–D10）───────────────────────────────
 * sm 及以上：leading 贴在左缘（Back 或 destructive ghost），其余按钮靠右。
 * sm 以下：flex-col-reverse 让 DOM 最后的 primary 落在最上、Cancel 落在最
 * 底——视觉上「主按钮在上、取消在下」，而 DOM 顺序保持 Cancel 在前，读屏与
 * 键盘遍历的顺序不被视觉翻转带跑。
 *
 * band（上细线 + muted/40 底）默认跟随尺寸档：lg/xl 的正文会滚动，页脚必须
 * 固在原地，带就是它「不随正文走」的视觉声明；md 不滚动，不需要这道线。
 * ───────────────────────────────────────────────────────────────── */
export function AppDialogFooter({
  leading,
  band,
  className,
  children,
}: {
  /** Left-edge slot: Back on step dialogs, or a destructive ghost action. */
  leading?: ReactNode;
  /** Top border + muted background. Defaults to true on lg/xl, false on md. */
  band?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const size = useAppDialogSize();
  const banded = band ?? size !== "md";
  return (
    <div
      data-slot="app-dialog-footer"
      className={cn(
        "flex shrink-0 flex-col-reverse items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end",
        banded
          ? "-mx-5 -mb-5 mt-5 border-t bg-muted/40 px-5 py-3"
          : "mt-5",
        className
      )}
    >
      {leading ? (
        <span className="contents sm:mr-auto sm:flex sm:items-center">
          {leading}
        </span>
      ) : null}
      {children}
    </div>
  );
}

/* ── 取消：唯一的关闭按钮样式（D8/D9）──────────────────────────────
 * 「取消」是弹窗自带的那半句话，不是调用方每次都要重说一遍的参数：
 * 默认文案走宿主目录，全应用一次性跟着语言走。ghost + muted 让它始终是
 * 最轻的那颗，不与任何动作争主次。
 * ───────────────────────────────────────────────────────────────── */
export function AppDialogCancel({
  children,
  className,
  onClick,
  ...props
}: ComponentProps<typeof Button>) {
  const fallbackCancel = useUiText("cancel", "Cancel");
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="pill"
      className={cn("text-muted-foreground hover:text-foreground", className)}
      onClick={onClick}
      {...props}
    >
      {children ?? fallbackCancel}
    </Button>
  );
  /* 调用方给了 onClick 就由它全权负责关闭——先跑完自己的流程再关。
     再叠一层 DialogClose 会让 Radix 同时触发 onOpenChange(false)，
     等于取消动作没做完弹窗就没了。 */
  return onClick ? button : <DialogClose asChild>{button}</DialogClose>;
}

/* ── 字段：13/500 标签 + 36px 输入 + 13px 辅助/错误（D15）──────────
 * error 出现时顶替 helper——同一个槽位不同时说两句话。aria-invalid 与
 * aria-describedby 由这里接到子输入上，调用方只管把输入元素放进来。
 * ───────────────────────────────────────────────────────────────── */
export function AppDialogField({
  label,
  htmlFor,
  helper,
  error,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  helper?: ReactNode;
  /** When set, replaces the helper and marks the field aria-invalid. */
  error?: ReactNode;
  /** Exactly one field element (Input/Textarea/Select). */
  children: ReactNode;
}) {
  const messageId = useId();
  const message = error ?? helper;
  const field = Children.only(children);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium">
        {label}
      </label>
      {isValidElement(field)
        ? cloneElement(field as ReactElement<Record<string, unknown>>, {
            "aria-invalid": error ? true : undefined,
            "aria-describedby": message ? messageId : undefined,
          })
        : field}
      {message ? (
        <p
          id={messageId}
          className={cn(
            "text-[13px]",
            error ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

/* ── 行内警示：页脚上方的那一句话（D13）────────────────────────────
 * 与 SettingsAlert 同一形状：同一种「这里出了状况」在两处就该长一个样。
 * 对话框里弹窗主按钮本身会重跑这一步，因此这里通常不传 action（decisions
 * 规则 9），主按钮保留自己的步骤名（「Set up」「Import」…），不叫 Retry。
 * ───────────────────────────────────────────────────────────────── */
export function AppDialogAlert({
  tone = "danger",
  title,
  description,
  action,
  className,
  children,
}: {
  tone?: "danger" | "warn";
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <SettingsInlineAlert
      tone={tone}
      title={title ?? children}
      description={description}
      action={action}
      className={cn("mt-4", className)}
    />
  );
}
