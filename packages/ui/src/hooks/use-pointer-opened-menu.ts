/**
 * [INPUT]: Depends on the useRef of react and onCloseAutoFocus/Trigger events of Radix DropdownMenu
 * [OUTPUT]: Provides use of PointerOpenedMenu, return triggerProps and onCloseAutoFocus
 * [POS]: The focus of hooks is the location of the arbiter, shared by the hover floating-level menu around the sidebar, and the use-mobile is the same as the general UI state
 */

import { useRef } from "react"

/* ── 为何需要它 ────────────────────────────────────────────────────
 * Radix 关闭菜单时把 focus 交还给触发器。触发器若是 hover 才显形的浮层按钮，
 * 这一还就把整行钉住了：指针早已移出侧栏，行却仍亮着、按钮仍浮着。
 *
 * 直觉的解法是把显现通道从 :focus-within 换成 :focus-visible，让「点过」不算数。
 * 但这条路是死的——Chromium 的规则是：程序化 focus 时，若前一个持有 focus 的元素
 * 处于 focus-visible，新元素继承之。Radix 先程序化聚焦菜单内容、再程序化交还触发器,
 * 继承链一路把 focus-visible 抬到触发器上。于是无论读 focus-within 还是 focus-visible
 * 都恒为真——选择器换不出真相，因为病根不在「怎么读 focus」，
 * 而在「指针操作结束后 focus 被停在了一颗隐形按钮上」。
 *
 * 所以修因不修果：指针开的菜单，关闭时不交还 focus，让它落回 body。
 * 键盘开的菜单必须照常交还，否则键盘用户当场失去落点——这是可达性底线。
 * ────────────────────────────────────────────────────────── */
export function usePointerOpenedMenu() {
  const byPointer = useRef(false)

  return {
    /** 摊到 DropdownMenuTrigger 的子元素上，用于记录本次由谁打开。 */
    triggerProps: {
      onPointerDown: () => {
        byPointer.current = true
      },
      // 键盘打开走 Enter/Space，落在触发器自身；Escape 关闭时落在菜单内容上，不会误翻
      onKeyDown: () => {
        byPointer.current = false
      },
    },
    /** 交给 DropdownMenuContent 的 onCloseAutoFocus。 */
    onCloseAutoFocus: (event: Event) => {
      if (byPointer.current) event.preventDefault()
    },
  }
}
