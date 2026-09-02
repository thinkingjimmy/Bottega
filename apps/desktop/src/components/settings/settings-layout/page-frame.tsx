/**
 * [INPUT]: Depends on React ReactNode, ui/SlimScroller, and @ai-chat/ui styling primitives
 * [OUTPUT]: Provides SettingsCanvas, SettingsSection and SettingsAlert -- the frame every Settings page is measured against
 * [POS]: The page-frame third of settings-layout/; owns width, scroll, group rhythm and the one shape a failed action speaks in
 */

import type { ReactNode } from "react";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
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
