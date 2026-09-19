/**
 * [INPUT]: Depends on React, PanelSessionContext, horizontal resize, PanelTabs, Plan/file/Workspace previews, Gallery projection, and the shared SidePanelShell and localized shell catalog
 * [OUTPUT]: Provides the localized resizable tabs/plan/file side-panel host and forwards the canonical context to every tab consumer
 * [POS]: The visual shell of chat/side-panel; ChatView owns width and visibility
 */

import { ArtifactPreview as ArtifactCard } from "@ai-chat/chat-ui/artifact-renderer";
import { LoaderCircleIcon, XIcon } from "lucide-react";
import { lazy, memo, Suspense, useState } from "react";
import { MessageResponse } from "@ai-chat/ui/components/ai-elements/message";
import { Button } from "@ai-chat/ui/components/ui/button";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { SidePanelShell } from "@ai-chat/ui/components/workspace/side-panel/shell";
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
import type { ConversationImageProjection } from "./image/image-projection";
import { GalleryOverlayProvider } from "@/lib/gallery/overlay";
import { useAppTranslation } from "@/components/providers/i18n-provider";
const PanelTabs = lazy(() =>
  import("./panel-tabs").then((module) => ({
    default: module.PanelTabs,
  }))
);

function BasePanelLoading() {
  const { t } = useAppTranslation();
  return (
    <div
      aria-live="polite"
      className="grid min-h-0 flex-1 place-items-center"
      role="status"
    >
      <span className="sr-only">{t("chat.sidePanel.shell.loadingBase")}</span>
      <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export const SidePanel = memo(function SidePanel({
  state,
  crossHeader = true,
  open,
  width,
  minWidth,
  maxWidth,
  onWidthChange,
  onClose,
  subagents,
  galleryProjection,
}: {
  crossHeader?: boolean;
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
  const { t } = useAppTranslation();
  const [documentScrollRoot, setDocumentScrollRoot] =
    useState<HTMLDivElement | null>(null);
  const documentState =
    state?.kind === "artifact-preview" ||
    state?.kind === "plan" ||
    state?.kind === "file" ||
    state?.kind === "workspace-preview"
      ? state
      : null;
  const title =
    documentState?.kind === "artifact-preview" ? documentState.fence.title : documentState?.kind === "plan"
      ? documentState.title
      : documentState?.filename;
  const plainWorkspaceText =
    documentState?.kind === "workspace-preview" &&
    documentState.status === "text" &&
    !MARKDOWN_PATTERN.test(documentState.filename);
  return (
    <SidePanelShell open={open} width={width} minWidth={minWidth} maxWidth={maxWidth}
      onWidthChange={onWidthChange} onClose={onClose} style={crossHeader ? crossHeaderPanelStyle : undefined}
      resizeLabel={t("chat.sidePanel.shell.resize")} resizeHint={t("chat.sidePanel.shell.resizeHint")}>
        {state?.kind === "tabs" ? (
          <Suspense fallback={<BasePanelLoading />}>
            <GalleryOverlayProvider projection={galleryProjection}>
              <PanelTabs
                /* 会话 + 代际的复合身份：单独的代际位不保证跨会话唯一，
                   丢了会话位就可能不重挂。 */
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
                aria-label={t("chat.sidePanel.shell.closePreview")}
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
              {!documentState ? null : documentState.kind === "artifact-preview" ? <ArtifactCard key={documentState.fence.id} fence={documentState.fence} expanded /> :
              (documentState.kind === "file" && documentState.loading) ||
              (documentState.kind === "workspace-preview" &&
                documentState.status === "loading") ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <LoaderCircleIcon className="size-4 animate-spin" />
                  {t("chat.sidePanel.shell.readingFile")}
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
                  <p>
                    {t("chat.sidePanel.shell.bytes", {
                      count: documentState.size ?? 0,
                    })}
                  </p>
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
    </SidePanelShell>
  );
});
