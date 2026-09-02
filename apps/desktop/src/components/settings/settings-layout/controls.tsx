/**
 * [INPUT]: Depends on React useId/ReactNode/ComponentProps/KeyboardEvent, Lucide ChevronRight, ui/Button/Collapsible/Tooltip, and @ai-chat/ui styling primitives
 * [OUTPUT]: Provides SettingsDisclosure, SettingsButton, SettingsIconButton, SettingsLabelAction, SettingsSwitch and SettingsChoiceRow -- every Settings control, with touch target, focus ring and roving selection welded in
 * [POS]: The controls third of settings-layout/; domain views declare semantics while interaction consistency lives here and nowhere else
 */

import {
  useId,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@ai-chat/ui/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";
import { cn } from "@ai-chat/ui/lib/utils";

/* ============================================================
 * 折叠说明：读一次就够的话，收进一行可展开的触发器。
 *
 * 这段 markup 此前在 Memory 的两个折叠区
 * 各抄了一份，两份已经漂开——后者丢了整个 focus-visible 环，键盘用户
 * 走到它身上看不见自己在哪。与 SettingsSwitch 同一个故事：同一个控件
 * 只能有一份实现，样式才没有地方各自变异。
 *
 * 折叠不是把话藏起来，是把「还没读过」与「已经读过」两种人分开伺候：
 * 前提读一遍就成了常识，此后每次进这页都要先翻过它才够得着唯一的动作。
 * ============================================================ */

export function SettingsDisclosure({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Collapsible>
      {/* -mx-2 让文字与上下文左对齐，hover 底色仍有内边距可撑 */}
      <CollapsibleTrigger className="group -mx-2 flex min-h-11 touch-manipulation cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ============================================================
 * 动作按钮：Settings 里所有文字按钮的唯一实现。
 *
 * 从前一律 `size="sm"`（24px）。那是给密排 chrome 准备的尺码，摆在
 * 14px 行标题 + 12px 说明旁边就显得瘦弱——读起来像个次要标签，
 * 而不是一个可点的动作。同一页里五个视图各写各的尺码，
 * 差异不会自己收敛，只会越攒越多。
 *
 * 抬到 32px 并给足水平内边距，动作与它解释的那行文字等重。
 * 刻意不收 `size`：留了尺码逃生口，各页迟早再次各写各的。
 * 图标按钮不走这里——它们另有 44px 触控与 24px 密排两套理由。
 * ============================================================ */

export function SettingsButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "size">) {
  return (
    <Button
      type="button"
      {...props}
      className={cn("h-8 px-3", className)}
      size="lg"
    />
  );
}

/* ============================================================
 * 图标动作：与 SettingsButton 同族的方形版，只是把文字换成图标。
 *
 * 它的成因是 Memory 引擎抽屉：一行里主动作带文字（升级、配置），
 * 次动作只有图标（选版本、发布说明、卸载、显示位置、重新检测）。
 * 从前次动作是一串点线链接，与描边按钮并排——同一排里两种控件语言，
 * 读者得先分辨「这个能点吗」再决定看不看。主次该由**有没有文字**表达，
 * 而不是由「是不是按钮」表达：边框、高度、圆角三样必须与文字按钮同源，
 * 否则一排读起来就是散的。
 *
 * label 是必填且一物二用：aria-label 播报给读屏，Tooltip 悬停/聚焦给
 * 鼠标与键盘。图标按钮没有可读文字，少了它这颗按钮就等于不存在。
 *
 * 命中区沿用 pill 的做法——视觉 32px，::after 撑到 44px 高，不占版面。
 * 横向只借 4px：调用方以 gap-2 排布时，相邻两颗的命中区恰好相接而不
 * 重叠。重叠意味着边界上的一次点击归谁全看 DOM 次序，而这一排里正
 * 坐着「卸载」——把破坏性动作交给栈序去仲裁，是不可接受的。
 * ============================================================ */

/** 无文字的东西必须自己报名字：aria-label 给读屏，tooltip 给鼠标。
    两种图标按钮的层级不同，但「怎么报名字」只该有一份实现。 */
function namedIcon(label: string, button: ReactNode) {
  return (
    <TooltipProvider delayDuration={350}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function SettingsIconButton({
  label,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "size" | "aria-label" | "title"> & {
  /** 同时作为 aria-label 与 Tooltip 文案：图标本身不可读。 */
  label: string;
}) {
  return namedIcon(
    label,
    <Button
      type="button"
      variant="outline"
      {...props}
      aria-label={label}
      size="lg"
      className={cn(
        "relative size-8 touch-manipulation px-0 touch-target-44 [--touch-target-inset:-4px]",
        className
      )}
    />
  );
}

/* ============================================================
 * 标题旁的图标动作：它必须让位给标题。
 *
 * 与 SettingsIconButton 是两件事，尽管两者都只有一个图标：那个住在
 * 属性行里，自带边框与 32px 高度，一排读起来是一族；这个寄居在一行
 * 文字中间，边框会让它读成另一个层级，而满色的图标会让一个次要入口
 * 跟标题抢第一眼。
 *
 * 它的成因是漂移：外链图标曾在引擎册与初次设置里各写一份 className，
 * 一份写了 muted 与 hover 分级，另一份只写了 variant="ghost"——于是同
 * 一个图标在两页上一深一浅。同一个东西写到第二遍就该有名字。
 *
 * hover 底色锁在 (hover:hover) and (pointer:fine) 里：触屏上的 hover
 * 按下去就粘住，一个粘住的高亮读起来像「这一项被选中了」。
 * ============================================================ */

export function SettingsLabelAction({
  label,
  className,
  ...props
}: Omit<
  ComponentProps<typeof Button>,
  "size" | "variant" | "aria-label" | "title"
> & {
  /** 同时作为 aria-label 与 Tooltip 文案：图标本身不可读。 */
  label: string;
}) {
  return namedIcon(
    label,
    <Button
      type="button"
      variant="ghost"
      {...props}
      aria-label={label}
      size="lg"
      className={cn(
        /* -ml-1 收掉图标左侧的内边距，让它贴住标题——它是标题的附注，
           不是这一行里的下一个词。命中区横向只借 6px：紧挨着它的就是
           标题本身，重叠意味着一次点在名字上的点击可能开了浏览器。 */
        "-ml-1 relative size-8 touch-manipulation px-0 text-muted-foreground",
        "touch-target-44 [--touch-target-inset:-6px]",
        "hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent",
        "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground [@media(hover:hover)_and_(pointer:fine)]:dark:hover:bg-muted/50",
        className
      )}
    />
  );
}

/* ============================================================
 * 开关：24px 视觉轨道套在 44px 点击区里，减弱动画偏好一律降级。
 *
 * 这段 markup 曾在跨 Chat 只读与 Usage 价格两处各抄一份，抄的
 * 那一刻就已经漂移——其中一份丢了 ring-offset。同一个控件只能
 * 有一份实现，样式才没有地方各自变异。
 *
 * label 只说「这是谁」，不说「它现在是开是关」：状态由 aria-checked
 * 播报，标签再复述一遍，读屏念出来就是「列出 Sections 已开启, 开关,
 * 开」。两处调用方都曾拼一个三元进 label——那个三元本身就是重复的
 * 自白，删掉它，分支和噪音一起消失。
 * ============================================================ */

export function SettingsSwitch({
  id,
  label,
  checked,
  disabled,
  onToggle,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="flex size-11 touch-manipulation cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
      onClick={() => onToggle(!checked)}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative h-6 w-11 rounded-full transition-colors motion-reduce:transition-none",
          checked ? "bg-foreground" : "bg-muted-foreground/30"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none",
            checked ? "translate-x-5" : "translate-x-0"
          )}
        />
      </span>
    </button>
  );
}

/* ============================================================
 * 三选一行：一个枚举有几档，界面就画几档。
 *
 * 它的直接成因是 Memory 的共享范围——后端存的是 `chat | group |
 * personal` 一个枚举，界面却给了两个联动开关，第二个还依赖第一个：
 * 关掉前一个会静默降两级，而界面一个字都没说。两个可变布尔表达一个
 * 三态，等于把真值表外包给用户，还顺带养出一层只为对齐这份错位而
 * 存在的映射函数。三态就画三选一，映射层与那道依赖一起消失。
 *
 * 整行都是命中区，不是只有那个圈：说明文字与标签本就在讲同一件事，
 * 点它们却不生效，是把「可读的」和「可点的」割成两块。
 *
 * roving tabindex 与方向键焊在原语里，与 SettingsSwitch 把 44px 和
 * ring-offset 焊进去同一个理由——一组 radio 若每个都能 Tab 到，键盘
 * 用户就得按三次才走完一个本该一次到位的选择。
 * ============================================================ */

export function SettingsChoiceRow({
  label,
  labelMeta,
  labelAction,
  description,
  checked,
  disabled,
  onSelect,
  trailing,
  nested,
  children,
  disclosure,
}: {
  label: string;
  /** 紧跟名称的短事实，如版本号；它属于 radio 的可读标题。 */
  labelMeta?: ReactNode;
  /** 紧跟标题但独立执行的动作；作为 radio 的兄弟节点，禁止按钮嵌套。 */
  labelAction?: ReactNode;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onSelect(): void;
  /** 行尾状态：这一档此刻怎么样。它属于选项本身，故与标签同处命中区内。 */
  trailing?: ReactNode;
  /** 二级：内容再让开一步，缩进本身就说清了它归谁管。 */
  nested?: boolean;
  /** 只属于这一档的动作。它在命中区之外——点「修复安装」不该顺手选中。 */
  children?: ReactNode;
  /** 这一档带抽屉时的展开控制。给了它，整行命中区就归展开，圈缩回自己
      那 44px 里去。

      两个动作的代价差着量级：展开是免费的、可逆的，看完收起来什么也没
      发生；换档要签字、回不去。把不可逆的那个铺满整行，等于让一次好奇
      心变成一次换代——命中区的大小该按后果给，不是按控件大小给。 */
  disclosure?: {
    open: boolean;
    /** 读屏念的那句话，随开合换词（「管理 X」/「收起 X」）。 */
    label: string;
    /** 需要处置的那一档收不起来：折叠永远藏不住一件坏掉的东西。 */
    disabled?: boolean;
    onToggle(): void;
  };
}) {
  const labelId = useId();
  const descriptionId = useId();
  const moveWithArrow = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const backward = event.key === "ArrowUp" || event.key === "ArrowLeft";
    if (!forward && !backward) return;
    event.preventDefault();
    const group = event.currentTarget.closest('[role="radiogroup"]');
    const options = Array.from(
      group?.querySelectorAll<HTMLButtonElement>(
        '[role="radio"]:not(:disabled)'
      ) ?? []
    );
    const index = options.indexOf(event.currentTarget);
    if (index < 0 || options.length === 0) return;
    const next =
      options[(index + (forward ? 1 : options.length - 1)) % options.length];
    next?.focus();
    next?.click();
  };
  const indicator = (
    <span
      aria-hidden="true"
      className={cn(
        /* mt-px 而非 mt-0.5：圈 18px，标题一行是 20px，居中差的正是这
           1px。行内每样东西都该按那一行文字对齐，而不是各自贴顶。 */
        "mt-px grid size-[18px] shrink-0 place-items-center rounded-full ring-inset transition-shadow motion-reduce:transition-none",
        checked
          ? "ring-[1.5px] ring-foreground"
          : "ring-[1.5px] ring-muted-foreground/40"
      )}
    >
      <span
        className={cn(
          "size-[9px] rounded-full bg-foreground transition-transform motion-reduce:transition-none",
          checked ? "scale-100" : "scale-0"
        )}
      />
    </span>
  );
  const content = (
    <span className="min-w-0 flex-1">
      <span
        data-settings-choice-heading=""
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
      >
        <span id={labelId} className="font-medium text-sm">
          {label}
        </span>
        {labelMeta}
        {labelAction && (
          /* h-5 是 text-sm 的行高，把这个槽锁死在一行文字上：塞进来的
             按钮通常有 32px，撑高标题行的代价是那颗单选圈当场偏上——它
             的位置按一行文字算，而标题此刻在一个更高的盒子里居中。高度
             归这里一处管，调用方不必各自记得写负 margin。 */
          <span className="pointer-events-auto relative z-20 inline-flex h-5 items-center">
            {labelAction}
          </span>
        )}
      </span>
      {description && (
        <span
          id={descriptionId}
          className="mt-1 block text-muted-foreground text-xs leading-relaxed"
        >
          {description}
        </span>
      )}
    </span>
  );
  const radioProps = {
    type: "button" as const,
    role: "radio" as const,
    "aria-checked": checked,
    "aria-labelledby": labelId,
    "aria-describedby": description ? descriptionId : undefined,
    disabled,
    tabIndex: checked ? 0 : -1,
    onClick: onSelect,
    onKeyDown: moveWithArrow,
  };
  const rowClasses = cn(
    "flex min-h-11 w-full cursor-pointer touch-manipulation items-start gap-3 py-3 text-left outline-none",
    disclosure ? "pr-3" : "pr-4",
    nested ? "pl-8" : "pl-4"
  );
  /* 一行只有一颗铺满的按钮，谁来铺由后果决定：没有抽屉时能做的只有
     选择，它自然铺满；有抽屉时展开铺满，选择缩回圈里那 44px。展开免费
     可逆，换档要签字回不去——命中区按后果给，不按控件大小给。 */
  const fillProps = disclosure
    ? {
        type: "button" as const,
        "aria-expanded": disclosure.open,
        "aria-label": disclosure.label,
        disabled: disclosure.disabled,
        onClick: disclosure.onToggle,
      }
    : radioProps;
  const row = (
    <div
      className={cn(
        "relative",
        rowClasses,
        /* 有抽屉时 disabled 说的只是「这一档还切不过去」，抽屉照样能开
           （里面装的正是让它能切过去的那个动作）。整行跟着变灰，等于
           把一扇开着的门画成锁上的。 */
        !disclosure && disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <button
        {...fillProps}
        className="absolute inset-0 z-0 cursor-pointer touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset disabled:cursor-not-allowed"
      />
      <span className="pointer-events-none relative z-10 contents">
        {disclosure ? (
          <button
            {...radioProps}
            className={cn(
              "pointer-events-auto relative flex shrink-0 cursor-pointer touch-manipulation items-start rounded-full outline-none",
              /* 圈只有 18px，命中区独自撑到 44px——与 Button size="pill"
                 同一手法：看起来多大与点得中多大是两个问题。 */
              "after:-translate-x-1/2 after:-translate-y-1/2 after:absolute after:top-1/2 after:left-1/2 after:size-11 after:content-['']",
              "focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
            )}
          >
            {indicator}
          </button>
        ) : (
          indicator
        )}
        {content}
        {/* 行尾状态锁在标题那一行的高度上：它的字号比标题小，贴顶会让
            它整体上浮，读起来像浮在名字上方而不是与名字并排。 */}
        {trailing && (
          <span className="flex h-5 shrink-0 items-center">{trailing}</span>
        )}
        {disclosure && (
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
              disclosure.open && "rotate-90",
              disclosure.disabled && "opacity-40"
            )}
          />
        )}
      </span>
    </div>
  );
  if (!children) return row;
  /* 动作缩进到标签那条竖线上（圈 18px + gap 12px），否则它与圈左对齐，
     「这排按钮归哪一档」在视觉上就是断的——与披露弹窗里 pl-6 同一个理由。 */
  return (
    <div>
      {row}
      <div className={cn("pr-4 pb-3", nested ? "pl-[3.875rem]" : "pl-[2.875rem]")}>
        {children}
      </div>
    </div>
  );
}
