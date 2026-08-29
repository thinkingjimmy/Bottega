/**
 * [INPUT]: Depends on React layout measurement, ChatSessionController, window role, HistoryPrefixProjection, transcript, composer, optional side panel, Gallery, and main-window Memory state
 * [OUTPUT]: Provides ChatViewFrame and ChatView with once-per-turn Design auto-open, abortable history Find, paged deep links, and App-window suppression of global Memory IPC
 * [POS]: The single horizontal chat layout for draft, product, foreign, and adopted sessions
 */

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  AgentBackendId,
  AgentScope,
} from "../../../shared/agent-ipc";
import type { HistoryPrefixProjection } from "@/lib/history-prefix";
import { ChatComposer } from "./composer/chat-composer";
import { ChatEmptyState } from "./chat-empty-state";
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
  CHAT_MAIN_COLUMN_MIN_WIDTH,
  commitSidePanelLayout,
  readSidePanelLayout,
  resolveSidePanelGeometry,
  SIDE_PANEL_MIN_WIDTH,
  SIDE_PANEL_TRANSITION_MS,
} from "@/lib/side-panel-layout";
import {
  conversationImageDraftKey,
  projectConversationImageDraft,
  type ConversationImageProjection,
} from "./side-panel/image/image-projection";
import { memoryStore } from "@/lib/memory-store";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useLocation } from "react-router";
import { onAppsEvent } from "@/lib/apps-client";
import { windowContext } from "@/lib/window-surfaces-client";

const SidePanel = lazy(() =>
  import("./side-panel/side-panel").then((module) => ({
    default: module.SidePanel,
  }))
);
const ChatTranscript = lazy(() =>
  import("./transcript/chat-transcript").then((module) => ({
    default: module.ChatTranscript,
  }))
);

type VisibleSidePanelState = Exclude<SidePanelState, { kind: "none" }>;

type ChatViewProps = {
  scope: AgentScope;
  project: ChatProjectMode;
  emptyTitle?: string;
  emptyDescription?: string;
  focusComposer?: boolean;
  enableSidePanel?: boolean;
  draftAgent?: AgentBackendId;
  panelContext?: PanelSessionContext;
  composerLockedReason?: string;
  sidePanelRequest?: SidePanelRequest | null;
  onConsumeSidePanelRequest?: (nonce: number) => void;
  historyPrefix?: HistoryPrefixProjection | null;
  historyPrefixFooter?: ReactNode;
  historyIndexLoader?: (signal: AbortSignal) => Promise<HistoryPrefixProjection>;
  onHistoryJumpMiss?: (id: string) => Promise<void>;
  surfaceVisible?: boolean;
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
  emptyTitle,
  emptyDescription,
  focusComposer = false,
  enableSidePanel = true,
  composerLockedReason,
  sidePanelRequest,
  onConsumeSidePanelRequest,
  historyPrefix,
  historyPrefixFooter,
  historyIndexLoader,
  onHistoryJumpMiss,
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
  const layoutRootRef = useRef<HTMLDivElement>(null);
  const [layoutWidth, setLayoutWidth] = useState(() => window.innerWidth);
  const [sidePanelLayout, setSidePanelLayout] = useState(readSidePanelLayout);
  const sidePanelLayoutRef = useRef(sidePanelLayout);
  const conversationId = controller.transcript.chatId;
  const panelContext = controller.sidePanel.context;
  const openTabs = controller.sidePanel.openTabs;

  useLayoutEffect(() => {
    const element = layoutRootRef.current;
    if (!element) return;
    const update = () => setLayoutWidth(element.getBoundingClientRect().width);
    const frame = window.requestAnimationFrame(update);
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => {
        window.cancelAnimationFrame(frame);
        window.removeEventListener("resize", update);
      };
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    if (includeGlobalMemory) memoryStore.ensureLoaded();
  }, [includeGlobalMemory]);

  const commitPanelWidth = useCallback((width: number) => {
    if (width < SIDE_PANEL_MIN_WIDTH) return;
    const next = commitSidePanelLayout(sidePanelLayoutRef.current, { width });
    sidePanelLayoutRef.current = next;
    setSidePanelLayout(next);
  }, []);
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
  const toggleForeignPlan = useCallback(
    (plan: { anchorId: string; content: string }) => {
      if (
        controller.sidePanel.state.kind === "plan" &&
        controller.sidePanel.state.messageId === plan.anchorId
      ) {
        controller.sidePanel.close();
        return;
      }
      controller.sidePanel.openForeignPlan(plan);
    },
    [controller.sidePanel]
  );
  const panelGeometry = resolveSidePanelGeometry(
    layoutWidth,
    sidePanelLayout.width
  );
  /* 空会话不是「转录的一种状态」，而是另一块屏：它没有滚动、不粘底，
     内容在剩余竖直空间里居中。让两者互斥占位，居中就是布局的结果而不是
     补丁；水合未完时先什么都不判，免得一帧空态在真消息前闪出来。 */
  /* 空态判据落在「可见」消息上:dormant app-chat 只种了一条 app-chat-ready
     notice(ChatNotice 渲染为 null),它让 length===1 却无任何可见内容——既不
     显空态也不显转录,面板会一片空白。every 对空数组返回 true,length===0 一并覆盖。 */
  const showEmptyState =
    !controller.transcript.loading &&
    !controller.transcript.draft &&
    controller.transcript.messages.every(
      (message) => message.notice?.kind === "app-chat-ready"
    ) &&
    !historyPrefix;
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
      draft: galleryDraft,
      assistantSeq: controller.transcript.assistantSeq,
      incarnationId: controller.transcript.incarnationId,
      hydrated: !controller.transcript.loading,
    }),
    [
      conversationId,
      controller.transcript.messages,
      galleryDraft,
      controller.transcript.assistantSeq,
      controller.transcript.incarnationId,
      controller.transcript.loading,
    ]
  );
  return (
    <div ref={layoutRootRef} className="flex h-full min-w-0">
      <div
        className="flex min-w-0 flex-1 flex-col"
        data-testid="chat-main-column"
        style={{ minWidth: CHAT_MAIN_COLUMN_MIN_WIDTH }}
      >
        {showEmptyState ? (
          <ChatEmptyState
            composer={controller.composer}
            description={emptyDescription}
            title={emptyTitle}
          />
        ) : (
          <Suspense fallback={null}>
            <ChatTranscript
              key={`${conversationId}:${controller.transcript.incarnationId ?? "pending"}`}
              controller={controller.transcript}
              enableSidePanel={enableSidePanel}
              expandedPlanId={expandedPlanId}
              onClosePlan={controller.sidePanel.close}
              showOutline={!visibleSidePanelState}
              historyPrefix={historyPrefix}
              historyPrefixFooter={historyPrefixFooter}
              historyIndexLoader={historyIndexLoader}
              onHistoryJumpMiss={onHistoryJumpMiss}
              onToggleForeignPlan={toggleForeignPlan}
              routeSearch={location.search}
              surfaceVisible={surfaceVisible}
            />
          </Suspense>
        )}
        {includeGlobalMemory && memory.status?.enabled && memory.status.paused ? (
          <div
            role="status"
            className="mx-3 mb-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100"
          >
            {t("memory.page.pausedBanner")}
          </div>
        ) : null}
        {composerLockedReason ? (
          <div
            role="status"
            className="m-3 min-h-11 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm"
          >
            {composerLockedReason}
          </div>
        ) : (
          <ChatComposer
            controller={controller.composer}
            enableSidePanel={enableSidePanel}
            focusOnReady={focusComposer}
          />
        )}
      </div>
      {enableSidePanel && visibleSidePanelState && (
        <Suspense fallback={null}>
          <SidePanel
            open={Boolean(sidePanelState)}
            state={visibleSidePanelState}
            width={panelGeometry.width}
            minWidth={panelGeometry.minWidth}
            maxWidth={panelGeometry.maxWidth}
            onWidthChange={commitPanelWidth}
            onClose={controller.sidePanel.close}
            subagents={controller.sidePanel.subagents}
            galleryProjection={galleryProjection}
          />
        </Suspense>
      )}
    </div>
  );
}
