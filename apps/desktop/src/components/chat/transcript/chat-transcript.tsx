/**
 * [INPUT]: Depends on Conversation/Message, unchanged AdoptionPrefix, visible surface visibility, user-generated folding units, runtime transcript with chat/incarnation/Image intent, side panel and turn/outline/attachment components
 * [OUTPUT]: Provides ChatTranscript with an independent measurement of ChatAssistantRow; External forwarding and canonical/draft products are presented in domain order, the transcript container can be programmed to focus, end-user support non-optimistic pure text revision, and a third Image intent, which is subject to session scope, is constructed for Agent graphics and canonical user attachments
 * [POS]: The top layer of the chat/transcript view; Unified session width and vertical rhythm, outsourced forwarding does not participate in product seq convergence, only holds discarded history windows, rolling compensation and unobstructed batch processing status
 */

import {
  memo,
  useCallback,
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
import type { HistoryAdoptionPrefix } from "../../../../shared/history-import-ipc";
import type { ChatSessionController } from "../runtime/use-chat-session";
import type { ConversationImageSource } from "../runtime/chat-session-model";
import type {
  LiveAttachmentPreview,
} from "../runtime/chat-attachments";
import type { ProjectedSubagent } from "@/lib/chat-turn-attach";
import { ChatMessageActions } from "./chat-message-actions";
import { ChatOutline } from "./chat-outline";
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
import { ForeignHistoryTranscriptRows } from "./foreign-history-transcript";
import { TranscriptFind } from "./transcript-find";
import { highlightTranscriptTarget } from "./transcript-highlight";
import { UserMessageEditor } from "./user-message-editor";

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
}: {
  message: UserMessage;
  live?: LiveAttachmentPreview[];
  chatId: string;
  incarnationId: string | null;
  onOpenImage?: (source: ConversationImageSource) => void;
  onEdit?: () => void;
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
  return (
    <MessageShell id={message.id}>
      <ChatNotice message={message} />
    </MessageShell>
  );
});

function RevisionDisclosure({ memoryEnabled }: { memoryEnabled: boolean }) {
  const { t } = useAppTranslation();
  return (
    <div className="mx-auto w-full rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-muted-foreground text-xs" role="note">
      <p>{t("chatRevision.newSession")}</p>
      {memoryEnabled && <p className="mt-1">{t("chatRevision.memoryWarning")}</p>}
    </div>
  );
}

export const ChatAssistantRow = memo(function ChatAssistantRow({
  message,
  isPlanExpanded,
  backendDisplayName,
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
  historyPrefix,
  memoryEnabled = false,
  routeSearch,
  surfaceVisible = true,
}: {
  controller: ChatSessionController["transcript"];
  enableSidePanel: boolean;
  expandedPlanId: string | null;
  onClosePlan: () => void;
  showOutline: boolean;
  setHistoryBatch: (active: boolean) => void;
  historyPrefix?: HistoryAdoptionPrefix | null;
  memoryEnabled?: boolean;
  routeSearch?: string;
  surfaceVisible?: boolean;
}) {
  const { t } = useAppTranslation();
  const {
    backendDisplayName,
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
    revisionDisclosure,
  } = controller;
  const { scrollRef } = useStickToBottomContext();
  const releaseScrollLock = useScrollLockRelease();
  const [anchor, setAnchor] = useState(() =>
    initialTranscriptAnchor(messages)
  );
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<{
    generation: number;
    count: number;
  } | null>(null);
  const compensation = useRef<{ id: string; top: number } | null>(null);
  const restoreFocusAfterExpand = useRef(false);
  const loadedCount = useRef(0);
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
      }
    }
    const frame = requestAnimationFrame(() => setHistoryBatch(false));
    return () => cancelAnimationFrame(frame);
  }, [
    anchorWasClamped,
    /* 收养前传异步到达后必须重查一次：深链目标若在前传行里，
       首次消费时节点还没挂载。 */
    historyPrefix,
    pendingJumpId,
    scrollRef,
    setHistoryBatch,
    windowed.anchor?.id,
  ]);

  const loadEarlier = useCallback(() => {
    if (windowed.start <= 0) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
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
    const next = expandTranscriptAnchor(messages, windowed.anchor);
    const nextStart = transcriptWindow(messages, next).start;
    restoreFocusAfterExpand.current = shouldRestoreTranscriptFocus(
      nextStart,
      document.activeElement instanceof HTMLElement &&
        document.activeElement.hasAttribute("data-load-earlier")
    );
    loadedCount.current = windowed.start - nextStart;
    setAnchor(next);
  }, [
    messages,
    releaseScrollLock,
    scrollRef,
    setHistoryBatch,
    windowed.anchor,
    windowed.start,
  ]);

  const jumpTo = useCallback((id: string) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
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
      return;
    }
    setHistoryBatch(true);
    setPendingJumpId(id);
    setAnchor((current) => includeTranscriptTarget(messages, current, id));
  }, [messages, releaseScrollLock, scrollRef, setHistoryBatch]);

  useLayoutEffect(() => {
    const searchParams = new URLSearchParams(routeSearch ?? "");
    const id = searchParams.get("m") ?? (() => {
      const value = searchParams.get("b");
      if (!value) return null;
      const split = value.indexOf(":");
      return split < 0 ? null : `foreign-${value.slice(split + 1)}`;
    })();
    if (id) jumpTo(id);
  }, [jumpTo, routeSearch]);

  const draftPlan = draft ? projectDraftPlan(draft) : null;
  const draftIndex =
    draft && assistantSeq !== undefined
      ? visibleMessages.findIndex((message) => message.seq > assistantSeq)
      : -1;
  const beforeDraft =
    draftIndex < 0
      ? visibleMessages
      : visibleMessages.slice(0, draftIndex);
  const afterDraft =
    draftIndex < 0 ? [] : visibleMessages.slice(draftIndex);
  const lastUserId = messages.findLast((message) => message.role === "user")?.id;
  const revisionUser = revisionDisclosure
    ? messages.findLast((message) => message.role === "user")
    : undefined;
  const revisionAssistantId = revisionUser
    ? messages.find(
        (message) =>
          message.role === "assistant" && message.seq > revisionUser.seq
      )?.id
    : undefined;
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
        onContinue={continueTurn}
        onRetry={retryTurn}
        onOpenPlan={openPlanPanel}
        onOpenSubagent={openSubagent}
        onOpenImage={openImage}
        showContinue={canContinue && message.id === messages.at(-1)?.id}
        subagents={subagentsByMessage.get(message.id) ?? EMPTY_SUBAGENTS}
      />
    );
    return message.id === revisionAssistantId ? (
      <div className="contents" key={message.id}>
        <RevisionDisclosure memoryEnabled={memoryEnabled} />
        {row}
      </div>
    ) : (
      <div className="contents" key={message.id}>{row}</div>
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
            historyPrefix={historyPrefix}
            jumpTo={jumpTo}
            messages={messages}
            surfaceVisible={surfaceVisible}
          />
          {windowed.start > 0 && (
            <Button
              className="mx-auto"
              data-load-earlier=""
              onClick={loadEarlier}
              size="sm"
              type="button"
              variant="outline"
            >
              显示更早消息
            </Button>
          )}
          {historyPrefix && (
            <section className="space-y-5" aria-label={t("history.importedHistoryLabel")}>
              <ForeignHistoryTranscriptRows blocks={historyPrefix.blocks} />
              <div className="flex items-center gap-3 py-2 text-muted-foreground text-xs" role="separator">
                <span className="h-px flex-1 bg-border" />
                <span>{historyPrefix.divergence
                  ? t("history.divergedDivider")
                  : t("history.importedDivider")}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            </section>
          )}
          {beforeDraft.map(renderMessage)}
          {draft && revisionDisclosure && !revisionAssistantId && (
            <RevisionDisclosure memoryEnabled={memoryEnabled} />
          )}
          {draft && (
            <ChatTurnDraft
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
          {afterDraft.map(renderMessage)}
          {canAbandonFatal && (
            <Message from="assistant">
              <MessageContent className="border border-destructive/30 bg-destructive/10 text-destructive">
                <p>本轮结果无法安全写入本地账本，输入保持锁定。</p>
                <Button
                  className="mt-3"
                  onClick={() => void abandonFatal()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  放弃本轮结果
                </Button>
              </MessageContent>
            </Message>
          )}
          {canAcknowledgeCleanup && (
            <Message from="assistant">
              <MessageContent className="border border-destructive/30 bg-destructive/10 text-destructive">
                <p>{backendDisplayName} 进程组清理失败。请先确认相关进程已经结束，再解除本聊天的安全锁。</p>
                <Button
                  className="mt-3"
                  onClick={() => void acknowledgeCleanup()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  已确认进程结束
                </Button>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <div aria-live="polite" className="sr-only" role="status">
          {announcement && (
            <span key={announcement.generation}>
              已加载 {announcement.count} 条更早消息
            </span>
          )}
        </div>
        {showOutline && <ChatOutline messages={messages} onJump={jumpTo} />}
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
  historyPrefix?: HistoryAdoptionPrefix | null;
  memoryEnabled?: boolean;
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
