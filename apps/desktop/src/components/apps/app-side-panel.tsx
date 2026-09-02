"use client";

/**
 * [INPUT]: Depends on use HorizontalResize, PageShell crossHeaderPanelStyle/panelChromeClassName, Button and cn
 * [OUTPUT]: Provides AppSidePanel; a 44px resize rail on the leading edge, a 40px header, an optional second header band (rail) that takes over the divider, and zero width when closed
 * [POS]: The third-party apps are the only form source shared by the Use/Settings tab; The shutdown mode leaves zero width aside, and content is not posted
 */

import { type ReactNode, useState } from "react";
import { XIcon } from "lucide-react";
import { useHorizontalResize } from "@ai-chat/ui/hooks/use-horizontal-resize";
import { Button } from "@ai-chat/ui/components/ui/button";
import { cn } from "@ai-chat/ui/lib/utils";
import {
  crossHeaderPanelStyle,
  panelChromeClassName,
} from "@/components/page-shell";

const MIN_WIDTH = 360;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 448;

export function AppSidePanel({
  open,
  onClose,
  railLabel,
  railHint,
  closeLabel,
  header,
  rail,
  children,
}: {
  open: boolean;
  onClose: () => void;
  railLabel: string; // resize rail 的可访问名，如「调整设置栏宽度」
  railHint?: string; // rail 的 hover 提示；rail 本身不可见，键盘可缩放只能靠它露面
  closeLabel: string; // 关闭按钮的可访问名，如「收起设置栏」
  header?: ReactNode; // 40px 头部里关闭按钮之前的内容
  /* 页头块的第二层（页签条那种整幅横带）。与 PageShell 同一条法：
     分界线永远画在页头块的最下沿，谁在最下沿谁画。两条平行线中间夹着
     40px 空白，说的是同一句「页头到此为止」，说两遍就成了噪声。
     不给布尔开关——开关能被单独拨错，插槽不能。 */
  rail?: ReactNode;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const resize = useHorizontalResize({
    enabled: open,
    open,
    setOpen: (next) => {
      if (!next) onClose();
    },
    width,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
    direction: -1,
    onWidthChange: setWidth,
  });

  return (
    <div
      aria-hidden={!open}
      className="relative isolate z-10 shrink-0 overflow-hidden border-l bg-background data-[open=false]:w-0 data-[open=false]:border-transparent"
      data-open={open}
      data-resizing={resize.active ? "true" : undefined}
      inert={!open}
      style={{ ...crossHeaderPanelStyle, width: open ? width : 0 }}
    >
      {(open || resize.active) && (
        <button
          aria-label={railLabel}
          aria-orientation="vertical"
          aria-valuemax={MAX_WIDTH}
          aria-valuemin={MIN_WIDTH}
          aria-valuenow={Math.round(width)}
          className="absolute inset-y-0 left-0 z-50 w-11 -translate-x-1/2 touch-none cursor-col-resize"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const step = event.shiftKey ? 40 : 8;
            const direction = event.key === "ArrowLeft" ? 1 : -1;
            setWidth((current) =>
              Math.min(
                MAX_WIDTH,
                Math.max(MIN_WIDTH, current + step * direction)
              )
            );
          }}
          onLostPointerCapture={resize.finish}
          onPointerCancel={resize.finish}
          onPointerDown={resize.start}
          onPointerMove={resize.move}
          onPointerUp={resize.finish}
          role="separator"
          tabIndex={0}
          title={railHint ?? railLabel}
          type="button"
        />
      )}
      {open && (
        /* 宽度写死在内层：外层正在被拖动，内容若跟着 flex 收缩会在拖拽全程重排。 */
        <div className="flex h-full flex-col" style={{ width }}>
          {/* 头部压成单行 40px，下边框与页头共用同一条基线——跨过页头之后，
              平级感就只剩这条基线在维系。

              px-4 与 PageShell 同值，理由也是同一个：这条头部是页头的平级
              邻居，不是它的房客，两者的图标钮就该停在同一个内缩上。从前写
              px-2，右端图标离窗沿 16 而页头动作离 24——面板顶替掉页头右侧
              动作的那一刻，这级台阶就露了出来。 */}
          <header
            className={cn(
              "flex h-[var(--page-shell-header-height)] shrink-0 items-center gap-1 px-4 [-webkit-app-region:drag]",
              !rail && "border-b"
            )}
          >
            {header}
            <Button
              aria-label={closeLabel}
              className={cn("[-webkit-app-region:no-drag]", panelChromeClassName)}
              onClick={onClose}
              size="icon-lg"
              type="button"
              variant="ghost"
            >
              <XIcon />
            </Button>
          </header>
          {/* 线由这一层画，与 PageShell 逐字相同：调用方只递页签条本身，
              递不进来一条画错位置的分界线。 */}
          {rail && <div className="shrink-0 border-b">{rail}</div>}
          <div className="min-h-0 flex-1">{children}</div>
        </div>
      )}
    </div>
  );
}
