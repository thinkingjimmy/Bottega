/**
 * [INPUT]: Depends on React/ResizeObserver, router location, runtime controller, unchanging AdoptionPrefix, upper surface visibility, Memory state, Gallery transcript, projection, third layout, empty-state/composer and inert transcript/SidePanel
 * [OUTPUT]: Provides ChatView, a combination of external source previews, product history and query life positioning, download visibility, message-loaded transcripts and scalable third-party on-demand uploads, continuously showing the global Memory pause boundaries, and transmitting canonical+draft Gallery narrow projections to Base
 * [POS]: The chat module is a true source of the horizontal layout; The empty session and the transcript intersect the same vertical slot, with the duration preference separated from the dynamic available width, and the AppEditPanel remains openly closed for the third time
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
} from "react";
import type {
  AgentBackendId,
  AgentScope,
} from "../../../shared/agent-ipc";
import type { HistoryAdoptionPrefix } from "../../../shared/history-import-ipc";
import { ChatComposer } from "./composer/chat-composer";
import { ChatEmptyState } from "./chat-empty-state";
import {
  useChatSession,
  type ChatProjectMode,
  type SidePanelState,
} from "./runtime/use-chat-session";
import {
  matchesSidePanelRequest,
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
  composerLockedReason?: string;
  sidePanelRequest?: SidePanelRequest | null;
  onConsumeSidePanelRequest?: (nonce: number) => void;
  historyPrefix?: HistoryAdoptionPrefix | null;
  surfaceVisible?: boolean;
};

export function ChatView({
  scope,
  project,
  emptyTitle,
  emptyDescription,
  focusComposer = false,
  enableSidePanel = true,
  draftAgent,
  composerLockedReason,
  sidePanelRequest,
  onConsumeSidePanelRequest,
  historyPrefix,
  surfaceVisible = true,
}: ChatViewProps) {
  const location = useLocation();
  const { t } = useAppTranslation();
  const controller = useChatSession({ scope, project, draftAgent });
  const memory = useSyncExternalStore(
    memoryStore.subscribe,
    memoryStore.getSnapshot,
    memoryStore.getSnapshot
  );
  const layoutRootRef = useRef<HTMLDivElement>(null);
  const [layoutWidth, setLayoutWidth] = useState(() => window.innerWidth);
  const [sidePanelLayout, setSidePanelLayout] = useState(readSidePanelLayout);
  const sidePanelLayoutRef = useRef(sidePanelLayout);
  const conversationId = scope.conversationId;
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
  useEffect(() => memoryStore.ensureLoaded(), []);

  const commitPanelWidth = useCallback((width: number) => {
    if (width < SIDE_PANEL_MIN_WIDTH) return;
    const next = commitSidePanelLayout(sidePanelLayoutRef.current, { width });
    sidePanelLayoutRef.current = next;
    setSidePanelLayout(next);
  }, []);

  useEffect(() => {
    if (!enableSidePanel || !matchesSidePanelRequest(sidePanelRequest, conversationId)) {
      return;
    }
    openTabs(conversationId, sidePanelRequest.command);
    onConsumeSidePanelRequest?.(sidePanelRequest.command.nonce);
  }, [
    enableSidePanel,
    conversationId,
    onConsumeSidePanelRequest,
    openTabs,
    sidePanelRequest,
  ]);
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
  const panelGeometry = resolveSidePanelGeometry(
    layoutWidth,
    sidePanelLayout.width
  );
  /* 空会话不是「转录的一种状态」，而是另一块屏：它没有滚动、不粘底，
     内容在剩余竖直空间里居中。让两者互斥占位，居中就是布局的结果而不是
     补丁；水合未完时先什么都不判，免得一帧空态在真消息前闪出来。 */
  const showEmptyState =
    !controller.transcript.loading &&
    !controller.transcript.draft &&
    controller.transcript.messages.length === 0;
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
              memoryEnabled={Boolean(memory.status?.enabled)}
              routeSearch={location.search}
              surfaceVisible={surfaceVisible}
            />
          </Suspense>
        )}
        {memory.status?.enabled && memory.status.paused ? (
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
