/**
 * [INPUT]: Depends on React's useEffect/useRef
 * [OUTPUT]: Provides useScrollActivity, returns the ref to the container, pointers inside or just roll out, and sets the data-scroll-active, standby and remove the data
 * [POS]: The core of the rolling activity of hooks/; The scrollbar-slim, paired with globals.css, is the only switch that makes the scrollbar appear hidden
 */

import { useEffect, useRef } from "react";

/**
 * 自绘滚动条要「指到或滚动时才现身」，看起来 `:hover` 能包掉一半——实测不能。
 * Chromium 的 `::-webkit-scrollbar-*` 样式不随宿主伪类状态变化重绘：宿主
 * `matches(":hover")` 已为真，滚动条那一帧却纹丝不动；而属性变更会触发重算。
 * 于是「指针在不在上面」也只能由 JS 转成属性，与「正在滚没」走同一条路。
 * 两条机制里有一条实测不可靠时，正解是让它消失，而不是并联着赌哪条先生效。
 *
 * 摘位靠 debounce 而非 scrollend——后者在惯性滚动里迟迟不来，滚动条会赖着不走。
 * 指针在内时不起计时器：人还在看，就不该让它自己淡掉。
 *
 * scroll 不冒泡但会捕获，故一个监听收下整片区域里所有滚动区；属性统一落在
 * 本节点上，配合 `[data-scroll-active] *` 一并点亮嵌套滚动条。粒度粗一档是
 * 故意的——弹窗里同时现两条细线，远好过「小表能滚却看不出来」。
 */
export function useScrollActivity<T extends HTMLElement>(idleMs = 700) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inside = false;

    const show = () => {
      node.dataset.scrollActive = "true";
      clearTimeout(timer);
    };
    const fade = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        delete node.dataset.scrollActive;
      }, idleMs);
    };
    const onScroll = () => {
      show();
      if (!inside) fade();
    };
    const onEnter = () => {
      inside = true;
      show();
    };
    const onLeave = () => {
      inside = false;
      fade();
    };

    node.addEventListener("scroll", onScroll, { capture: true, passive: true });
    node.addEventListener("pointerenter", onEnter);
    node.addEventListener("pointerleave", onLeave);
    return () => {
      clearTimeout(timer);
      node.removeEventListener("scroll", onScroll, { capture: true });
      node.removeEventListener("pointerenter", onEnter);
      node.removeEventListener("pointerleave", onLeave);
    };
  }, [idleMs]);

  return ref;
}
