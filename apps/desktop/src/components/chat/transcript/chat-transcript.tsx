/**
 * [INPUT]: Depends on Conversation primitives, the bounded Chat message store, backend identity, localized copy, canonical turns, Find, Outline, attachments, revision actions, and side-panel Plan/Image commands
 * [OUTPUT]: Provides the localized canonical transcript with cursor-backed upward pagination, the imported-history divider (only its "match" wording has a producer today), a streaming draft confined to the native segment, scroll compensation, backend-aware failures, generation-fenced anchors, controlled Plan expansion, and Find/Outline
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
  type ReactNode,
} from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  useScrollLockRelease,
  useStickToBottomContext,
} from "@ai-chat/ui/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@ai-chat/ui/components/ai-elements/message";
import { Button } from "@ai-chat/ui/components/ui/button";
import { projectDraftPlan } from "../../../../shared/chat-turn-reducer";
import type {
  AssistantChatMessage,
  NoticeChatMessage,
  UserChatMessage as UserMessage,
} from "../../../../shared/chats-ipc";
import type { ChatSessionController } from "../runtime/use-chat-session";
import type { ConversationImageSource } from "../runtime/chat-session-model";
import type {
  LiveAttachmentPreview,
} from "../runtime/chat-attachments";
import type { ProjectedSubagent } from "@/lib/chat-turn-attach";
import { ChatMessageActions } from "./chat-message-actions";
import { ChatOutline, useCanonicalChatOutline } from "./chat-outline";
import { ChatTurn, ChatTurnDraft } from "./chat-turn";
import {
  ChatUserAttachments,
  UserMessageFold,
} from "./chat-user-attachments";
import { ChatNotice } from "./chat-notice";
import { capMarkdown } from "@/lib/charts/chart-markdown";
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
import { ChevronUp, CircleXIcon, Loader2, Trash2Icon } from "lucide-react";
import { TranscriptFind } from "./transcript-find";
import { highlightTranscriptTarget } from "./transcript-highlight";
import { UserMessageEditor } from "./user-message-editor";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import {
  loadOlderChatMessages,
  materializeChatMessage,
  readChatMessages,
} from "@/lib/chat-messages-store";

/* 分隔行：一条细线把话题从中间断开，中间那格由调用者决定说什么——
   「以上是导入的历史消息」，或者一枚「显示更早消息」。同一种语言，
   于是这两处永远不会长成两副样子。 */
function TranscriptDividerRow({ children, role }: {
  children: ReactNode;
  role?: "separator";
}) {
  return (
    <div
      className="flex items-center gap-3 py-2 text-muted-foreground text-xs"
      role={role}
    >
      <span className="h-px flex-1 bg-border" />
      {children}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export type ImportSegmentFacts = Readonly<{
  sourceStatus?: "match" | "changed" | "missing";
  incompleteTail?: boolean;
}>;

const MessageShell = ({ children, id }: {
  children: ReactNode;
  id: string;
}) => (
  <div
    className="w-full min-w-0 max-w-full"
    data-message-id={id}
    tabIndex={-1}
  >
    {children}
  </div>
);

function UserMessageBody({ content }: { content: string }) {
  return (
    <MessageContent className="gap-1">
      <UserMessageFold measurementKey={content}>
        <MessageResponse>{capMarkdown(content)}</MessageResponse>
      </UserMessageFold>
    </MessageContent>
  );
}

const ChatUserMessage = memo(function ChatUserMessage({
  message,
  live,
  chatId,
  incarnationId,
  onOpenImage,
  onEdit,
  editDisabledReason,
}: {
  message: UserMessage;
  live?: LiveAttachmentPreview[];
  chatId: string;
  incarnationId: string | null;
  onOpenImage?: (source: ConversationImageSource) => void;
  onEdit?: () => void;
  editDisabledReason?: string;
}) {
  return (
    <MessageShell id={message.id}>
      <Message from="user">
        <ChatUserAttachments
          attachments={message.attachments}
          live={live}
          onOpen={
            incarnationId && onOpenImage
              ? (attachment) =>
                  onOpenImage({
                    kind: "attachment",
                    chatId,
                    incarnationId,
                    attachment,
                  })
              : undefined
          }
        />
        <UserMessageBody content={message.content} />
        <ChatMessageActions
          content={message.content}
          createdAt={message.createdAt}
          onEdit={onEdit}
          editDisabledReason={editDisabledReason}
          role="user"
        />
      </Message>
    </MessageShell>
  );
});

const ChatNoticeRow = memo(function ChatNoticeRow({
  message,
}: {
  message: NoticeChatMessage;
}) {
  if (message.notice.kind === "app-chat-ready") return null;
  return (
    <MessageShell id={message.id}>
      <ChatNotice message={message} />
    </MessageShell>
  );
});

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
    if (!id) {
      pendingRouteRef.current = null;
      return;
    }
    pendingRouteRef.current = { key: routeKey, id };
    if (jumpTo(id)) {
      consumedRouteKeyRef.current = routeKey;
      pendingRouteRef.current = null;
    }
  }, [jumpTo, routeSearch]);

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
            canRevise && message.id === lastUserId
              ? () => setEditingMessageId(message.id)
              : undefined
          }
          editDisabledReason={
            message.id === lastUserId && revisionUnavailableReason
              ? t(`chatRevision.unavailable.${revisionUnavailableReason}`)
              : undefined
          }
          onOpenImage={enableSidePanel ? openImage : undefined}
        />
      );
    }
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
        showContinue={canContinue && message.id === messages.at(-1)?.id}
        subagents={subagentsByMessage.get(message.id) ?? EMPTY_SUBAGENTS}
      />
    );
    return <div className="contents" key={message.id}>{row}</div>;
  };
  const renderRows = (rows: typeof messages) =>
    rows.map((message) =>
      message.id === lastImportedId ? (
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
      ) : renderMessage(message)
    );

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

/* 失败不是一条助手消息：它是一张卡片，跟 UsageLimitCard 用同一套语言。
   整块染红只会把注意力烧在背景上，图标与标题才是真正要读的那两行。 */
function FailureCard({
  action,
  body,
  icon,
  onAct,
  title,
}: {
  action: string;
  body: string;
  icon?: ReactNode;
  onAct(): void;
  title: string;
}) {
  return (
    <div
      className="w-full min-w-0 rounded-xl border bg-muted/40 p-4"
      role="alert"
    >
      <div className="flex items-center gap-2">
        <CircleXIcon className="size-4 shrink-0 text-destructive" />
        <span className="font-medium text-base">{title}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground text-sm">
        {body}
      </p>
      <div className="mt-4 flex justify-end">
        <Button onClick={onAct} size="sm" type="button" variant="outline">
          {icon}
          {action}
        </Button>
      </div>
    </div>
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
