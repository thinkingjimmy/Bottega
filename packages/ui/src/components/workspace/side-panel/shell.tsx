/**
 * [INPUT]: React content slots, horizontal resize and host-supplied geometry and labels.
 * [OUTPUT]: SidePanelShell with animated visibility, accessible resize rail and optional full-content takeover.
 * [POS]: Shared desktop/browser side-panel frame; hosts own intent, persistence and contents.
 */
import type { CSSProperties, ReactNode } from "react";
import { useHorizontalResize } from "../../../hooks/use-horizontal-resize";
import { SIDE_PANEL_TRANSITION_MS } from "../../../lib/side-panel-layout";
import { cn } from "../../../lib/utils";
export function SidePanelShell({ open, width, minWidth, maxWidth, onWidthChange, onClose, resizeLabel, resizeHint, takeover = false, style, className, children }: {
  open: boolean; width: number; minWidth: number; maxWidth: number; onWidthChange(width: number): void; onClose(): void;
  resizeLabel: string; resizeHint: string; takeover?: boolean; style?: CSSProperties; className?: string; children: ReactNode;
}) {
  const resize = useHorizontalResize({
    enabled: open && !takeover && maxWidth > 0,
    open,
    setOpen: (nextOpen) => {
      if (!nextOpen) onClose();
    },
    width,
    minWidth,
    maxWidth,
    direction: -1,
    onWidthChange,
  });
  return (
    <div
      className={cn("relative z-10 isolate w-0 shrink-0 transition-[width] ease-linear motion-reduce:transition-none data-[resizing=true]:transition-none data-[state=open]:w-[var(--chat-side-panel-width)]", takeover && "absolute inset-0 !w-full", className)}
      data-takeover={takeover || undefined}
      data-resizing={resize.active ? "true" : undefined}
      data-state={open ? "open" : "closed"}
      style={{
        ...style,
        "--chat-side-panel-transition": `${SIDE_PANEL_TRANSITION_MS}ms`,
        "--chat-side-panel-width": takeover ? "100%" : `${width}px`,
        transitionDuration: "var(--chat-side-panel-transition)",
      } as React.CSSProperties}
    >
      <aside
        aria-hidden={!open}
        className="pointer-events-none absolute inset-y-0 right-0 z-0 flex w-[var(--chat-side-panel-width)] translate-x-full flex-col border-l bg-background transition-transform ease-linear motion-reduce:transition-none data-[state=open]:pointer-events-auto data-[state=open]:translate-x-0"
        data-testid="chat-side-panel"
        data-state={open ? "open" : "closed"}
        inert={!open}
        style={{ transitionDuration: "var(--chat-side-panel-transition)" }}
      >
        {children}
      </aside>
      {!takeover && (open || resize.active) && (
        <button
          aria-label={resizeLabel}
          aria-orientation="vertical"
          aria-valuemax={Math.round(maxWidth)}
          aria-valuemin={Math.round(minWidth)}
          aria-valuenow={Math.round(width)}
          className="pointer-events-auto absolute inset-y-0 left-0 z-50 w-11 -translate-x-1/2 touch-none cursor-col-resize [-webkit-app-region:no-drag]"
          data-testid="chat-side-panel-resize-rail"
          onLostPointerCapture={resize.finish}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const step = event.shiftKey ? 40 : 8;
            const direction = event.key === "ArrowLeft" ? 1 : -1;
            onWidthChange(
              Math.min(maxWidth, Math.max(minWidth, width + step * direction))
            );
          }}
          onPointerCancel={resize.finish}
          onPointerDown={resize.start}
          onPointerMove={resize.move}
          onPointerUp={resize.finish}
          role="separator"
          tabIndex={0}
          title={resizeHint}
          type="button"
        />
      )}
    </div>
  );
}
