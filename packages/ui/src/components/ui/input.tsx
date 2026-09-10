import * as React from "react"

import { cn } from "@ai-chat/ui/lib/utils"

/* ── 两档，因为「chrome」和「你要往里打字的地方」不是一件事 ──────────
 * default（28px / 12px）是密排里的控件：工具条、单元格、设置行里的一格，
 * 它与旁边的按钮、下拉同高，本就该让位给行本身。
 *
 * lg（40px / 15px）是表单字段：弹窗里那个你为它而来的输入框，或设置页里
 * 需要填完再提交的那一格。它必须比 32px 的药丸按钮高——同高就会被读成
 * 又一颗按钮；字号跟正文走 15px——你打进去的字没有理由比你读的字小。
 *
 * 这一档存在之前，调用方各自写死高度，全库出现过 h-8 / h-9 / h-10 / h-11
 * 四个互不知情的数字。
 *
 * size 要 Omit 掉原生的那个（<input size> 是字符宽度，数值型），否则两个
 * 同名属性在类型上直接打架；全库没有调用方用它。
 * ───────────────────────────────────────────────────────────────── */
type InputProps = Omit<React.ComponentProps<"input">, "size"> & {
  size?: "default" | "lg"
}

function Input({ className, size = "default", type, ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      data-size={size}
      className={cn(
        "h-7 w-full min-w-0 rounded-md border border-input bg-input/20 px-2 py-0.5 text-sm transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs/relaxed file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-xs/relaxed dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        size === "lg" && "h-10 px-3 text-[15px] md:text-[15px]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
