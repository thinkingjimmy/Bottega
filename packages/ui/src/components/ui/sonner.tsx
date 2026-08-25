"use client"

import * as React from "react"
import { Toaster as Sonner, toast, type ToasterProps } from "sonner"

/* theme 由宿主注入：本项目的暗色由 main 进程解析成布尔推送（renderer
   的媒体查询不动），sonner 的 "system" 档在这里永远是错的。 */
function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

/* toast 与 Toaster 必须同源：sonner 是 dual package（ESM/CJS 各持一份
   模块 state），消费方直连 "sonner" 可能与 Toaster 分属两份实例——
   发布与订阅从此对不上。唯一出口封死这个坑。 */
export { Toaster, toast }
