/**
 * [INPUT]: Depends on React and style tools; The bottom color is customized to the host surface (command-item / tooltip-content)
 * [OUTPUT]: Provides Kbd with KbdGroup keycaps, data-slot="kbd" for input-group and command recognition
 * [POS]: The keyword layer of components/ui; Desktop command boards share tips for future tooltip, with font sources judged by consumer-side shortcut tables
 */

import * as React from "react"

import { cn } from "@ai-chat/ui/lib/utils"

/* ── 键帽底色是「按宿主表面」而非「按调用点」决定的 ────────────────
 * 默认 `bg-muted` 在普通表面上成立，但它同时是 CommandItem 的选中态
 * （`data-selected:bg-muted`）——同一个值,键帽会在被选中的那一行整枚消失。
 * tooltip 早就因为同样的理由在这里挂了 in-data-[slot=tooltip-content] 变体;
 * command-item 依样补齐,底色取 `bg-muted-foreground/10`,与
 * input-group.tsx 给 data-slot=kbd 定的那档一致。
 *
 * 写在原语里而不是让调用点各自记得覆盖:调用点不可能预判自己将来会被
 * 塞进哪张表面,而「忘了覆盖」的症状是键帽静默消失——不报错,不掉测试。
 * ────────────────────────────────────────────────────────────────── */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-xs bg-muted px-1 font-sans text-[0.625rem] font-medium text-muted-foreground select-none in-data-[slot=command-item]:bg-muted-foreground/10 in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
