/**
 * [INPUT]: Depends on shared ConversationParts, ConversationDraft, ConversationElapsed, ConversationSubagent and conversation Agent/process headings, tool rows and grouping, Message, Thinking, Terminal, Plan, image source custody, subagent, structured Agent failure notices, RegularChatTurn, fork actions, cold-turn projection, and Chat formatting components
 * [OUTPUT]: Plan and process rendering (the replying Agent named from the Provider catalog: a package Provider's declared name, never its id) with consistent interrupted-state disclosure, copy annotation, media and Subagent projections.
 * [POS]: apps/desktop/src/components/chat/transcript/turns; Assistant-turn process renderer for chat/transcript; delegates non-plan terminal presentation to chat-regular-turn
 */

import { AgentBackendIcon, isAgentBackendId } from "@/lib/agent/agent-backends";
import { useProviderName } from "@/lib/provider-catalog/hooks";
import {
  useCallback,
  useMemo,
} from "react";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@ai-chat/ui/components/ai-elements/message";
import { ConversationAgent, ConversationProcess, ConversationProcessHeading as WorkedForRow } from "@ai-chat/ui/components/conversation/process";
import type { AssistantChatMessage } from "../../../../../shared/ipc/content/chats-ipc";
import { displaySubagentName } from "../../../../../shared/tools/subagent-name";
import { formatDuration, workedForLabel } from "@/lib/chat/content/chat-format";
import type { ProjectedSubagent } from "@/lib/chat/session/chat-turn-attach";
import {
  shimmerLabel,
  projectDraftPlan,
  type DraftPlanProjection,
  type DraftPart,
  type TurnDraft,
} from "../../../../../shared/chats/model/chat-turn-reducer";
import { PlanCard } from "../notices/chat-plan-card";
import { ChatMessageActions } from "../navigation/chat-message-actions";
import { ImageBlock } from "../content/chat-image";
import type { GallerySourceRef } from "../../../../../shared/ipc/content/gallery-media-ipc";
import type { ConversationImageSource } from "../../runtime/chat-session-model";
import { projectAssistantTurn } from "./turn-projection";
import { useDraftProjection } from "./draft-projection";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { AgentFailureNotice } from "@/components/agent-failure-notice";
import type { AgentBackendId } from "../../../../../shared/ipc/agent/agent-ipc";
import { ConversationParts } from "@ai-chat/chat-ui/turn/parts";
import { ConversationSubagent } from "@ai-chat/chat-ui/turn/subagent";
import { ConversationDraft, ConversationElapsed } from "@ai-chat/chat-ui/turn/draft";
import { RegularChatTurn } from "./chat-regular-turn";

/* A package Provider's reply (TASK-11 S3-b) shows its name by id; the built-in-only affordances (sign-in, usage) get no backend id. */
const replyBackend = (backend: string) => isAgentBackendId(backend) ? backend : undefined;

export function TurnParts({
  parts,
  subagents = {},
  onOpenSubagent,
  streamingIds = new Set<string>(),
  imageSourceRef,
  onOpenImage,
  backendDisplayName = "Agent",
  backendId,
}: {
  parts: readonly DraftPart[];
  subagents?: Record<string, ProjectedSubagent>;
  onOpenSubagent?: (agentThreadId: string) => void;
  streamingIds?: ReadonlySet<string>;
  imageSourceRef?: (itemId: string) => GallerySourceRef | null;
  onOpenImage?: (source: ConversationImageSource) => void;
  backendDisplayName?: string;
  backendId?: AgentBackendId;
}) {
  const { t } = useAppTranslation();
  return <ConversationParts parts={parts} streamingIds={streamingIds}
    image={part => <ImageBlock onOpen={onOpenImage} part={part} sourceRef={imageSourceRef?.(part.itemId) ?? null} />}
    failure={part => part.failure ? <AgentFailureNotice backend={backendDisplayName} backendId={backendId} compact failure={part.failure} tone={part.severity === "warning" ? "warning" : "danger"} /> : null}
    subagent={part => {
      const agent = subagents[part.agentThreadId];
      return <ConversationSubagent id={part.agentThreadId} agent={agent?.meta.agent ?? part.agent}
        name={displaySubagentName(agent?.meta.name ?? part.name)} status={agent?.meta.status ?? part.status}
        disabled={Boolean(onOpenSubagent) && (!agent || !agent.draft)}
        title={!agent ? t("chat.transcript.subagentDetailsCleared") : !agent.draft ? t("chat.transcript.subagentDetailsLimited") : agent.meta.name}
        onOpen={onOpenSubagent ? () => onOpenSubagent(part.agentThreadId) : undefined} />;
    }} />;
}

// ─── 过程区：Worked for 计时头 + 可折叠过程条目，plan 与普通终态消息共用 ───

function TurnProcess({
  message,
  subagents,
  onOpenSubagent,
  imageSourceRef,
  onOpenImage,
  backendDisplayName = "Agent",
  backendId,
}: {
  message: AssistantChatMessage;
  subagents: Record<string, ProjectedSubagent>;
  onOpenSubagent?: (agentThreadId: string) => void;
  imageSourceRef?: (itemId: string) => GallerySourceRef | null;
  onOpenImage?: (source: ConversationImageSource) => void;
  backendDisplayName?: string;
  backendId?: AgentBackendId;
}) {
  const hasParts = (message.parts?.length ?? 0) > 0;
  // 头说什么、说不说，同归 workedForLabel（lib/chat-format）：null 即这条 turn
  // 没有工时可报——旧消息，或一秒即死、错误卡自成一体的失败 turn。
  const workedFor = workedForLabel(message);
  if (!workedFor) return null;
  if (!hasParts) {
    return (
      <WorkedForRow label={workedFor} />
    );
  }
  return (
    <ConversationProcess label={workedFor}>
        <TurnParts
          backendDisplayName={backendDisplayName}
          backendId={backendId}
          onOpenImage={onOpenImage}
          onOpenSubagent={onOpenSubagent}
          parts={(message.parts ?? []) as DraftPart[]}
          subagents={subagents}
          imageSourceRef={imageSourceRef}
        />
    </ConversationProcess>
  );
}

// ─── 终态消息：默认折叠只剩最终回复，点击 Worked for 展开全过程 ───

function PlanTurn({
  message,
  isExpanded,
  onToggle,
  subagents,
  onOpenSubagent,
  imageSourceRef,
  onOpenImage,
  onFork,
  forkDisabledReason,
}: {
  message: AssistantChatMessage;
  isExpanded: boolean;
  onToggle?: () => void;
  subagents: Record<string, ProjectedSubagent>;
  onOpenSubagent?: (agentThreadId: string) => void;
  imageSourceRef?: (itemId: string) => GallerySourceRef | null;
  onOpenImage?: (source: ConversationImageSource) => void;
  onFork?: () => void;
  forkDisabledReason?: string;
}) {
  const { t } = useAppTranslation();
  return (
    <Message from="assistant">
      {message.completion === "interrupted" && <p role="status" className="text-sm text-muted-foreground">{t("chat.interrupted")}</p>}
      <TurnProcess
        message={message}
        onOpenSubagent={onOpenSubagent}
        subagents={subagents}
        imageSourceRef={imageSourceRef}
        onOpenImage={onOpenImage}
      />
      <PlanCard
        content={message.content}
        copyable={false}
        editing={false}
        isExpanded={isExpanded}
        onToggle={onToggle}
      />
      <ChatMessageActions
        content={message.completion === "interrupted" ? `${message.content}\n\n[${t("chat.interrupted")}]` : message.content}
        contextReceipt={message.contextReceipt}
        createdAt={message.createdAt}
        onFork={onFork}
        forkDisabledReason={forkDisabledReason}
        role="assistant"
      />
    </Message>
  );
}

export function ChatTurn(props: {
  chatId: string;
  incarnationId: string | null;
  backendDisplayName: string;
  backendId?: AgentBackendId;
  message: AssistantChatMessage;
  isPlanExpanded?: boolean;
  onRetry: () => void;
  onTogglePlan?: () => void;
  subagents: Record<string, ProjectedSubagent>;
  onOpenSubagent?: (agentThreadId: string) => void;
  onOpenImage?: (source: ConversationImageSource) => void;
  onFork?: () => void;
  forkDisabledReason?: string;
}) {
  const agentName = useProviderName()(props.message.backend);
  const imageSourceRef = useCallback(
    (itemId: string): GallerySourceRef | null => {
      const referenced = props.message.parts?.find(
        (part) => part.type === "tool" && part.itemId === itemId && part.mediaSource
      );
      if (referenced?.type === "tool" && referenced.mediaSource) {
        return referenced.mediaSource;
      }
      return props.incarnationId
        ? {
            kind: "transcript",
            chatId: props.chatId,
            incarnationId: props.incarnationId,
            assistantSeq: props.message.seq,
            itemId,
          }
        : null;
    },
    [
      props.chatId,
      props.incarnationId,
      props.message.parts,
      props.message.seq,
    ]
  );
  const message = useMemo(
    () => projectAssistantTurn(props.message),
    [props.message]
  );
  const content = message.kind === "plan" ? (
    <PlanTurn
      isExpanded={props.isPlanExpanded ?? false}
      message={message}
      onOpenSubagent={props.onOpenSubagent}
      onOpenImage={props.onOpenImage}
      onToggle={props.onTogglePlan}
      subagents={props.subagents}
      imageSourceRef={imageSourceRef}
      onFork={props.onFork}
      forkDisabledReason={props.forkDisabledReason}
    />
  ) : (
    <RegularChatTurn
      backendDisplayName={agentName}
      backendId={replyBackend(props.message.backend)}
      message={message}
      onRetry={props.onRetry}
      process={
        <TurnProcess
          backendDisplayName={agentName}
          backendId={replyBackend(props.message.backend)}
          imageSourceRef={imageSourceRef}
          message={message}
          onOpenImage={props.onOpenImage}
          onOpenSubagent={props.onOpenSubagent}
          subagents={props.subagents}
        />
      }
      onFork={props.onFork}
      forkDisabledReason={props.forkDisabledReason}
    />
  );
  return <div><ConversationAgent icon={<AgentBackendIcon backend={props.message.backend} className="size-3" />} label={agentName} />{content}</div>;
}

// ─── 流式草稿：活动分组强制展开实时渲染，末尾按决策 9 渲染 shimmer ───

export function ChatTurnDraft({
  draft,
  hasPendingApproval,
  queued = false,
  isPlanExpanded,
  subagents,
  onOpenSubagent,
  onOpenImage,
  onTogglePlan,
  chatId,
  incarnationId,
  assistantSeq,
  backendDisplayName = "Agent",
  backendId,
}: {
  draft: TurnDraft;
  hasPendingApproval: boolean;
  queued?: boolean;
  isPlanExpanded?: boolean;
  subagents: Record<string, ProjectedSubagent>;
  onOpenSubagent?: (agentThreadId: string) => void;
  onOpenImage?: (source: ConversationImageSource) => void;
  onTogglePlan?: (plan: DraftPlanProjection) => void;
  chatId: string;
  incarnationId: string | null;
  assistantSeq?: number;
  backendDisplayName?: string;
  backendId?: AgentBackendId;
}) {
  const label = shimmerLabel(draft, hasPendingApproval, queued);
  const plan = projectDraftPlan(draft);
  const projection = useDraftProjection(draft, plan);
  const imageSourceRef = useCallback(
    (itemId: string): GallerySourceRef | null =>
      incarnationId && assistantSeq !== undefined
        ? {
            kind: "transcript",
            chatId,
            incarnationId,
            assistantSeq,
            itemId,
          }
        : null,
    [assistantSeq, chatId, incarnationId]
  );
  const renderParts = (parts: typeof projection.beforePlan) =>
    parts.length > 0 && (
      <TurnParts
        backendDisplayName={backendDisplayName}
        backendId={backendId}
        imageSourceRef={imageSourceRef}
        onOpenSubagent={onOpenSubagent}
        onOpenImage={onOpenImage}
        parts={parts}
        streamingIds={projection.streamingIds}
        subagents={subagents}
      />
    );

  return (
    <ConversationDraft label={label} editingPlan={Boolean(plan?.editing)}
      elapsed={(projection.visibleCount > 0 || projection.streamingTexts.length > 0 || plan) && <ElapsedLabel startedAt={draft.startedAt} />}>
      {renderParts(projection.beforePlan)}
      {plan && (
        <PlanCard
          content={projection.cappedPlan}
          copyable={false}
          editing={plan.editing}
          isExpanded={isPlanExpanded ?? false}
          onToggle={onTogglePlan ? () => onTogglePlan(plan) : undefined}
        />
      )}
      {renderParts(projection.afterPlan)}
      {projection.streamingTexts.map(([itemId, text]) => (
        <MessageContent key={itemId}>
          <MessageResponse isAnimating={draft.streaming.has(itemId)}>
            {projection.cappedStreaming.get(itemId) ?? text}
          </MessageResponse>
        </MessageContent>
      ))}
    </ConversationDraft>
  );
}

export function ElapsedLabel({
  startedAt,
  endedAt,
}: {
  startedAt: number;
  endedAt?: number;
}) {
  const { t } = useAppTranslation();
  return <ConversationElapsed startedAt={startedAt} endedAt={endedAt} label={(duration, finished) =>
    t(finished ? "chat.workedFor" : "chat.transcript.workingFor", { duration: formatDuration(duration) })} />;
}
