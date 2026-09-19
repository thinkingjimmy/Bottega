/**
 * [INPUT]: Depends on React layout measurement, ChatSessionController, window role, canonical transcript and its hydration skeleton, lib/idle-prefetch, composer, optional side panel, Gallery, and main-window Memory state
 * [OUTPUT]: Provides ChatViewFrame and ChatView with independent wide artifact resizing, Design auto-open, paged deep links, a transcript placeholder that stands in for both the lazy chunk and message hydration on conversations that already have history, and a conversation with nothing to show that holds that slot open rather than mounting the transcript whose chunk is instead prefetched at idle
 * [POS]: The single horizontal chat layout for draft and canonical native/imported sessions
 */

import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  AgentBackendId,
  AgentScope,
} from "../../../shared/agent-ipc";
import { usePanelLayout } from "@ai-chat/chat-ui/side-panel/layout";
import { ChatPageSessionView, type ChatPageRenderer } from "@ai-chat/chat-ui/chat-page";
import { ArtifactHostProvider } from "@ai-chat/chat-ui/artifacts";
import { useDesktopArtifactHost } from "./artifact/host";
import { ChatComposer } from "./composer/chat-composer";
import { ChatEmptyState } from "./chat-empty-state";
import { ChatTranscriptSkeleton } from "./transcript/transcript-skeleton";
import {
  useChatSession,
  type ChatSessionController,
  type ChatProjectMode,
  type SidePanelState,
} from "./runtime/use-chat-session";
import {
  matchesSidePanelRequest,
  type PanelSessionContext,
  type SidePanelRequest,
} from "./runtime/chat-session-model";
import {
  nativePanelWidths,
  SIDE_PANEL_TRANSITION_MS,
} from "@/lib/side-panel-layout";
import {
  conversationImageDraftKey,
  projectConversationImageDraft,
  type ConversationImageProjection,
} from "./side-panel/image/image-projection";
import { prefetchWhenIdle } from "@/lib/idle-prefetch";
import { memoryStore } from "@/lib/memory-store";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useLocation } from "react-router";
import { onAppsEvent } from "@/lib/apps-client";
import { windowContext } from "@/lib/window-surfaces-client";
import type {
  ChatForkViewContext,
  ImportSegmentFacts,
} from "./transcript/chat-transcript";

/* Named loaders, not inline imports: `prefetchWhenIdle` keys its once-guard on
   loader identity, and the warm chunk must be the very one `lazy` asks for. */
const loadSidePanelChunk = () => import("./side-panel/side-panel");
const loadTranscriptChunk = () => import("./transcript/chat-transcript");

const SidePanel = lazy(() =>
  loadSidePanelChunk().then((module) => ({
    default: module.SidePanel,
  }))
);
const ChatTranscript = lazy(() =>
  loadTranscriptChunk().then((module) => ({
    default: module.ChatTranscript,
  }))
);

/* The slot the transcript will occupy, held open while there is nothing to
   draw: without it the composer would sit mid-frame and then drop. */
const TranscriptPlaceholder = () => (
  <div className="min-h-0 flex-1" data-transcript-placeholder />
);

type VisibleSidePanelState = Exclude<SidePanelState, { kind: "none" }>;

type ChatViewProps = {
  renderPage?: ChatPageRenderer;
  header?: React.ReactNode;
  notices?: React.ReactNode;
  scope: AgentScope;
  project: ChatProjectMode;
  emptyTitle?: string;
  emptyDescription?: string;
  focusComposer?: boolean;
  enableSidePanel?: boolean;
  draftAgent?: AgentBackendId;
  panelContext?: PanelSessionContext;
  composerLockedReason?: string;
  composerWrapper?: (composer: React.ReactNode) => React.ReactNode;
  /** 导入段成色；缺席即这条会话没有历史前传。 */
  importSegment?: ImportSegmentFacts;
  /* Only a conversation that already has messages is worth waiting for: a fresh
     draft would flash a skeleton and then answer with the empty state, which is
     the exact lie the skeleton exists to prevent. */
  existingChat?: boolean;
  sidePanelRequest?: SidePanelRequest | null;
  onConsumeSidePanelRequest?: (nonce: number) => void;
  surfaceVisible?: boolean;
  managedWorktree?: boolean;
  forkContext?: ChatForkViewContext;
};

export function ChatView({
  scope,
  project,
  panelContext,
  draftAgent,
  ...frameProps
}: ChatViewProps) {
  const controller = useChatSession({ scope, project, draftAgent, panelContext });
  return (
    <ChatViewFrame
      {...frameProps}
      controller={controller}
      includeGlobalMemory={windowContext().role === "main"}
    />
  );
}

export type ChatViewFrameProps = Omit<
  ChatViewProps,
  "scope" | "project" | "draftAgent" | "panelContext"
> & {
  controller: ChatSessionController;
  includeGlobalMemory?: boolean;
};

export function ChatViewFrame({
  controller,
  renderPage,
  header,
  notices,
  emptyTitle,
  emptyDescription,
  existingChat = false,
  focusComposer = false,
  enableSidePanel = true,
  composerLockedReason,
  composerWrapper = (composer) => composer,
  importSegment,
  managedWorktree,
  forkContext,
  sidePanelRequest,
  onConsumeSidePanelRequest,
  surfaceVisible = true,
  includeGlobalMemory = true,
}: ChatViewFrameProps) {
  const location = useLocation();
  const { t } = useAppTranslation();
  const memory = useSyncExternalStore(
    memoryStore.subscribe,
    memoryStore.getSnapshot,
    memoryStore.getSnapshot
  );
  const panel = controller.sidePanel.state;
  const wideKey = enableSidePanel && panel.kind === "artifact-preview" && panel.fence.mode === "wide"
    ? `${controller.transcript.chatId}:${controller.transcript.incarnationId}:${panel.fence.id}` : null;
  const { containerRef: layoutRootRef, geometry: panelGeometry, widthChange: commitPanelWidth } = usePanelLayout(nativePanelWidths, wideKey);
  const artifactHost = useDesktopArtifactHost(controller, layoutRootRef, enableSidePanel);
  const conversationId = controller.transcript.chatId;
  const panelContext = controller.sidePanel.context;
  const openTabs = controller.sidePanel.openTabs;

  useEffect(() => {
    if (includeGlobalMemory) memoryStore.ensureLoaded();
  }, [includeGlobalMemory]);
  useEffect(() => {
    /* Startup does not need these chunks — a draft has nothing to render and no
       panel is open — but the first reply and the first panel do. Fetch them
       once the main thread is idle so neither wait is paid in front of the user. */
    const cancels = [prefetchWhenIdle(loadTranscriptChunk)];
    if (enableSidePanel) cancels.push(prefetchWhenIdle(loadSidePanelChunk));
    return () => {
      for (const cancel of cancels) cancel();
    };
  }, [enableSidePanel]);

  const openedDesignTurns = useRef(new Set<string>());

  useEffect(() => {
    if (!enableSidePanel || !matchesSidePanelRequest(sidePanelRequest, panelContext)) {
      return;
    }
    openTabs(sidePanelRequest.command);
    onConsumeSidePanelRequest?.(sidePanelRequest.command.nonce);
  }, [
    enableSidePanel,
    panelContext,
    onConsumeSidePanelRequest,
    openTabs,
    sidePanelRequest,
  ]);
  useEffect(() => {
    if (!enableSidePanel) return;
    return onAppsEvent((event) => {
      if (event.type !== "design-canvases-changed") return;
      const productRef =
        panelContext.kind === "product" || panelContext.kind === "adopted"
          ? panelContext.productRef
          : null;
      if (
        event.chatId !== productRef?.chatId ||
        event.conversationIncarnationId !== productRef.incarnationId
      ) return;
      const key = `${event.chatId}\0${event.conversationIncarnationId}\0${event.turnId}`;
      if (openedDesignTurns.current.has(key)) return;
      openedDesignTurns.current.add(key);
      if (openedDesignTurns.current.size > 128) {
        openedDesignTurns.current.delete(openedDesignTurns.current.values().next().value as string);
      }
      openTabs({ target: "app", appId: event.appId });
    });
  }, [enableSidePanel, openTabs, panelContext]);
  const sidePanelState =
    enableSidePanel && controller.sidePanel.state.kind !== "none"
      ? controller.sidePanel.state
      : null;
  const [retainedSidePanelState, setRetainedSidePanelState] =
    useState<VisibleSidePanelState | null>(null);
  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setRetainedSidePanelState(sidePanelState),
      sidePanelState ? 0 : SIDE_PANEL_TRANSITION_MS
    );
    return () => window.clearTimeout(timeoutId);
  }, [sidePanelState]);
  const visibleSidePanelState = sidePanelState ?? retainedSidePanelState;
  const expandedPlanId =
    sidePanelState?.kind === "plan" ? sidePanelState.messageId : null;
  /* 空会话不是「转录的一种状态」，而是另一块屏：它没有滚动、不粘底，
     内容在剩余竖直空间里居中。让两者互斥占位，居中就是布局的结果而不是
     补丁；水合未完时先什么都不判，免得一帧空态在真消息前闪出来。 */
  /* 空态判据落在「可见」消息上:dormant app-chat 只种了一条 app-chat-ready
     notice(ChatNotice 渲染为 null),它让 length===1 却无任何可见内容——既不
     显空态也不显转录,面板会一片空白。some 对空数组返回 false,length===0 一并覆盖。 */
  const hasVisibleContent =
    Boolean(controller.transcript.draft) ||
    controller.transcript.messages.some(
      (message) => message.notice?.kind !== "app-chat-ready"
    );
  const showEmptyState = !controller.transcript.loading && !hasVisibleContent;
  /* A hydrating draft has nothing to draw, yet mounting the transcript would
     still pull its chunk, chat-turn and the whole markdown pipeline onto the
     startup main thread. Wait for something worth rendering; a conversation
     with stored history keeps its skeleton, which is content of a kind. */
  const mountTranscript = existingChat || hasVisibleContent;
  const galleryDraftKey = conversationImageDraftKey(
    controller.transcript.draft
  );
  const galleryDraft = useMemo(
    () => projectConversationImageDraft(galleryDraftKey),
    [galleryDraftKey]
  );
  // memo 保持投影身份稳定：逐 render 重建会让下游 effect/投影计算随每个流式 token 重跑
  const galleryProjection: ConversationImageProjection = useMemo(
    () => ({
      chatId: conversationId,
      canonicalMessages: controller.transcript.messages,
      subagents: controller.sidePanel.subagents,
      draft: galleryDraft,
      assistantSeq: controller.transcript.assistantSeq,
      incarnationId: controller.transcript.incarnationId,
      hydrated: !controller.transcript.loading,
    }),
    [
      conversationId,
      controller.transcript.messages,
      controller.sidePanel.subagents,
      galleryDraft,
      controller.transcript.assistantSeq,
      controller.transcript.incarnationId,
      controller.transcript.loading,
    ]
  );
  return (
    <ArtifactHostProvider value={artifactHost}><ChatPageSessionView renderPage={renderPage} header={header} notices={notices} className={header ? "[--page-shell-header-height:2.5rem]" : undefined} containOverflow={Boolean(header)} containerRef={layoutRootRef} panel={enableSidePanel && visibleSidePanelState && (
        <Suspense fallback={null}>
          <SidePanel crossHeader={!header} open={Boolean(sidePanelState)} state={visibleSidePanelState} width={panelGeometry.width} minWidth={panelGeometry.minWidth} maxWidth={panelGeometry.maxWidth}
            onWidthChange={commitPanelWidth} onClose={controller.sidePanel.close} subagents={controller.sidePanel.subagents} galleryProjection={galleryProjection} />
        </Suspense>
      )} conversation={{ empty: showEmptyState, mounted: mountTranscript,
        emptyView: <ChatEmptyState composer={controller.composer} description={emptyDescription} title={emptyTitle} />,
        fallback: existingChat ? <ChatTranscriptSkeleton /> : <TranscriptPlaceholder />,
        transcript: <ChatTranscript key={`${conversationId}:${controller.transcript.incarnationId ?? "pending"}`}
          controller={controller.transcript} existingChat={existingChat} enableSidePanel={enableSidePanel} expandedPlanId={expandedPlanId}
          importSegment={importSegment} forkContext={forkContext} onClosePlan={controller.sidePanel.close} showOutline={!visibleSidePanelState}
          routeSearch={location.search} surfaceVisible={surfaceVisible} />,
      }} status={
        includeGlobalMemory && memory.status?.enabled && memory.status.paused ? (
          <div
            role="status"
            className="mx-3 mb-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100"
          >
            {t("memory.page.pausedBanner")}
          </div>
        ) : null}
        composer={composerLockedReason ? (
          <div
            role="status"
            className="m-3 min-h-11 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm"
          >
            {composerLockedReason}
          </div>
        ) : composerWrapper(
          <ChatComposer
            controller={controller.composer}
            enableSidePanel={enableSidePanel}
            focusOnReady={focusComposer}
            managedWorktree={managedWorktree}
          />
        )}
    /></ArtifactHostProvider>
  );
}
