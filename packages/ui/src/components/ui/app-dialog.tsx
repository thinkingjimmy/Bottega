"use client";

/**
 * [INPUT]: Depends on React focus control, shared Dialog/Button/SlimScroller primitives, host UI text, and class merging
 * [OUTPUT]: Provides AppDialogContent, AppDialogBody, StepDialogContent — the one shell for step-by-step setup (progress label and segments, title, description, scrolling body, a footer band with Back on the left and Cancel/primary on the right, and deliberately no close button) — — the sole scroller, and therefore the sole clipping box, so it carries the headroom its children's rings and shadows are painted into — DialogChoice, the two-line option row for dialogs that pose a choice rather than a confirmation (bordered when it holds a selected value, plain when it is simply pressed; an optional leading icon slot houses the busy spinner so the row never shifts), and ConfirmationDialog with explicit initial/return focus and dismiss policies plus responsive cancel, secondary, destructive, and primary actions whose busy spinner lands on the button that was actually pressed
 * [POS]: The shared accessible dialog shell and confirmation surface for packages/ui consumers
 */

import {
  useRef,
  useState,
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
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
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
      /* 这四个边距不是留白，是给子元素的描边留活路。
         ring/shadow 画在 border box 之外，而 overflow-y-auto 会连带把
         overflow-x 也变成 auto——这一层于是成了裁剪盒。正文子元素天然与它
         左右齐平（本层无横向内边距），那几列像素正好落在裁剪边界外面被吃掉：
         卡片只剩上下两条横线，输入框的焦点环缺左右两段。
         负外边距把自己向外撑开，内边距再把内容推回原位——子元素一像素没动，
         而裁剪盒多出了一圈刚好够描边站的地方。

         两个轴的余量不同，因为代价不同：
         横向 4px = 这套设计里画得最远的焦点指示器（ring-2 + ring-offset-2，
         SettingsSwitch 就是），而横向不滚动，这圈余量不产生任何副作用；
         纵向只给 1px = 够细线活命即可。纵向是滚动轴，余量给多了，滚动的
         内容会越过裁剪线渗进标题与页脚的缝里——那比一条被裁的阴影更难看。

         修在裁剪盒这一层，而不是逐个给子元素补 ring-inset：后者要求每个
         调用方都记得，而漏掉的地方永远比记得的地方多。 */
      className={cn("-mx-1 -my-px min-h-0 flex-1 overflow-y-auto px-1 py-px", className)}
      {...props}
    />
  );
}

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
export type StepDialogProgress = {
  /** 1-based index of the current step. */
  index: number;
  total: number;
  /** "Step 2 of 3" in the caller's language; the segments beside it are decorative. */
  label: string;
};

export function StepDialogContent({
  progress,
  title,
  description,
  back,
  actions,
  children,
  className,
  bodyClassName,
  ...props
}: Omit<AppDialogContentProps, "title" | "children" | "showCloseButton"> & {
  progress?: StepDialogProgress | null;
  title: ReactNode;
  description?: ReactNode;
  /** Left side of the footer, usually Back; omit on the first step. */
  back?: ReactNode;
  /** Right side of the footer: Cancel (required — it is the way out) then the primary action. */
  actions: ReactNode;
  children?: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <AppDialogContent
      showCloseButton={false}
      // Without a description the title alone names the dialog; repeating it as a hidden
      // description would make screen readers read it twice. Explicit undefined tells Radix so.
      {...(description ? {} : { "aria-describedby": undefined })}
      className={cn("gap-0 p-0 sm:max-w-[34rem]", className)}
      {...props}
    >
      <DialogHeader className="shrink-0 gap-1 px-5 pt-5 text-left">
        {progress && progress.total > 1 && (
          <div className="flex items-center justify-between gap-4">
            <p className="text-muted-foreground text-xs">{progress.label}</p>
            <span aria-hidden="true" className="flex gap-1">
              {Array.from({ length: progress.total }, (_, index) => (
                <span
                  key={index}
                  className={cn(
                    "h-[3px] w-4 rounded-[2px]",
                    index < progress.index ? "bg-foreground" : "bg-border"
                  )}
                />
              ))}
            </span>
          </div>
        )}
        <DialogTitle className="font-semibold text-lg">{title}</DialogTitle>
        {description ? (
          <DialogDescription className="text-muted-foreground text-xs leading-relaxed">
            {description}
          </DialogDescription>
        ) : null}
      </DialogHeader>
      <AppDialogBody className={cn("mx-0 mt-4 space-y-3 px-5 pb-5", bodyClassName)}>
        {children}
      </AppDialogBody>
      <DialogFooter className="shrink-0 flex-row items-center gap-2 border-t bg-muted/40 px-4 py-3">
        {back}
        <span className="flex-1" aria-hidden="true" />
        {actions}
      </DialogFooter>
    </AppDialogContent>
  );
}

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
 * size 存在是因为宿主有两种字号：DialogContent（12px 正文）与
 * AppDialogContent 里 ConfirmationDialog 那套（20px 标题 / 15px 描述）。
 * 选项行该跟着所在弹窗的字号走，而不是反过来要求两种弹窗统一。
 * ───────────────────────────────────────────────────────────────── */
export type DialogChoiceProps = Omit<ComponentProps<"button">, "title"> & {
  title: ReactNode;
  detail?: ReactNode;
  /** 引导标记（如「推荐」）；只在需要替读者做决定时给。 */
  badge?: ReactNode;
  tone?: "default" | "danger";
  size?: "sm" | "md";
  busy?: boolean;
  /** 单选组的选中态。点了即执行的动作行不需要它——那种行没有「当前答案」。 */
  selected?: boolean;
  /** 前导标记。给了它，spinner 就住进这个槽，忙起来时行的几何一分不动。 */
  icon?: ReactNode;
  /**
   * bordered：一个装得住状态的盒子。plain：一份可按的清单。
   * 判据是这一行**有没有当前值**——单选组的选中态要填色，填色需要边框兜住；
   * 点了即执行的选项没有值可存，那圈框就只是一圈没有职责的描边。
   */
  variant?: "bordered" | "plain";
};

export function DialogChoice({
  title,
  detail,
  badge,
  tone = "default",
  size = "md",
  busy = false,
  selected = false,
  disabled = false,
  icon,
  variant = "bordered",
  className,
  ...props
}: DialogChoiceProps) {
  const danger = tone === "danger";
  const plain = variant === "plain";
  /* 槽位只要出现过就一直占位。若只在 busy 时插一个 spinner，标题会在按下的
     那一刻整体右移——页脚按钮上刚除掉的那种抖动，没有理由留在选项行里。 */
  const slot = icon !== undefined;
  return (
    <button
      data-slot="dialog-choice"
      type="button"
      disabled={disabled}
      className={cn(
        "cursor-pointer bg-clip-padding text-left transition-all outline-none",
        "focus-visible:ring-2 disabled:pointer-events-none",
        plain
          ? "rounded-xl"
          : "rounded-md border border-border focus-visible:border-ring dark:bg-input/30",
        size === "sm" ? "px-3 py-2" : plain ? "px-2.5 py-2" : "px-3.5 py-2.5",
        danger
          ? cn(
              "hover:bg-destructive/10 focus-visible:ring-destructive/20",
              !plain && "hover:border-destructive/40 focus-visible:border-destructive/40"
            )
          : cn(
              plain ? "hover:bg-muted/60" : "hover:bg-input/50",
              "focus-visible:ring-ring/30"
            ),
        // 被推荐的那行靠描边取得主次，不靠色块——这套配色没有强调色，
        // 填色会被读成「已选中」。
        badge && !danger && "border-foreground/25",
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
      <span className="flex items-start gap-2.5">
        {slot && (
          <span
            aria-hidden={busy ? undefined : "true"}
            className={cn(
              "grid size-5 shrink-0 place-items-center",
              danger ? "text-destructive" : "text-foreground/65",
              "[&_svg:not([class*='size-'])]:size-4"
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
              size === "md" && "text-[15px]/5",
              danger && "text-destructive"
            )}
          >
            {/* 没有槽位的行退回原样：spinner 直接插在标题前，行为与从前一致。 */}
            {busy && !slot && (
              <Spinner className={size === "sm" ? "size-3" : "size-3.5"} />
            )}
            {title}
            {badge && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 text-[11px]/[17px] font-medium text-foreground">
                {badge}
              </span>
            )}
          </span>
          {detail && (
            <span
              className={cn(
                "mt-0.5 block text-muted-foreground",
                size === "md" && "mt-[3px] text-[13px]/[1.45]"
              )}
            >
              {detail}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

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
  onCloseAutoFocus?: AppDialogContentProps["onCloseAutoFocus"];
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
           Cancel 就是那个明确的退出动作，再挂一个 × 是同一条出路的第二块牌子。 */
        showCloseButton={showCloseButton}
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

        <DialogFooter className="mt-3 shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-x-3 sm:gap-y-2">
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
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
