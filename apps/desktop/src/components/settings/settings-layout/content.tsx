/**
 * [INPUT]: Depends on React ReactNode/ComponentProps, Lucide ArrowUpRight, and @ai-chat/ui styling primitives
 * [OUTPUT]: Provides SettingsSurface, SettingsList, tone-aware SettingsRow, SettingsBadge, SettingsLinkRow, SettingsNoteList and SettingsEmpty -- what "a piece of content" looks like inside the frame
 * [POS]: The content third of settings-layout/; a surface earns its ring only by holding rows, and each row's shape follows whether it can be acted on
 */

import type { ComponentProps, ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@ai-chat/ui/lib/utils";

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
 *
 * 那条 ring 是外扩的（画在 border box 之外）。它会不会被裁，是裁剪层的
 * 责任而不是表面的——滚动容器必须给子元素的描边留出余量，AppDialogBody
 * 就是这么做的。表面不该反过来去猜谁在裁自己。
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
 * 设置行：左侧语义（标签 + 状态徽标 + 说明），右侧控件。
 * 说明随状态改写，禁用永远可解释。
 *
 * badge 贴在名字后面而不是塞进右侧控件区：状态是「这一项是什么」
 * 的一部分，不是一个可操作的东西。名字读完立刻知道它是死是活，
 * 眼睛不必先横穿一整行去右边找答案。
 * ============================================================ */

export function SettingsRow({
  label,
  htmlFor,
  badge,
  description,
  control,
  tone = "default",
}: {
  label: string;
  /** 只在 control 真有可关联的表单元素时传：悬空的 htmlFor 是无障碍谎言。 */
  htmlFor?: string;
  badge?: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  tone?: "default" | "destructive";
}) {
  const labelClassName = cn(
    "font-medium text-sm",
    tone === "destructive" && "text-destructive"
  );
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {htmlFor ? (
            <label htmlFor={htmlFor} className={labelClassName}>
              {label}
            </label>
          ) : (
            <span className={labelClassName}>{label}</span>
          )}
          {badge}
        </div>
        {description && (
          <p
            className={cn(
              "mt-1 text-xs leading-relaxed",
              tone === "destructive" ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

/* ============================================================
 * 状态徽标：一项东西此刻是什么状态，用一枚贴在名字后面的小药丸说。
 *
 * 它此前在 Memory 引擎册与运行时面板各写了一份，Apps 的工具与插件
 * 清单正要成为第三、第四份——而那两份已经漂开：一份 bg-muted，一份
 * bg-primary/10，圆角与字号也各不相同。与 SettingsSwitch、
 * SettingsDisclosure 同一个故事，同一个东西写到第三遍就该有名字。
 *
 * 档位按「读的人要不要做点什么」分，而不是按颜色分：
 *   neutral 一切正常，不必理会；
 *   warn    有情况但没坏，通常等一个动作（未装、待授权）；
 *   danger  已经坏了或被拒；
 *   muted   一项事实，无所谓好坏（未启用、可选）。
 * 调用方声明语义，不选颜色——否则同一种状态迟早在两页上是两种色。
 * ============================================================ */

export function SettingsBadge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "warn" | "danger" | "muted";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 font-medium text-xs",
        tone === "warn"
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : tone === "danger"
            ? "bg-destructive/10 text-destructive"
            : tone === "muted"
              ? "bg-muted text-muted-foreground"
              : "bg-muted text-foreground"
      )}
    >
      {children}
    </span>
  );
}

/* ============================================================
 * 外跳行：整行就是命中区，行尾一支箭头说清点下去会离开应用。
 *
 * 它的成因是 About：从前每条链接是一行文字配一颗右侧描边按钮，于是
 * 同一行里「可读的」和「可点的」被割成两块——按钮不到 100px，行有
 * 848px，剩下那七百多像素读起来像可以点，按下去什么也不会发生。判据
 * 与 SettingsChoiceRow 同源：文字与动作讲的是同一件事，那它们就该共用
 * 同一个命中区。
 *
 * 描述位刻意收窄语义——它说的是「点过去会看到什么」（一个域名、一句
 * 去处），不是 SettingsRow 那种「这一项现在怎么样」的状态。状态属于
 * 可改的设置项，而这一行没有任何东西可改。
 *
 * 箭头焊死不留开关：这个原语的全部承诺就是「这一下会离开应用」。哪天
 * 真需要一个就地展开的行，那是另一种承诺，该另起一个名字，而不是给这
 * 里加一个 boolean 让同一个名字说两件事。
 * ============================================================ */

export function SettingsLinkRow({
  label,
  description,
  onSelect,
}: {
  label: string;
  description?: ReactNode;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      /* 行高 64px 已远超 44px，故不必再借 ::after 撑命中区——
         SettingsButton 那套触控补偿是给 32px 控件准备的。 */
      className="flex w-full cursor-pointer touch-manipulation items-center justify-between gap-6 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset motion-reduce:transition-none"
    >
      <span className="min-w-0">
        <span className="block font-medium text-sm">{label}</span>
        {description && (
          <span className="mt-1 block text-muted-foreground text-xs leading-relaxed">
            {description}
          </span>
        )}
      </span>
      <ArrowUpRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </button>
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
