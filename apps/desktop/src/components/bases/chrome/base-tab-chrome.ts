/**
 * [INPUT]: The cn-contact that relies solely on ui will intentionally not touch any components/Radix to be introduced into safe static before the jsDOM load globals by DOM testing
 * [OUTPUT]: Provides baseTabShellClass(active) with baseTabActionButtonClass: the same set of tabs that are shared between the host tab and the view tab
 * [POS]: The only true source of the tab visual language of bases/chrome; Consumed simultaneously by BaseViewTabs and Host PanelTabs, the size difference is left to the caller
 */

import { cn } from "@ai-chat/ui/lib/utils";

/* ── 为何独立成模块 ────────────────────────────────────────────────
 * 宿主 tab 条（PanelTabs）与视图 tab 条（BaseViewTabs）是同一种视觉语言，
 * 曾各自抄了一份：group 名不同、内容逐字相同。代价是真实的——
 * 「动作按钮何时显现」改一次要改两处、测两处，任何一处漏改就静默劈叉。
 *
 * 病根不在重复本身，而在 group 名与读它的 group-hover 分居两地：
 * 谁也无法保证对方还在。让它们出生在同一处，drift 就不再可能，
 * 于是两个 tab 条只需各自补上真正不同的东西——尺寸与层级。
 * ────────────────────────────────────────────────────────── */

/** tab 外壳的不变量：形状、字号、active/inactive 配色。尺寸留给调用方。 */
export function baseTabShellClass(active: boolean) {
  return cn(
    "group/tab-chrome flex max-w-40 cursor-pointer items-center rounded-md pr-1 pl-2 text-xs transition-colors",
    active
      ? "bg-muted font-medium text-foreground"
      : "text-muted-foreground hover:bg-muted/50"
  );
}

/**
 * tab 内动作按钮（⋯ / ✕）：默认隐形，三条通道让它显现，
 * 共同点是都表示「用户此刻正在与它交涉」——
 * 指针 hover 整个 tab、按钮自身拿到 focus-visible（键盘 Tab 过来）、或它的菜单正展开。
 *
 * 刻意不用 group-focus-within：鼠标点一下 tab，focus 就留在 tab 上，
 * focus-within 会让按钮从此赖着不走——那说明的是「点过」而非「正在看」。
 * 而 data-[state=open] 是必需的：菜单 portal 到 body，指针一旦移到菜单项上就离开了
 * tab，若无此条按钮会在自己的菜单底下淡出。focus-visible 只认键盘，可达性不受影响。
 */
export const baseTabActionButtonClass =
  "cursor-pointer rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover/tab-chrome:opacity-100 data-[state=open]:opacity-100 disabled:pointer-events-none";
