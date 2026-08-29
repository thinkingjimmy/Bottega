/**
 * [INPUT]: Depends on React, PanelSessionContext, horizontal resize, PanelTabs, Plan/file/Workspace previews, and Gallery projection
 * [OUTPUT]: Provides the resizable tabs/plan/file side-panel host and forwards the canonical context to every tab consumer
 * [POS]: The visual shell of chat/side-panel; ChatView owns width and visibility
 */

import { LoaderCircleIcon, XIcon } from "lucide-react";
import { lazy, memo, Suspense, useState } from "react";
import { MessageResponse } from "@ai-chat/ui/components/ai-elements/message";
import { Button } from "@ai-chat/ui/components/ui/button";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { useHorizontalResize } from "@ai-chat/ui/hooks/use-horizontal-resize";
import { cn } from "@ai-chat/ui/lib/utils";
import {
  crossHeaderPanelStyle,
  panelChromeClassName,
} from "@/components/page-shell";
import type { ProjectedSubagent } from "@/lib/chat-turn-attach";
import type { SidePanelState } from "../runtime/use-chat-session";
import {
  MARKDOWN_PATTERN,
  panelConversationKey,
  panelGenerationKey,
  workspacePreviewMetadataMessage,
} from "../runtime/chat-session-model";
import { capMarkdown } from "@/lib/charts/chart-markdown";
import { ChartScrollRootProvider } from "@/components/charts/chart-scroll-root";
import { SIDE_PANEL_TRANSITION_MS } from "@/lib/side-panel-layout";
import type { ConversationImageProjection } from "./image/image-projection";
import { GalleryOverlayProvider } from "@/lib/gallery/overlay";
const PanelTabs = lazy(() =>
  import("./panel-tabs").then((module) => ({
    default: module.PanelTabs,
  }))
);

function BasePanelLoading() {
  return (
    <div
      aria-live="polite"
      className="grid min-h-0 flex-1 place-items-center"
      role="status"
    >
      <span className="sr-only">Loading Base</span>
      <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export const SidePanel = memo(function SidePanel({
  state,
  open,
  width,
  minWidth,
  maxWidth,
  onWidthChange,
  onClose,
  subagents,
  galleryProjection,
}: {
  state: Exclude<SidePanelState, { kind: "none" }> | null;
  open: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  subagents: Record<string, ProjectedSubagent>;
  galleryProjection: ConversationImageProjection;
}) {
  const [documentScrollRoot, setDocumentScrollRoot] =
    useState<HTMLDivElement | null>(null);
  const documentState =
    state?.kind === "plan" ||
    state?.kind === "file" ||
    state?.kind === "workspace-preview"
      ? state
      : null;
  const title =
    documentState?.kind === "plan"
      ? documentState.title
      : documentState?.filename;
  const plainWorkspaceText =
    documentState?.kind === "workspace-preview" &&
    documentState.status === "text" &&
    !MARKDOWN_PATTERN.test(documentState.filename);
  const resize = useHorizontalResize({
    enabled: open && maxWidth > 0,
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
      className="relative z-10 isolate w-0 shrink-0 transition-[width] ease-linear motion-reduce:transition-none data-[resizing=true]:transition-none data-[state=open]:w-[var(--chat-side-panel-width)]"
      data-resizing={resize.active ? "true" : undefined}
      data-state={open ? "open" : "closed"}
      style={{
        ...crossHeaderPanelStyle,
        "--chat-side-panel-transition": `${SIDE_PANEL_TRANSITION_MS}ms`,
        "--chat-side-panel-width": `${width}px`,
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
        {state?.kind === "tabs" ? (
          <Suspense fallback={<BasePanelLoading />}>
            <GalleryOverlayProvider projection={galleryProjection}>
              <PanelTabs
                /* 会话 + 代际的复合身份：单独的代际位（如 foreign 的
                   historyRevision）不保证跨会话唯一，丢了会话位就可能不重挂。 */
                key={`${panelConversationKey(state.context)}\u0000${panelGenerationKey(state.context)}`}
                context={state.context}
                command={state.command}
                onClose={onClose}
                subagents={subagents}
                galleryProjection={galleryProjection}
              />
            </GalleryOverlayProvider>
          </Suspense>
        ) : (
          <>
            <header className="flex h-[var(--page-shell-header-height)] shrink-0 items-center gap-3 border-b px-4 [-webkit-app-region:drag]">
              <h2 className="min-w-0 flex-1 truncate font-medium text-sm">
                {title}
              </h2>
              <Button
                aria-label="关闭预览"
                className={cn(
                  "cursor-pointer [-webkit-app-region:no-drag]",
                  panelChromeClassName
                )}
                onClick={onClose}
                size="icon-lg"
                type="button"
                variant="ghost"
              >
                <XIcon />
              </Button>
            </header>
            {/* 正文基准归容器，不归分支：加载/报错/文档三态同处一栏，字号本就
                该是这一栏的属性。此前只有前两态各自写了 text-sm，文档态漏写，
                于是同一段 Markdown 在聊天流是 14px、在这里回落根字号 16px，
                标题梯级同时服务两个基准——必然对一处错一处。 */}
            <SlimScroller
              className="min-h-0 flex-1 overflow-y-auto px-6 py-5 text-sm"
              ref={setDocumentScrollRoot}
            >
              {!documentState ? null :
              (documentState.kind === "file" && documentState.loading) ||
              (documentState.kind === "workspace-preview" &&
                documentState.status === "loading") ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <LoaderCircleIcon className="size-4 animate-spin" />
                  正在读取文件…
                </div>
              ) : (documentState.kind === "file" && documentState.error) ||
                (documentState.kind === "workspace-preview" &&
                  documentState.status === "error") ? (
                <p className="text-destructive">
                  {documentState.error}
                </p>
              ) : documentState.kind === "workspace-preview" &&
                documentState.status === "metadata" ? (
                <div className="space-y-2 text-muted-foreground">
                  <p>
                    {workspacePreviewMetadataMessage(documentState.reason)}
                  </p>
                  <p>{documentState.size ?? 0} bytes</p>
                  {documentState.mtimeMs ? (
                    <p>{new Date(documentState.mtimeMs).toLocaleString()}</p>
                  ) : null}
                </div>
              ) : plainWorkspaceText ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                  <code>{documentState.content ?? ""}</code>
                </pre>
              ) : (
                <ChartScrollRootProvider value={documentScrollRoot}>
                  <MessageResponse
                    isAnimating={
                      documentState.kind === "plan" &&
                      documentState.title === "Editing"
                    }
                  >
                    {capMarkdown(documentState.content ?? "")}
                  </MessageResponse>
                </ChartScrollRootProvider>
              )}
            </SlimScroller>
          </>
        )}
      </aside>
      {(open || resize.active) && (
        <button
          aria-label="调整第三栏宽度"
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
          title="拖动或使用方向键调整第三栏宽度"
          type="button"
        />
      )}
    </div>
  );
});
