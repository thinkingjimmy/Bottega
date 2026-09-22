/**
 * [INPUT]: Depends on shared conversation column geometry, Conversation primitives, bounded Chat reads, backend identity, localized copy, canonical assistant turns, focused fork/static-row/divider/skeleton siblings, Find, Outline, revision actions, and side-panel Plan/Image commands
 * [OUTPUT]: Provides the localized canonical transcript with paged imported/native segments, immutable-prefix-aware native revisions, Fork boundaries, native streaming, scroll compensation, a reading position the cloud port re-enters on, backend failures, fenced anchors, Plan expansion, and Find/Outline
 * [POS]: The top-level chat/transcript projection for native and imported SQLite timeline segments
 */

import {
  Fragment,
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { TimelineView } from "@ai-chat/chat-ui/timeline/view";
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
import { createMessageSubagentProjector } from "./subagent-projection";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { Trash2Icon } from "lucide-react";
import { TranscriptFind } from "./transcript-find";
import { UserMessageEditor } from "./user-message-editor";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import { localChatReads } from "@/lib/cloud/chat/platform/local";
const { earlier: loadOlderChatMessages, materialize: materializeChatMessage, snapshot: readChatMessages } = localChatReads.transcript;
import { ImportedBoundary, type ImportedSourceStatus } from "@ai-chat/chat-ui/lineage/imported";
import { useEffectiveLocale } from "@/lib/i18n-locale";
import { ChatTranscriptSkeleton } from "./transcript-skeleton";
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

/* 导入段的成色，只由读侧投影出来：续聊点那条分隔线说「续自导入的历史」还是
   「来源已变化/已不在」，全看这一格。导入本身可能有损（折叠丢工具输出、尾部
   未校验），转录本来就显示省略——那就是全部披露，不再另发警告。 */
export type ImportSegmentFacts = Readonly<{
  sourceStatus?: ImportedSourceStatus;
}>;

export const ChatAssistantRow = memo(function ChatAssistantRow({
  message,
  isPlanExpanded,
  backendDisplayName,
  backendId,
  enableSidePanel,
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
  enableSidePanel: boolean;
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
  importSegment?: ImportSegmentFacts;
  routeSearch?: string;
  forkContext?: ChatForkViewContext;
  surfaceVisible?: boolean;
}) {
  const { t } = useAppTranslation();
  const locale = useEffectiveLocale();
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
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [forkAnchor, setForkAnchor] = useState<AssistantChatMessage | null>(null);
  const outline = useCanonicalChatOutline(chatId, incarnationId, showOutline);
  /* The reader owns the window, so rows are projected as they render rather than up front over
     every loaded message; what it stops rendering is forgotten once the list itself changes. */
  const [subagentProjector] = useState(createMessageSubagentProjector);
  useLayoutEffect(() => { subagentProjector.retain(messages); }, [messages, subagentProjector]);
  const earlier = useCallback(async () => (await loadOlderChatMessages(chatId))?.messages, [chatId]);
  const materialize = useCallback(async (id: string) => (await materializeChatMessage(chatId, id))?.messages, [chatId]);
  const draftPlan = draft ? projectDraftPlan(draft) : null;
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
            message.segment !== "imported" &&
            message.id === lastUserId &&
            !(forkContext?.summary.inheritedThroughSeq &&
              message.seq <= forkContext.summary.inheritedThroughSeq)
              ? () => setEditingMessageId(message.id)
              : undefined
          }
          editDisabledReason={
            message.id !== lastUserId
              ? undefined
              : message.segment === "imported"
                ? t("chatRevision.unavailable.imported-prefix")
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
        subagents={subagentProjector.project(message, subagents)}
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
        <ImportedBoundary sourceStatus={importSegment?.sourceStatus} locale={locale} />
      </Fragment>
    ) : renderMessage(message);
  return <TimelineView context={children => <ChartConversationBoundary>{children}</ChartConversationBoundary>} messages={messages} hasMoreBefore={readChatMessages(chatId)?.hasMoreBefore ?? false}
    /* The same key the cloud port passes: one conversation keeps one reading position across an execution-port switch. */
    memoryKey={incarnationId ? `${chatId}/${incarnationId}` : undefined}
    earlier={earlier} materialize={materialize} routeSearch={routeSearch} row={renderRow}
    copy={{ earlier: t("chat.transcript.loadEarlier"), loading: t("chat.transcript.loadingEarlier"), imported: t("history.importedHistoryLabel"), loaded: count => t("chat.transcript.loadedEarlier", { count }) }}
    navigation={jumpTo => <><TranscriptFind chatId={chatId} jumpTo={jumpTo} surfaceVisible={surfaceVisible} />{showOutline && <ChatOutline canonicalItems={outline.items} messages={messages} onJump={jumpTo} />}</>}
    live={draft ? { seq: assistantSeq, content: (
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
            />) } : undefined}
    after={<>          {forkAnchor && forkContext && (
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
          )}</>} />;
}

export const ChatTranscript = memo(function ChatTranscript(props: {
  controller: ChatSessionController["transcript"];
  /** Conversations with stored history get a skeleton while they hydrate. */
  existingChat?: boolean;
  enableSidePanel: boolean;
  expandedPlanId: string | null;
  onClosePlan: () => void;
  showOutline: boolean;
  importSegment?: ImportSegmentFacts;
  routeSearch?: string;
  forkContext?: ChatForkViewContext;
  surfaceVisible?: boolean;
}) {
  if (props.controller.loading) {
    return props.existingChat ? (
      <ChatTranscriptSkeleton />
    ) : (
      <div className="min-h-0 flex-1" />
    );
  }
  return <TranscriptRows {...props} />;
});
