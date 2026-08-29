/**
 * [INPUT]: Depends on React, radix-ui Tabs, class-variance-authority and cn of ui/utils
 * [OUTPUT]: Provides Tabs, TabsList, TabsTrigger, TabsContent and tabsListVariants
 * [POS]: Single implementation of the UI page layer for desktop/web business view sharing
 */

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@ai-chat/ui/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        /* p-0 不是省几像素：line 变体的下划线要落在紧邻的那道分界线上，
           而下划线锚在页签的下沿。列表一旦留内边距，页签下沿就浮在列表
           下沿之上，锚点随调用方的 padding 漂移——从前那个 -5px 的魔数
           就是在补这段漂移。抽掉内边距，两条下沿重合，锚点才是确定的。 */
        line: "items-stretch gap-1 bg-transparent p-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // cursor-pointer 与 Button 基类同理：一个能点的东西必须先说自己能点。
        // 漏在原语里，调用处就得一个个补，而补漏的地方永远少于该补的地方。
        "relative inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:py-[calc(--spacing(1.25))] hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        // 药丸比列表矮 1px 是 default 变体的内缩；line 变体没有药丸，
        // 高度交给列表的 items-stretch——页签下沿于是永远等于列表下沿。
        "group-data-[variant=default]/tabs-list:h-[calc(100%-1px)]",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        /* 选中态那条 2px 下划线跨在页签下沿上（-bottom-px）：上面 1px 咬进
           页签，下面 1px 正好盖住调用方那道 1px 分界线。它因此读作「这一页
           把下面那条线接管过去了」，而不是一根另起炉灶的悬空短横。
           前提是页签下沿与分界线重合——见上面 line 变体的 p-0 与 items-stretch。 */
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:-bottom-px group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-xs/relaxed outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
