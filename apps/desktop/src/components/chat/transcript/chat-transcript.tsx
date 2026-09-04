/**
 * [INPUT]: Depends on Conversation primitives, bounded Chat reads, backend identity, localized copy, canonical assistant turns, focused fork/static-row/divider siblings, Find, Outline, revision actions, and side-panel Plan/Image commands
 * [OUTPUT]: Provides the localized canonical transcript with cursor-backed upward pagination, imported/native Fork anchors and boundaries, a streaming draft confined to the native segment, scroll compensation, backend-aware failures, generation-fenced anchors, controlled Plan expansion, and Find/Outline
 * [POS]: The top-level chat/transcript projection for native and imported SQLite timeline segments
 */

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  useScrollLockRelease,
  useStickToBottomContext,
} from "@ai-chat/ui/components/ai-elements/conversation";
import { projectDraftPlan } from "../../../../shared/chat-turn-reducer";
import type {
  AssistantChatMessage,
} from "../../../../shared/chats-ipc";
import type { ChatSessionController } from "../runtime/use-chat-session";
import type { ConversationImageSource } from "../runtime/chat-session-model";
import type { ProjectedSubagent } from "@/lib/chat-turn-attach";
import { ChatOutline, useCanonicalChatOutline } from "./chat-outline";
import { ChatTurn, ChatTurnDraft } from "./chat-turn";
import { FailureCard } from "./chat-error-card";
import { ChartConversationBoundary } from "@/components/charts/chart-scroll-root";
import {
  createMessageSubagentCacheStore,
  EMPTY_SUBAGENTS,
  projectSubagentsByMessage,
} from "./subagent-projection";
import {
  expandTranscriptAnchor,
  includeTranscriptTarget,
  initialTranscriptAnchor,
  shouldRestoreTranscriptFocus,
  transcriptWindow,
} from "./transcript-window";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { ChevronUp, Loader2, Trash2Icon } from "lucide-react";
import { TranscriptFind } from "./transcript-find";
import { highlightTranscriptTarget } from "./transcript-highlight";
import { UserMessageEditor } from "./user-message-editor";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import {
  loadOlderChatMessages,
  materializeChatMessage,
  readChatMessages,
} from "@/lib/chat-messages-store";
import { TranscriptDividerRow } from "./transcript-divider";
import {
  ForkChatDialog,
  ForkLineageDivider,
  type ChatForkViewContext,
} from "./chat-fork-controls";
import {
  ChatNoticeRow,
  ChatUserMessage,
  MessageShell,
} from "./transcript-message-rows";

export type { ChatForkViewContext } from "./chat-fork-controls";

/* 分隔行：一条细线把话题从中间断开，中间那格由调用者决定说什么——
   「以上是导入的历史消息」，或者一枚「显示更早消息」。同一种语言，
   于是这两处永远不会长成两副样子。 */
export type ImportSegmentFacts = Readonly<{
  sourceStatus?: "match" | "changed" | "missing";
  incompleteTail?: boolean;
}>;

export const ChatAssistantRow = memo(function ChatAssistantRow({
  message,
  isPlanExpanded,
  backendDisplayName,
  backendId,
  showContinue,
  enableSidePanel,
  onContinue,
  onRetry,
  onOpenPlan,
  onClosePlan,
  onOpenSubagent,
  onOpenImage,
  onFork,
  forkDisabledReason,
  subagents,
  chatId,
  incarnationId,
}: {
  message: AssistantChatMessage;
  isPlanExpanded: boolean;
  backendDisplayName: string;
  backendId?: AgentBackendId;
  showContinue: boolean;
  enableSidePanel: boolean;
  onContinue: () => void;
  onRetry: () => void;
  onOpenPlan: (message: AssistantChatMessage) => void;
  onClosePlan: () => void;
  onOpenSubagent: (agentThreadId: string) => void;
  onOpenImage: (source: ConversationImageSource) => void;
  onFork?: () => void;
  forkDisabledReason?: string;
  subagents: Record<string, ProjectedSubagent>;
  chatId: string;
  incarnationId: string | null;
}) {
  const togglePlan = useCallback(() => {
    if (isPlanExpanded) onClosePlan();
    else onOpenPlan(message);
  }, [isPlanExpanded, message, onClosePlan, onOpenPlan]);
  return (
    <MessageShell id={message.id}>
      <ChatTurn
        chatId={chatId}
        incarnationId={incarnationId}
        backendDisplayName={backendDisplayName}
        backendId={backendId}
        isPlanExpanded={isPlanExpanded}
        message={message}
        showContinue={showContinue}
        onContinue={onContinue}
        onRetry={onRetry}
        onOpenSubagent={enableSidePanel ? onOpenSubagent : undefined}
        onOpenImage={enableSidePanel ? onOpenImage : undefined}
        onFork={onFork}
        forkDisabledReason={forkDisabledReason}
        subagents={subagents}
        onTogglePlan={enableSidePanel ? togglePlan : undefined}
      />
    </MessageShell>
  );
});

function TranscriptRows({
  controller,
  enableSidePanel,
  expandedPlanId,
  onClosePlan,
  showOutline,
  setHistoryBatch,
  importSegment,
  routeSearch,
  forkContext,
  surfaceVisible = true,
}: {
  controller: ChatSessionController["transcript"];
  enableSidePanel: boolean;
  expandedPlanId: string | null;
  onClosePlan: () => void;
  showOutline: boolean;
  setHistoryBatch: (active: boolean) => void;
  importSegment?: ImportSegmentFacts;
  routeSearch?: string;
  forkContext?: ChatForkViewContext;
  surfaceVisible?: boolean;
}) {
  const { t } = useAppTranslation();
  const {
    backendDisplayName,
    backendId,
    messages,
    draft,
    assistantSeq,
    chatId,
    incarnationId,
    livePreviews,
    hasPendingApproval,
    queued,
    canContinue,
    continueTurn,
    retryTurn,
    openPlanPanel,
    openDraftPlanPanel,
    canAbandonFatal,
    abandonFatal,
    canAcknowledgeCleanup,
    acknowledgeCleanup,
    subagents,
    openSubagent,
    openImage,
    canRevise,
    submitRevision,
    revisionUnavailableReason,
  } = controller;
  const { scrollRef } = useStickToBottomContext();
  const releaseScrollLock = useScrollLockRelease();
  const [anchor, setAnchor] = useState(() =>
    initialTranscriptAnchor(messages)
  );
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null);
  const consumedRouteKeyRef = useRef<string | null>(null);
  const pendingRouteRef = useRef<{ key: string; id: string } | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [forkAnchor, setForkAnchor] = useState<AssistantChatMessage | null>(null);
  const [announcement, setAnnouncement] = useState<{
    generation: number;
    count: number;
  } | null>(null);
  const compensation = useRef<{ id: string; top: number } | null>(null);
  const restoreFocusAfterExpand = useRef(false);
  const loadedCount = useRef(0);
  const loadingEarlier = useRef(false);
  const [loadingEarlierNow, setLoadingEarlierNow] = useState(false);
  const outline = useCanonicalChatOutline(chatId, incarnationId, showOutline);
  const windowed = useMemo(
    () => transcriptWindow(messages, anchor),
    [anchor, messages]
  );
  const visibleMessages = windowed.messages;
  const anchorWasClamped =
    anchor !== null && windowed.anchor?.id !== anchor.id;
  const [subagentCache] = useState(createMessageSubagentCacheStore);
  const subagentProjection = useMemo(
    () => projectSubagentsByMessage(
      visibleMessages,
      subagents,
      subagentCache.snapshot()
    ),
    [subagentCache, subagents, visibleMessages]
  );
  const subagentsByMessage = subagentProjection.projections;
  useLayoutEffect(() => {
    if (!anchorWasClamped) return;
    compensation.current = null;
    subagentCache.clear();
    const frame = requestAnimationFrame(() => {
      setAnchor(windowed.anchor);
      setPendingJumpId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [anchorWasClamped, subagentCache, windowed.anchor]);

  useLayoutEffect(() => {
    if (anchorWasClamped) return;
    subagentCache.publish(subagentProjection.cache);
  }, [anchorWasClamped, subagentCache, subagentProjection.cache]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const pendingCompensation = compensation.current;
    if (pendingCompensation) {
      const node = scroller.querySelector(
        `[data-message-id="${CSS.escape(pendingCompensation.id)}"]`
      );
      if (node instanceof HTMLElement) {
        scroller.scrollTop +=
          node.getBoundingClientRect().top - pendingCompensation.top;
      }
      compensation.current = null;
      if (loadedCount.current > 0) {
        setAnnouncement((current) => ({
          generation: (current?.generation ?? 0) + 1,
          count: loadedCount.current,
        }));
      }
    }
    if (restoreFocusAfterExpand.current) {
      const first = scroller.querySelector("[data-message-id]");
      if (first instanceof HTMLElement) first.focus({ preventScroll: true });
      restoreFocusAfterExpand.current = false;
    }
    if (pendingJumpId && !anchorWasClamped) {
      const node = scroller.querySelector(
        `[data-message-id="${CSS.escape(pendingJumpId)}"]`
      );
      if (node instanceof HTMLElement) {
        const top =
          node.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop;
        scroller.scrollTo({ top: Math.max(0, top - 16), behavior: "auto" });
        setPendingJumpId(null);
        highlightTranscriptTarget(node);
        const route = pendingRouteRef.current;
        if (route?.id === pendingJumpId) {
          consumedRouteKeyRef.current = route.key;
          pendingRouteRef.current = null;
        }
      }
    }
    const frame = requestAnimationFrame(() => setHistoryBatch(false));
    return () => cancelAnimationFrame(frame);
  }, [
    anchorWasClamped,
    pendingJumpId,
    scrollRef,
    setHistoryBatch,
    windowed.anchor?.id,
  ]);

  const loadEarlier = useCallback(async () => {
    if (loadingEarlier.current) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (windowed.start <= 0 && !readChatMessages(chatId)?.hasMoreBefore) return;
    loadingEarlier.current = true;
    setLoadingEarlierNow(true);
    releaseScrollLock();
    setHistoryBatch(true);
    const scrollerTop = scroller.getBoundingClientRect().top;
    const firstVisible = [...scroller.querySelectorAll("[data-message-id]")]
      .find(
        (node) =>
          node instanceof HTMLElement &&
          node.getBoundingClientRect().bottom >= scrollerTop
      );
    if (firstVisible instanceof HTMLElement) {
      compensation.current = {
        id: firstVisible.dataset.messageId!,
        top: firstVisible.getBoundingClientRect().top,
      };
    }
    try {
      if (windowed.start > 0) {
        const next = expandTranscriptAnchor(messages, windowed.anchor);
        const nextStart = transcriptWindow(messages, next).start;
        restoreFocusAfterExpand.current = shouldRestoreTranscriptFocus(
          nextStart,
          document.activeElement instanceof HTMLElement &&
            document.activeElement.hasAttribute("data-load-earlier")
        );
        loadedCount.current = windowed.start - nextStart;
        setAnchor(next);
        return;
      }
      const before = messages.length;
      const page = await loadOlderChatMessages(chatId);
      if (!page || page.messages.length <= before) {
        /* 没有新行就没有位移要补：把补偿留在原地，下一次真正的加载会拿它
           去对一个早已换过内容的坐标，滚动条于是跳一下。 */
        compensation.current = null;
        setHistoryBatch(false);
        return;
      }
      loadedCount.current = page.messages.length - before;
      setAnchor((current) => expandTranscriptAnchor(page.messages, current));
    } catch {
      compensation.current = null;
      setHistoryBatch(false);
    } finally {
      loadingEarlier.current = false;
      setLoadingEarlierNow(false);
    }
  }, [
    chatId,
    messages,
    releaseScrollLock,
    scrollRef,
    setHistoryBatch,
    windowed.anchor,
    windowed.start,
  ]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onScroll = () => {
      if (scroller.scrollTop <= 96 && scroller.scrollHeight > scroller.clientHeight) {
        void loadEarlier();
      }
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [loadEarlier, scrollRef]);

  const jumpTo = useCallback((id: string) => {
    const scroller = scrollRef.current;
    if (!scroller) return false;
    releaseScrollLock();
    const node = scroller.querySelector(
      `[data-message-id="${CSS.escape(id)}"]`
    );
    if (node instanceof HTMLElement) {
      const top =
        node.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      scroller.scrollTo({ top: Math.max(0, top - 16), behavior: "smooth" });
      highlightTranscriptTarget(node);
      return true;
    }
    setHistoryBatch(true);
    setPendingJumpId(id);
    setAnchor((current) => includeTranscriptTarget(messages, current, id));
    void materializeChatMessage(chatId, id)
      .then((snapshot) => {
        if (!snapshot) {
          setPendingJumpId(null);
          setHistoryBatch(false);
          return;
        }
        setAnchor((current) =>
          includeTranscriptTarget(snapshot.messages, current, id)
        );
      })
      .catch(() => {
        setPendingJumpId(null);
        setHistoryBatch(false);
      });
    return false;
  }, [chatId, messages, releaseScrollLock, scrollRef, setHistoryBatch]);

  useLayoutEffect(() => {
    const routeKey = routeSearch ?? "";
    if (consumedRouteKeyRef.current === routeKey) return;
    const searchParams = new URLSearchParams(routeSearch ?? "");
    const id = searchParams.get("m");
    if (!id && searchParams.get("fork") === "divider") {
      const divider = scrollRef.current?.querySelector("[data-fork-divider]");
      if (divider instanceof HTMLElement) {
        releaseScrollLock();
        divider.scrollIntoView({ behavior: "smooth", block: "center" });
        divider.focus({ preventScroll: true });
        highlightTranscriptTarget(divider);
        consumedRouteKeyRef.current = routeKey;
      }
      return;
    }
    if (!id) {
      pendingRouteRef.current = null;
      return;
    }
    pendingRouteRef.current = { key: routeKey, id };
    if (jumpTo(id)) {
      consumedRouteKeyRef.current = routeKey;
      pendingRouteRef.current = null;
    }
  }, [jumpTo, releaseScrollLock, routeSearch, scrollRef]);

  const draftPlan = draft ? projectDraftPlan(draft) : null;
  /* 草稿属于原生段：导入段自带一套从 1 起的 delivery_seq，只比 seq
     会把流式草稿插进那段只读前传的中间。 */
  const draftIndex =
    draft && assistantSeq !== undefined
      ? visibleMessages.findIndex(
          (message) => message.segment !== "imported" && message.seq > assistantSeq
        )
      : -1;
  const beforeDraft =
    draftIndex < 0
      ? visibleMessages
      : visibleMessages.slice(0, draftIndex);
  const afterDraft =
    draftIndex < 0 ? [] : visibleMessages.slice(draftIndex);
  const lastUserId = messages.findLast((message) => message.role === "user")?.id;
  /* Fork 资格按 transcript 位置而非 seq 判断：adopted Chat 的 imported/native
     两段 seq 会重叠。索引表随 messages 身份缓存一次，行级查询是 O(1)。 */
  const { firstUserIndex, indexById } = useMemo(() => ({
    firstUserIndex: messages.findIndex((candidate) => candidate.role === "user"),
    indexById: new Map(messages.map((candidate, index) => [candidate.id, index])),
  }), [messages]);
  const forkSourceEligible = Boolean(
    forkContext &&
    forkContext.summary.projectId &&
    forkContext.summary.context?.kind === "ordinary" &&
    (!forkContext.summary.readOnlyReason ||
      forkContext.summary.readOnlyReason === "external-readonly") &&
    forkContext.summary.executionKind !== "managed-worktree"
  );
  /* 导入段的末条：分隔线钉在它下面。原生段还是空的时候也照钉，
     否则一条刚同步进来的历史会话就只剩正文，没有「新消息从这里开始」。 */
  const lastImportedId = messages.findLast(
    (message) => message.segment === "imported"
  )?.id;
  /* "match" 与 "missing" 都由扫描说了算（HistoryImportService 一侧的
     markImportSourceStatus）。"changed" 没有生产者，也不会有：内容一变就是
     新的一代 import 代际，旧代际连同那句判定一起退休。分支留着是因为它是
     这格事实的完整词表，删掉等于把「来源变了」从产品语言里抹去。 */
  const importedDivider = importSegment?.sourceStatus === "missing"
    ? t("history.sourceMissingDivider")
    : importSegment?.sourceStatus === "changed"
      ? t("history.divergedDivider")
      : t("history.importedDivider");
  const renderMessage = (
    message: (typeof messages)[number]
  ) => {
    if (message.role === "notice") {
      return <ChatNoticeRow key={message.id} message={message} />;
    }
    if (message.role === "user") {
      if (editingMessageId === message.id) {
        return (
          <MessageShell id={message.id} key={message.id}>
            <UserMessageEditor
              content={message.content}
              onCancel={() => setEditingMessageId(null)}
              onSubmit={(content) => submitRevision(message.id, content)}
            />
          </MessageShell>
        );
      }
      return (
        <ChatUserMessage
          chatId={chatId}
          incarnationId={incarnationId}
          key={message.id}
          live={livePreviews.get(message.id)}
          message={message}
          onEdit={
            canRevise &&
            message.id === lastUserId &&
            !(forkContext?.summary.inheritedThroughSeq &&
              message.seq <= forkContext.summary.inheritedThroughSeq)
              ? () => setEditingMessageId(message.id)
              : undefined
          }
          editDisabledReason={
            message.id !== lastUserId
              ? undefined
              : forkContext?.summary.inheritedThroughSeq &&
                  message.seq <= forkContext.summary.inheritedThroughSeq
                ? t("chat.fork.inheritedReadOnly")
                : revisionUnavailableReason
                  ? t(`chatRevision.unavailable.${revisionUnavailableReason}`)
                  : undefined
          }
          onOpenImage={enableSidePanel ? openImage : undefined}
        />
      );
    }
    const forkPrefixHasUser =
      firstUserIndex >= 0 && (indexById.get(message.id) ?? -1) >= firstUserIndex;
    const row = (
      <ChatAssistantRow
        chatId={chatId}
        incarnationId={incarnationId}
        enableSidePanel={enableSidePanel}
        isPlanExpanded={expandedPlanId === message.id}
        message={message}
        onClosePlan={onClosePlan}
        backendDisplayName={backendDisplayName}
        backendId={backendId}
        onContinue={continueTurn}
        onRetry={retryTurn}
        onOpenPlan={openPlanPanel}
        onOpenSubagent={openSubagent}
        onOpenImage={openImage}
        onFork={
          forkSourceEligible &&
          !message.isError &&
          Boolean(message.content.trim() || message.parts?.length) &&
          forkPrefixHasUser
            ? () => setForkAnchor(message)
            : undefined
        }
        forkDisabledReason={
          forkSourceEligible &&
          (message.isError ||
            (!message.content.trim() && !message.parts?.length) ||
            !forkPrefixHasUser)
            ? t("chat.fork.unavailable")
            : undefined
        }
        showContinue={canContinue && message.id === messages.at(-1)?.id}
        subagents={subagentsByMessage.get(message.id) ?? EMPTY_SUBAGENTS}
      />
    );
    return <div className="contents" key={message.id}>{row}</div>;
  };
  const renderRow = (message: (typeof messages)[number]) =>
    forkContext?.summary.inheritedThroughSeq === message.seq ? (
      <Fragment key={`${message.id}:fork-boundary`}>
        {renderMessage(message)}
        <ForkLineageDivider context={forkContext} />
      </Fragment>
    ) : message.id === lastImportedId ? (
      <Fragment key={`${message.id}:imported-boundary`}>
        {renderMessage(message)}
        {importSegment?.incompleteTail && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            {t("history.incompleteTail")}
          </p>
        )}
        <TranscriptDividerRow role="separator">
          <span>{importedDivider}</span>
        </TranscriptDividerRow>
      </Fragment>
    ) : renderMessage(message);
  /* 别人的前传是一处地标：读屏得先知道自己站在哪一段里，那条分隔线只有
     看得见的人才读得到。display:contents 让 section 只留语义、不留盒子，
     行与行之间的间距因此仍由 ConversationContent 的栅格说了算。 */
  const renderRows = (rows: typeof messages) => {
    const boundary = rows.findIndex((message) => message.segment !== "imported");
    const imported = boundary < 0 ? rows : rows.slice(0, boundary);
    const native = boundary < 0 ? [] : rows.slice(boundary);
    return (
      <>
        {imported.length > 0 && (
          <section
            aria-label={t("history.importedHistoryLabel")}
            className="contents"
          >
            {imported.map(renderRow)}
          </section>
        )}
        {native.map(renderRow)}
      </>
    );
  };

  return (
    <ChartConversationBoundary>
        <ConversationContent
          className="mx-auto w-full min-w-0 max-w-3xl gap-6"
          data-transcript-content=""
          tabIndex={-1}
        >
          <TranscriptFind
            chatId={chatId}
            jumpTo={jumpTo}
            surfaceVisible={surfaceVisible}
          />
          {(windowed.start > 0 || readChatMessages(chatId)?.hasMoreBefore) && (
            <TranscriptDividerRow>
              <button
                className="inline-flex h-7 items-center gap-1 rounded-full px-3 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60"
                data-load-earlier=""
                disabled={loadingEarlierNow}
                onClick={loadEarlier}
                type="button"
              >
                {loadingEarlierNow ? (
                  <>
                    <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                    {t("chat.transcript.loadingEarlier")}
                  </>
                ) : (
                  <>
                    <ChevronUp className="size-3" />
                    {t("chat.transcript.loadEarlier")}
                  </>
                )}
              </button>
            </TranscriptDividerRow>
          )}
          {renderRows(beforeDraft)}
          {draft && (
            <ChatTurnDraft
              backendDisplayName={backendDisplayName}
              backendId={backendId}
              chatId={chatId}
              incarnationId={incarnationId}
              assistantSeq={assistantSeq}
              draft={draft}
              hasPendingApproval={hasPendingApproval}
              queued={queued}
              isPlanExpanded={expandedPlanId === draftPlan?.itemId}
              onOpenSubagent={enableSidePanel ? openSubagent : undefined}
              onOpenImage={enableSidePanel ? openImage : undefined}
              onTogglePlan={
                enableSidePanel && draftPlan
                  ? expandedPlanId === draftPlan.itemId
                    ? onClosePlan
                    : openDraftPlanPanel
                  : undefined
              }
              subagents={subagents}
            />
          )}
          {renderRows(afterDraft)}
          {forkAnchor && forkContext && (
            <ForkChatDialog
              anchor={forkAnchor}
              context={forkContext}
              onClose={() => setForkAnchor(null)}
            />
          )}
          {canAbandonFatal && (
            <FailureCard
              action={t("chat.transcript.abandonFatal")}
              body={t("chat.transcript.fatalResultLocked")}
              icon={<Trash2Icon className="size-3.5" />}
              onAct={() => void abandonFatal()}
              title={t("chat.transcript.fatalResultTitle")}
            />
          )}
          {canAcknowledgeCleanup && (
            <FailureCard
              action={t("chat.transcript.acknowledgeCleanup")}
              body={t("chat.transcript.cleanupFailed", {
                backend: backendDisplayName,
              })}
              onAct={() => void acknowledgeCleanup()}
              title={t("chat.transcript.cleanupFailedTitle")}
            />
          )}
        </ConversationContent>
        <div aria-live="polite" className="sr-only" role="status">
          {announcement && (
            <span key={announcement.generation}>
              {t("chat.transcript.loadedEarlier", {
                count: announcement.count,
              })}
            </span>
          )}
        </div>
        {showOutline && (
          <ChatOutline
            canonicalItems={outline.items}
            messages={messages}
            onJump={jumpTo}
          />
        )}
        <ConversationScrollButton />
      </ChartConversationBoundary>
  );
}

export const ChatTranscript = memo(function ChatTranscript(props: {
  controller: ChatSessionController["transcript"];
  enableSidePanel: boolean;
  expandedPlanId: string | null;
  onClosePlan: () => void;
  showOutline: boolean;
  importSegment?: ImportSegmentFacts;
  routeSearch?: string;
  forkContext?: ChatForkViewContext;
  surfaceVisible?: boolean;
}) {
  const [historyBatch, setHistoryBatch] = useState(false);
  if (props.controller.loading) return <div className="min-h-0 flex-1" />;
  return (
    <Conversation
      aria-live={historyBatch ? "off" : undefined}
      className="min-h-0 min-w-0 flex-1"
      initial="instant"
      resize="instant"
      role={historyBatch ? undefined : "log"}
    >
      <TranscriptRows {...props} setHistoryBatch={setHistoryBatch} />
    </Conversation>
  );
});
