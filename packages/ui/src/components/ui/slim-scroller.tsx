"use client";

/**
 * [INPUT]: Depends on the use-scroll-activity of the activity kernel, scrollbar-slim utility of globals.css, radix Slot and cn
 * [OUTPUT]: Provides SlimScroller rolling containers (includes asChild: rolling area can be any element such as pre/ul/span)
 * [POS]: ui is the only rolling zone input in the original language layer; Put the "style + concealment" in half and the caller writes the overflow and layout
 */

import type { ComponentProps } from "react";
import { Slot } from "radix-ui";
import { useScrollActivity } from "@ai-chat/ui/hooks/use-scroll-activity";
import { cn } from "@ai-chat/ui/lib/utils";

/**
 * 自绘滚动条本是两半：`scrollbar-slim` 画样子，`useScrollActivity` 管显隐。
 * 分开供给意味着每个滚动区都要记住"这里有两件事"，而漏掉任一半都不会报错——
 * 漏 class 得到系统滚动条，漏 hook 得到一条永不现身的透明拇指。这种「少写一半
 * 也能跑」的搭配注定会被写漏，故焊成一件，让漏无可漏。
 *
 * ref 走合并而非独占：表格/列表/看板的虚拟化都要拿这个 DOM 量高度，
 * 组件抢走 ref 等于逼调用方在「要滚动条」和「要虚拟化」之间选一个。
 *
 * asChild 同理，是为另一种「被迫二选一」而设：日志与代码块的滚动主人天生是
 * `<pre>`，命令清单是 `<ul>`——若本组件只会渲染 div，这些地方要么外包一层
 * 徒增盒子（`<pre>` 的 `w-fit`、背景与横向滚动会当场错位），要么就地手抄两半，
 * 而手抄正是这条规矩要消灭的东西。语义元素与滚动条不该互相排斥：
 * 元素归调用方选，两半仍由此处焊死。
 */
export function SlimScroller({
  asChild = false,
  className,
  ref,
  ...props
}: ComponentProps<"div"> & { asChild?: boolean }) {
  const activityRef = useScrollActivity<HTMLDivElement>();
  const Comp = asChild ? Slot.Root : "div";
  return (
    <Comp
      data-slot="slim-scroller"
      ref={(node: HTMLDivElement | null) => {
        activityRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      className={cn("scrollbar-slim", className)}
      {...props}
    />
  );
}
