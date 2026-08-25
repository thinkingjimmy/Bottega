/**
 * [INPUT]: Depends on React ReactNode, Lucide ChevronRight, ui/Button and Collapsible, @ai-chat/ui
 * [OUTPUT]: Provides SettingsCanvas ((includes fill: full page length does not roll) ∙ SettingsSection, SettingsAlert, SettingsSurface, SettingsList, SettingsRow, SettingsChoiceRow, SettingsNoteList, SettingsEmpty, SettingsDisclosure, SettingsButton and SettingsSwitch 12 pure display languages
 * [POS]: The settings module is a single truth source; Settings View declares only semantics, no longer handwriting, grouping headings, setting lines, blank spaces, folding triggers, button size and switch style.The interactive object is in SettingsList, and the list of several files is in SettingsChoiceRowSelect trailing, hanging the queue status, nested, allowing the content to be further shortened to express secondary, children to place the actions belonging only to the file outside the target area), clear the SettingsNoteList, none of them are SettingsEmpty, read enough instructions to set a layer of SettingsDisclosure, and fail the SettingsAlert.The content of the list that needs to be surface but not row is settings surface. Settings surface list, or settings surface + divide-y, the page can no longer hide the second set of surface
 */

import type { ComponentProps, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@ai-chat/ui/components/ui/collapsible";
import { cn } from "@ai-chat/ui/lib/utils";

/* ============================================================
 * 画布：Settings 覆盖层唯一的量度来源。
 *
 * 只要两个视图各自手写 max-w，宽度就注定漂移——它们之前正是
 * 3xl 与 5xl 并存。统一为 4xl：设置行不至于被拉成横跨屏幕的
 * 长条，53 周热力图也仍有余量不触发横向滚动。
 *
 * 刻意不收 className：留了逃生口，漂移就会从逃生口回来。
 * 视图自己的节奏（space-y 等）由视图在 children 内声明。
 * ============================================================ */

export function SettingsCanvas({
  fill,
  children,
}: {
  /* 这一段的内容长满视口，而不是往下堆。开它的判据只有一条：
     这页的主体是一片要长期驻留的正文（编辑器），而不是一串设置行。
     正文的高度该由窗口决定——封在一个固定值里，窗口再大也没用。 */
  fill?: boolean;
  children: ReactNode;
}) {
  /* fill 收一个 section，`[&>*]` 因此指的就是它：把「谁来占满剩余高度」
     焊在画布里，而不是让视图自己去猜要在哪一层补 flex-1 与 min-h-0。
     少写 min-h-0 的症状是内容溢出容器而不报错——那种错只有量尺子才看得见。 */
  if (fill) {
    return (
      <div className="@container mx-auto flex h-full max-w-4xl flex-col p-6 [&>*]:min-h-0 [&>*]:flex-1">
        {children}
      </div>
    );
  }
  return (
    <SlimScroller className="h-full overflow-y-auto">
      <div className="@container mx-auto max-w-4xl px-6 pt-6 pb-12">
        {children}
      </div>
    </SlimScroller>
  );
}

/* ============================================================
 * 分组：标题 + 描述 + 右侧动作 + 分组级告警。
 * children 原样透传，容器由调用方决定（卡片网格或 SettingsList），
 * 因此这里没有任何形态分支。
 *
 * 动作与标题同排，描述整幅退到两者之下。
 *
 * 从前三者挤在一行里 `items-end`：动作贴的是描述的最后一行，于是它
 * 的高度跟着描述有几行走——同一页两个分组，一个描述一行、一个两行，
 * 两颗按钮就落在两个高度上，而它们本该是同一族。动作属于标题（分组
 * 叫什么，它就管着什么），那它就该与标题对齐，而不是与一段可长可短
 * 的解说文字对齐。
 *
 * 描述让出这一行还有第二个好处：它此前的可用宽度是「整幅减去按钮」，
 * 于是长句一路顶到按钮跟前，两个本无关系的东西看起来像在打架。现在
 * 它独占一行，宽度与下面那片内容对齐。
 *
 * 这里曾收在 65ch。字数上那是标准的可读行长，但画布本身只有 4xl：
 * 65ch 折算不到半幅，于是每个分组都长成「半行字 + 右边一片空 + 一张
 * 通栏卡片」，头与身各说各的宽度，读起来像没排完。段描述只有一两行，
 * 不是长文——让它与内容共用左右边界，段头才收得住口。`text-pretty`
 * 顺带管住末行孤字。
 * ============================================================ */

export function SettingsSection({
  title,
  description,
  action,
  alert,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  alert?: ReactNode;
  children: ReactNode;
}) {
  const titleId = `settings-${title.replace(/\s+/g, "-")}`;
  return (
    /* flex 而非 space-y：间距完全等价，但只有 flex 列才能让最后那块内容
       长满剩余高度（fill 画布下的编辑器正是如此）。space-y 做不到这件事，
       而两套排版并存的代价，是同一个分组在两页上高度规则不同。 */
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="space-y-1">
        <div className="flex min-h-8 items-center justify-between gap-4">
          {/* min-h-8 让有动作与没动作的分组共用同一条标题带：
              高度不该由「这段恰好有没有按钮」决定。 */}
          <h2 id={titleId} className="min-w-0 font-heading font-semibold text-sm">
            {title}
          </h2>
          {action}
        </div>
        {description && (
          <p className="text-pretty text-muted-foreground text-xs leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {alert && <SettingsAlert>{alert}</SettingsAlert>}
      {children}
    </section>
  );
}

/* ============================================================
 * 告警条：一句红字，说清刚才那次操作为什么没成。
 *
 * 这段 markup 此前在 SettingsSection 的 alert 槽与 Browser 导入弹窗的
 * 预览失败提示上各写一份，MCP 弹窗的保存失败正要成为第三份——与
 * SettingsSwitch、SettingsDisclosure 同一个故事：同一个东西写到第三遍
 * 就该有名字，否则三份迟早各自变异。
 *
 * role="alert" 焊在原语里，不留给调用方：一条看得见却不播报的错误，
 * 对读屏用户等于没发生过。
 * ============================================================ */

export function SettingsAlert({
  children,
  tone = "danger",
}: {
  children: ReactNode;
  /* danger 说「刚才那次操作没成」，warn 说「有情况但没坏」。两种共用
     同一形状（圆角、内边距、ring、role），只换配色——否则各页又会各自
     拼一套 amber，就像收编前 Usage/Extensions/Memory 各写各的那样。 */
  tone?: "danger" | "warn";
}) {
  return (
    <p
      role="alert"
      className={cn(
        "rounded-md px-3 py-2 text-xs ring-1",
        tone === "warn"
          ? "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400"
          : "bg-destructive/10 text-destructive ring-destructive/20"
      )}
    >
      {children}
    </p>
  );
}

/* ============================================================
 * 表面：Settings 里「一块内容」长什么样，只在这里定义一次。
 *
 * 它的直接成因是 Usage：那一页曾私藏一个 `SURFACE` 常量——
 * rounded-2xl + border-border/70 + bg-card/50 + shadow-xs，与这里
 * 四处都不一样（半径 18 对 10、border 对 ring、多一层影、底色还
 * 半透明）。于是同一个 Settings 覆盖层里并存两种「一块内容」的
 * 长相，而两者都没错——只是没有一个地方说了算。
 *
 * 抽出来的判据很简单：SettingsList 从来不是「表面」，它是「表面 +
 * 行分隔」。需要表面但不是行列表的内容（Usage 的图表卡、Memory 的
 * 页签面板）此前只能各抄一份 class 串，抄的那一刻就开始漂移。
 *
 * overflow-hidden 焊在这里：圆角要真的裁到子元素，否则首尾行的
 * 底色会从圆角外溢出来。浮层一律走 Portal，不受它影响。
 * ============================================================ */

export function SettingsSurface({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn(
        "overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10",
        className
      )}
    >
      {children}
    </div>
  );
}

/* ============================================================
 * 行列表：表面 + 行分隔。尾行不会留下悬空边框。
 * ============================================================ */

export function SettingsList({ className, ...props }: ComponentProps<"div">) {
  return (
    <SettingsSurface
      {...props}
      className={cn("divide-y divide-border", className)}
    />
  );
}

/* ============================================================
 * 设置行：左侧语义（标签 + 说明），右侧控件。
 * 说明随状态改写，禁用永远可解释。
 * ============================================================ */

export function SettingsRow({
  label,
  htmlFor,
  description,
  control,
}: {
  label: string;
  htmlFor: string;
  description?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="font-medium text-sm">
          {label}
        </label>
        {description && (
          <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

/* ============================================================
 * 要点列表：一组只读的「术语 + 解释」，刻意与 SettingsList 长得不一样。
 *
 * 说明曾借 SettingsList + SettingsRow 渲染，右侧塞一个空 span 充当
 * control——于是它拥有了设置行的全套外形：白卡表面、分隔线、加粗标签，
 * 唯独右边空着。用户读到的便不是「说明」，而是「一个控件没渲染出来的
 * 设置项」。空 control 本身就是这个误会的自白。
 *
 * 判据只有一条：有没有东西可点。有则 SettingsList，没有则本原语。
 * 形态跟着可交互性走，界面就不会再暗示不存在的操作。
 *
 * 它只管条目，不带标题、底色与外边距：说明该常驻页面还是收进
 * SettingsDisclosure，是调用方的语义决定，不该由排版原语替它选。
 * 条目用真 `ul`，标记也就不必拿伪元素画。
 * ============================================================ */

export function SettingsNoteList({
  items,
}: {
  items: ReadonlyArray<{ term: string; detail: ReactNode }>;
}) {
  return (
    <ul className="list-disc space-y-3 pl-4 marker:text-muted-foreground/50">
      {items.map((item) => (
        <li key={item.term}>
          <p className="font-medium text-xs">{item.term}</p>
          <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
            {item.detail}
          </p>
        </li>
      ))}
    </ul>
  );
}

/* ============================================================
 * 空态：一圈虚线围出「这里本该有东西」，外加怎么把它填上。
 *
 * 从前两段空态各写一个裸 <p>，还带着 px-4 py-5——那是卡片的内边距，
 * 而它们没有卡片。于是空态既不是内容也不是容器，只是一行缩进的灰字
 * 浮在原本该有列表的位置上：它和「还没加载完」「刚好被筛没了」
 * 长得一模一样，读者只能猜自己看到的是哪一种。
 *
 * 虚线是这里唯一该有的表面语言：实线说「这是一块内容」，虚线说
 * 「这块内容还没来」。形状在，内容不在——空缺于是有了形状，
 * 而不是一段留白。
 *
 * hint 必须说下一步。只陈述缺席的空态（「没有数据」）把用户留在
 * 原地；说清动作在哪，空态就从一句判词变成一个入口。
 * ============================================================ */

export function SettingsEmpty({
  icon,
  title,
  hint,
}: {
  icon: ReactNode;
  title: string;
  hint: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-8 text-center">
      <span
        aria-hidden="true"
        className="[&>svg]:mx-auto [&>svg]:size-6 [&>svg]:text-muted-foreground/60"
      >
        {icon}
      </span>
      <p className="mt-2.5 font-medium text-sm">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-muted-foreground text-xs leading-relaxed">
        {hint}
      </p>
    </div>
  );
}

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
      <CollapsibleTrigger className="group -mx-2 flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none">
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
  description,
  checked,
  disabled,
  onSelect,
  trailing,
  nested,
  children,
}: {
  label: string;
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
}) {
  const row = (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      /* 选中的那一档是这一组唯一的 Tab 落点；方向键在组内走。 */
      tabIndex={checked ? 0 : -1}
      onClick={onSelect}
      onKeyDown={(event) => {
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
          options[
            (index + (forward ? 1 : options.length - 1)) % options.length
          ];
        next?.focus();
        next?.click();
      }}
      className={cn(
        "flex min-h-11 w-full cursor-pointer touch-manipulation items-start gap-3 py-3 pr-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50",
        nested ? "pl-8" : "pl-4"
      )}
    >
      {/* 与 SettingsSwitch 同一套黑白语言：选中不靠第二种强调色，
          靠一个实心点在场。 */}
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full ring-inset transition-shadow motion-reduce:transition-none",
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
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-sm">{label}</span>
        {description && (
          <span className="mt-1 block text-muted-foreground text-xs leading-relaxed">
            {description}
          </span>
        )}
      </span>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </button>
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
