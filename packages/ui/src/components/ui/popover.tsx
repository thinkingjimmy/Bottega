import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@ai-chat/ui/lib/utils"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          // 浮层三兄弟同一条命：内容比空间高时，多出来的部分必须能滚到，
          // 不能靠视口去裁。dropdown/select 早已把 available-height 绑进自己的
          // 盒子，唯独 popover 不设上限也不给 overflow——于是它一旦长过视口，
          // 底部控件就永久失联（不是被挡住，是压根到不了）。补齐这一条，
          // 调用方要自绘滚动条时照常用 overflow-hidden + 内层 SlimScroller 接管。
          "z-50 max-h-(--radix-popover-content-available-height) [-webkit-app-region:no-drag] overflow-x-hidden overflow-y-auto rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverContent, PopoverTrigger }
