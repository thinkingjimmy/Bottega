/**
 * [INPUT]: Depends on shared conversation column geometry, Conversation primitives, bounded Chat reads, backend identity, localized copy, canonical assistant turns, focused fork/static-row/divider/skeleton siblings, Find, Outline, revision actions, and side-panel Plan/Image commands
 * [OUTPUT]: Provides the localized canonical transcript (rows bind a stable onFork to their own message, D-02) with paged imported/native segments, a named gap where the window lacks rows before newer ones (D-05), the live reply only at the newest messages with a way back from older pages (D-16), immutable-prefix-aware native revisions, Fork boundaries, native streaming, scroll compensation, a reading position the cloud port re-enters on, backend failures, fenced anchors, Plan expansion, and Find/Outline A failed first history read keeps the newest turns with "Earlier messages not loaded" and Try again (review 0929 F07). Edit is offered only on the Chat's own last user message, never on an older page's (review 0929 F08).
 * Partial initial reads preserve readable messages and expose an explicit retry notice.
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
import { TimelineNotice, TimelineView } from "@ai-chat/chat-ui/timeline/view";
import { chatCopy, gapLabel } from "@ai-chat/chat-ui/copy";
import { projectDraftPlan } from "../../../../shared/chats/model/chat-turn-reducer";
import type {
  AssistantChatMessage,
} from "../../../../shared/ipc/content/chats-ipc";
import type { ChatSessionController } from "../runtime/use-chat-session";
import type { ConversationImageSource } from "../runtime/chat-session-model";
import type { ProjectedSubagent } from "@/lib/chat/session/chat-turn-attach";
import { ChatOutline, useCanonicalChatOutline } from "./navigation/chat-outline";
import { ChatTurn, ChatTurnDraft } from "./turns/chat-turn";
import { FailureCard } from "./notices/chat-error-card";
import { ChartConversationBoundary } from "@/components/charts/chart-scroll-root";
import { createMessageSubagentProjector } from "./turns/subagent-projection";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { Trash2Icon } from "lucide-react";
import { TranscriptFind } from "./navigation/transcript-find";
import { UserMessageEditor } from "./content/user-message-editor";
import type { AgentBackendId } from "../../../../shared/ipc/agent/agent-ipc";
import { localChatReads } from "@/lib/cloud/chat/platform/local";
const { snapshot: readChatMessages } = localChatReads.transcript;
import { useNativeTranscript } from "@/lib/native-transcript/use-native-transcript";
import { windowGap, windowedMessages } from "@/lib/native-transcript/window";
import { ImportedBoundary, type ImportedSourceStatus } from "@ai-chat/chat-ui/lineage/imported";
import { useEffectiveLocale } from "@/lib/appearance/i18n-locale";
import { ChatTranscriptSkeleton } from "./transcript-skeleton";
import {
  ForkChatDialog,
  ForkLineageDivider,
  type ChatForkViewContext,
} from "./navigation/chat-fork-controls";
import {
  ChatNoticeRow,
  ChatUserMessage,
  MessageShell,
} from "./turns/transcript-message-rows";

export type { ChatForkViewContext } from "./navigation/chat-fork-controls";

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
  /** Stable across renders (D-02); the row binds its own message. */
  onFork?: (message: AssistantChatMessage) => void;
  forkDisabledReason?: string;
  subagents: Record<string, ProjectedSubagent>;
  chatId: string;
  incarnationId: string | null;
}) {
  const fork = useCallback(() => onFork?.(message), [onFork, message]);
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
        onFork={onFork ? fork : undefined}
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
    messages: projected,
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
  /* TASK-25 S4d: the bounded window comes from the shared TranscriptSession; at the newest messages the projection's newer rows
     (local errors, the local assistant row, a turn the window has not caught up to) follow it. Until the first page lands the
     projection stands in, so opening a Chat never flashes empty. */
  const transcript = useNativeTranscript(chatId, incarnationId);
  const messages = useMemo(() => windowedMessages(transcript.rows, projected, transcript.snapshot.latest), [projected, transcript.rows, transcript.snapshot.latest]);
  const windowed = transcript.rows.length > 0;
  /* The reader anchors on its first render. The projection that stands in is only the last two turns, so when the window's first page
     lands (once per incarnation) the reader re-anchors on the newest rows of the real window, in place (no remount, no frame at the top). */
  const scope = `${chatId}/${incarnationId}`;
  const [landed, setLanded] = useState<string | null>(null);
  if (windowed && landed !== scope) setLanded(scope);
  const gap = useMemo(() => windowGap(transcript.rows, projected, transcript.snapshot.latest), [projected, transcript.rows, transcript.snapshot.latest]);
  // D-16: the live reply belongs under the newest messages; an older page says a reply is in progress and offers the way back.
  const olderPage = windowed && !transcript.snapshot.latest;
  const readFailed = transcript.snapshot.error && messages.length > 0;
  const earlier = transcript.earlier;
  // A target already among the rows shown only needs the reader to widen; anything else is a seek that replaces the window.
  const { seek } = transcript;
  const materialize = useCallback(async (id: string) => (messages.some((message) => message.id === id) ? messages : seek(id)), [messages, seek]);
  /* The reader owns the window, so rows are projected as they render rather than up front over
     every loaded message; what it stops rendering is forgotten once the list itself changes. */
  const [subagentProjector] = useState(createMessageSubagentProjector);
  useLayoutEffect(() => { subagentProjector.retain(messages); }, [messages, subagentProjector]);
  const draftPlan = draft ? projectDraftPlan(draft) : null;
  /* The Chat's own last user message (review 0929 F08): the projection always holds its newest turns, while the window may be an older
     page reached by Find or the outline, whose last user message the submit would refuse as stale. */
  const lastUserId = projected.findLast((message) => message.role === "user")?.id;
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
            ? setForkAnchor
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
  return <TimelineView anchorKey={landed === scope ? "window" : "stand-in"} context={children => <ChartConversationBoundary>{children}</ChartConversationBoundary>} messages={messages} hasMoreBefore={windowed ? transcript.snapshot.canEarlier : readChatMessages(chatId)?.hasMoreBefore ?? false}
    /* The same key the cloud port passes: one conversation keeps one reading position across an execution-port switch. */
    memoryKey={incarnationId ? `${chatId}/${incarnationId}` : undefined}
    earlier={earlier} materialize={materialize} routeSearch={routeSearch} row={renderRow}
    copy={{ earlier: t("chat.transcript.loadEarlier"), loading: t("chat.transcript.loadingEarlier"), imported: t("history.importedHistoryLabel"), loaded: count => t("chat.transcript.loadedEarlier", { count }) }}
    navigation={jumpTo => <><TranscriptFind chatId={chatId} jumpTo={jumpTo} surfaceVisible={surfaceVisible} />{showOutline && <ChatOutline canonicalItems={outline.items} messages={messages} onJump={jumpTo} />}</>}
    gap={gap ? { before: gap.before, content: <TimelineNotice data-transcript-gap="" label={gapLabel(locale, gap.count)} action={chatCopy(locale).gapLoad} onAction={transcript.latest} busy={transcript.snapshot.busy} /> }
      /* F07: the first history read failed, so only the newest turns (the projection) are shown; say so and read again on request. */
      : readFailed ? { before: messages[0]!.id, content: <TimelineNotice data-transcript-read-failed="" label={chatCopy(locale).gapNotLoadedEarlier} action={chatCopy(locale).retry} onAction={transcript.latest} busy={transcript.snapshot.busy} /> }
      : undefined}
    live={draft && !olderPage ? { seq: assistantSeq, content: (
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
    after={<>          {olderPage && (
            <TimelineNotice data-transcript-latest="" label={draft ? chatCopy(locale).replyInProgress : undefined} action={chatCopy(locale).latest} onAction={transcript.latest} busy={transcript.snapshot.busy} />
          )}
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
