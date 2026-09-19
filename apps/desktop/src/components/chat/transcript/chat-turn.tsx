/**
 * [INPUT]: Depends on shared conversation Agent/process headings, tool rows and grouping, Message, Thinking, Terminal, Plan, image source custody, subagent, structured Agent failure notices, RegularChatTurn, fork actions, cold-turn projection, and Chat formatting components
 * [OUTPUT]: Plan and process rendering with consistent interrupted-state disclosure, copy annotation, media and Subagent projections.
 * [POS]: Assistant-turn process renderer for chat/transcript; delegates non-plan terminal presentation to chat-regular-turn
 */

import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CheckIcon,
  CircleXIcon,
} from "lucide-react";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@ai-chat/ui/components/ai-elements/message";
import { ConversationAgent, ConversationProcess, ConversationProcessHeading as WorkedForRow } from "@ai-chat/ui/components/conversation/process";
import { ThinkingShimmer } from "@ai-chat/ui/components/ai-elements/thinking-shimmer";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { cn } from "@ai-chat/ui/lib/utils";
import type { AssistantChatMessage } from "../../../../shared/chats-ipc";
import { displaySubagentName } from "../../../../shared/subagent-name";
import { formatDuration, workedForLabel } from "@/lib/chat-format";
import type { ProjectedSubagent } from "@/lib/chat-turn-attach";
import {
  groupParts,
} from "@/lib/chat-turn-groups";
import {
  shimmerLabel,
  projectDraftPlan,
  type DraftPlanProjection,
  type DraftPart,
  type DraftSubagentPart,
  type TurnDraft,
} from "../../../../shared/chat-turn-reducer";
import { SubagentAvatar } from "../subagent/subagent-avatar";
import { PlanCard } from "./chat-plan-card";
import { ChatMessageActions } from "./chat-message-actions";
import { ImageBlock } from "./chat-image";
import type { GallerySourceRef } from "../../../../shared/gallery-media-ipc";
import type { ConversationImageSource } from "../runtime/chat-session-model";
import { projectAssistantTurn } from "./turn-projection";
import { useDraftProjection } from "./draft-projection";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { AgentFailureNotice } from "@/components/agent-failure-notice";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import { ToolRow, ToolGroup } from "@ai-chat/ui/components/conversation/activity/tools";
import { RegularChatTurn } from "./chat-regular-turn";

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
  return (
    <div className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2">
      {groupParts(parts).map((group) => {
        if (group.type === "text")
          return (
            <MessageContent className="w-full" key={group.part.itemId}>
              <MessageResponse isAnimating={streamingIds.has(group.part.itemId)}>
                {group.part.text}
              </MessageResponse>
            </MessageContent>
          );
        if (group.type === "image")
          return (
            <ImageBlock
              key={group.part.itemId}
              onOpen={onOpenImage}
              part={group.part}
              sourceRef={imageSourceRef?.(group.part.itemId) ?? null}
            />
          );
        if (group.type === "failure")
          return group.part.failure ? (
            <AgentFailureNotice
              backend={backendDisplayName}
              backendId={backendId}
              compact
              failure={group.part.failure}
              key={group.part.itemId}
              tone={group.part.severity === "warning" ? "warning" : "danger"}
            />
          ) : null;
        if (group.type === "subagent") {
          const part: DraftSubagentPart = group.part;
          const agent = subagents[part.agentThreadId];
          const status = agent?.meta.status ?? part.status;
          const active = ["pendingInit", "running"].includes(status);
          const completed = ["completed", "shutdown"].includes(status);
          const unavailable = !agent || !agent.draft;
          return (
            <button
              className={cn(
                "flex max-w-full items-center gap-2 rounded-full border bg-background px-2.5 py-1 text-muted-foreground text-sm transition-colors disabled:opacity-60",
                onOpenSubagent
                  ? "cursor-pointer hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed"
                  : "cursor-default"
              )}
              disabled={!onOpenSubagent || unavailable}
              key={part.itemId}
              onClick={() => onOpenSubagent?.(part.agentThreadId)}
              title={
                !agent
                  ? t("chat.transcript.subagentDetailsCleared")
                  : unavailable
                    ? t("chat.transcript.subagentDetailsLimited")
                    : agent.meta.name
              }
              type="button"
            >
              <SubagentAvatar
                agent={agent?.meta.agent ?? part.agent}
                agentThreadId={part.agentThreadId}
                size={18}
              />
              <span className="truncate">
                {displaySubagentName(agent?.meta.name ?? part.name)}
              </span>
              {active ? (
                <Spinner className="size-3.5" />
              ) : completed ? (
                <CheckIcon className="size-3.5" />
              ) : (
                <CircleXIcon className="size-3.5 text-destructive" />
              )}
            </button>
          );
        }
        // 纯思考组（合流后仅一条 reasoning）交给 ToolRow：单条内联铺开，合流保持折叠
        if (group.parts.length === 1 && group.parts[0].tool === "reasoning")
          return (
            <div className="w-full" key={group.key}>
              <ToolRow part={group.parts[0]} />
            </div>
          );
        return <ToolGroup key={group.key} parts={group.parts} />;
      })}
    </div>
  );
}

// ─── 计时头：标签行在上，下缘全宽发丝线（对齐设计稿） ───

export { ConversationProcessHeading as WorkedForRow } from "@ai-chat/ui/components/conversation/process";

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
      backendDisplayName={backendLabel(props.message.backend)}
      backendId={props.message.backend}
      message={message}
      onRetry={props.onRetry}
      process={
        <TurnProcess
          backendDisplayName={backendLabel(props.message.backend)}
          backendId={props.message.backend}
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
  return <div><ConversationAgent icon={<AgentBackendIcon backend={props.message.backend} className="size-3" />} label={backendLabel(props.message.backend)} />{content}</div>;
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
    <Message from="assistant">
      {(projection.visibleCount > 0 || projection.streamingTexts.length > 0 || plan) && (
        <ElapsedLabel startedAt={draft.startedAt} />
      )}
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
      {/* 「进行中」仍只由末尾 shimmer 一处表达；唯 plan 流式编辑中由
          PlanCard 头部的 Editing spinner 顶替，完成后 shimmer 归位——
          批准退出 Plan 后的实施阶段因此始终有进行中信号 */}
      {(!plan || !plan.editing) && <ThinkingShimmer>{label}</ThinkingShimmer>}
    </Message>
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
  const [now, setNow] = useState(() => endedAt ?? Date.now());
  useEffect(() => {
    if (endedAt !== undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [endedAt]);
  const displayNow = endedAt ?? now;
  return (
    <WorkedForRow
      label={
        endedAt === undefined
          ? t("chat.transcript.workingFor", {
              duration: formatDuration(Math.max(0, displayNow - startedAt)),
            })
          : t("chat.workedFor", {
              duration: formatDuration(Math.max(0, displayNow - startedAt)),
            })
      }
    />
  );
}
