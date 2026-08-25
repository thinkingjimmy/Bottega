/**
 * [INPUT]: Depends on Message, Thinking/Terminal, Plan/sourceRef Image/Subagent, Conversation Image Open the intent, Conversation Unlock the signal, Cold draft/cold turn Projection with lib/chat-format
 * [OUTPUT]: Provides TurnParts/ChatTurn/ChatTurnDraft with WorkedForRow/useFoldState for external transcripts and replications; Cold parts scan only when referring to changes, stream only processes hot text and extends the full turn chart quota
 * [POS]: The assistant filters for chat/transcript; The three turn terminals are each assigned to their renderers (Limit Flow Card/Alert Card/Conventional Message), the timing head is determined by the workingForLabel single-point decision (failed and without process means no head), the tool group adheres to the Conversation content list and includes the ability to fold feedback and feedback within the execution process area, plan and turnPlan blocks of the draft are arranged in parts time order (the implementation entry after the plan is placed below it, after the flow-through template);"Going on" is the complete turn expressed only by the end ThinkingShimmer (only in the plan Editing mode by replacing the PlanCard Editing spinner), and the toolbar/group must not attach the spinner again; The Latest turn of the Base dock is also directly rendered
 */

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  BrainIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleQuestionMarkIcon,
  CircleXIcon,
  FilePenIcon,
  FileSearchIcon,
  GlobeIcon,
  ImageIcon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react";
import { useScrollLockRelease } from "@ai-chat/ui/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@ai-chat/ui/components/ai-elements/message";
import { ThinkingShimmer } from "@ai-chat/ui/components/ai-elements/thinking-shimmer";
import { MessageRendererProvider } from "@ai-chat/ui/components/ai-elements/message/renderer-context";
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalTitle,
} from "@ai-chat/ui/components/ai-elements/terminal";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@ai-chat/ui/components/ui/collapsible";
import {
  Marker,
  MarkerContent,
  MarkerIcon,
} from "@ai-chat/ui/components/ui/marker";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { cn } from "@ai-chat/ui/lib/utils";
import type { AssistantChatMessage } from "../../../../shared/chats-ipc";
import { displaySubagentName } from "../../../../shared/subagent-name";
import { formatDuration, workedForLabel } from "@/lib/chat-format";
import type { ProjectedSubagent } from "@/lib/chat-turn-attach";
import {
  groupParts,
  groupSummary,
  type GroupedToolPart,
} from "@/lib/chat-turn-groups";
import {
  shimmerLabel,
  projectDraftPlan,
  type DraftPlanProjection,
  type DraftPart,
  type DraftSubagentPart,
  type DraftToolPart,
  type TurnDraft,
} from "../../../../shared/chat-turn-reducer";
import { SubagentAvatar } from "../subagent/subagent-avatar";
import { PlanCard } from "./chat-plan-card";
import { ChatMessageActions } from "./chat-message-actions";
import { ImageBlock } from "./chat-image";
import type { GallerySourceRef } from "../../../../shared/gallery-media-ipc";
import type { ConversationImageSource } from "../runtime/chat-session-model";
import { TurnErrorCard } from "./chat-error-card";
import { UsageLimitCard } from "./chat-usage-limit-card";
import { MemoryTurnReceipt } from "./memory-turn-receipt";
import { projectAssistantTurn } from "./turn-projection";
import { useDraftProjection } from "./draft-projection";

// ─── 折叠开合：展开即主动脱离粘底锁，把"读旧内容"与"追新消息"区分开 ───
// stick-to-bottom 只认高度增长，无法辨意图；展开时 stopScroll() 注入脱锁信号，
// 使 resize 跟随（scrollToBottom 带 preserveScrollPosition）在首帧因 !isAtBottom 中止。
// 脱锁是可选能力：turn 渲染器也被会话容器之外（Base dock 的 Latest turn）复用，
// 那里本就无锁可脱，useScrollLockRelease 退化为 no-op。

export function useFoldState() {
  const [open, setOpen] = useState(false);
  const stopScroll = useScrollLockRelease();
  const onOpenChange = (next: boolean) => {
    if (next) stopScroll();
    setOpen(next);
  };
  return [open, onOpenChange] as const;
}

const TOOL_ICONS = {
  command: TerminalIcon,
  "file-change": FilePenIcon,
  "file-read": FileSearchIcon,
  "web-search": GlobeIcon,
  image: ImageIcon,
  reasoning: BrainIcon,
  "user-input": CircleQuestionMarkIcon,
  other: WrenchIcon,
} as const;

// 「进行中」在 draft 期只由末尾 ThinkingShimmer 一处表达（orb + 当前工具标题），
// 工具行不再自带 spinner——同一件事闪两处即是噪音。running 因此不是图标状态，
// 只剩"失败亮红叉、其余亮工具本相"两条，分支自然消失。
function statusIcon(part: DraftToolPart) {
  if (part.status === "failed")
    return <CircleXIcon className="text-destructive" />;
  const Icon = TOOL_ICONS[part.tool];
  return <Icon />;
}

// ─── 工具详情：command 走 Terminal（含复制与流式光标），其余保留 pre 盒 ───

// Markdown 散文盒：reasoning 与 user-input 同构，只在强调语义上分道
function MarkdownDetail({
  className,
  text,
}: {
  className?: string;
  text: string;
}) {
  return (
    <SlimScroller
      className={cn(
        "my-1 max-h-80 min-w-0 max-w-full overflow-y-auto rounded-md bg-muted/50 p-3 text-muted-foreground text-sm",
        className
      )}
    >
      <MessageRendererProvider value={[]}>
        <MessageResponse>{text}</MessageResponse>
      </MessageRendererProvider>
    </SlimScroller>
  );
}

function ToolDetail({ part }: { part: DraftToolPart }) {
  // reasoning 是散文，按 Markdown 渲染；其余非 command 保留 pre
  // （image 独立成组，不经工具行折叠，故此处无需分支）
  if (part.tool === "reasoning")
    return <MarkdownDetail text={part.detail ?? ""} />;
  // 反问用户：问题以 **strong** 编码——提亮为前景色但保持常规字重，
  // 答案留在 muted，形成"问题在上、所选在下"的两级层次
  if (part.tool === "user-input")
    return (
      <MarkdownDetail
        className="[&_[data-streamdown=strong]]:font-normal [&_[data-streamdown=strong]]:text-foreground"
        text={part.detail ?? ""}
      />
    );
  if (part.tool !== "command") {
    return (
      <SlimScroller className="my-1 max-h-64 min-w-0 max-w-full overflow-y-auto rounded-md bg-muted/50 p-3">
        <pre className="whitespace-pre-wrap break-words font-mono text-muted-foreground text-xs">
          {part.detail}
        </pre>
      </SlimScroller>
    );
  }
  return (
    <Terminal
      className="my-1 w-full min-w-0 max-w-full"
      isStreaming={part.status === "running"}
      output={part.detail ?? ""}
    >
      <TerminalHeader>
        <TerminalTitle className="min-w-0">
          <span className="truncate">{part.title}</span>
        </TerminalTitle>
        <TerminalActions>
          <TerminalCopyButton />
        </TerminalActions>
      </TerminalHeader>
      <TerminalContent className="max-h-64 text-xs" />
    </Terminal>
  );
}

// ─── 单条思考：内容直接铺开（保留 Brain 图标），Codex 摘要的 **标题** 自然可见；
// 仅连续合流（merged）的 Thought 保留折叠，避免长篇思考刷屏 ───

function ThoughtInline({ part }: { part: GroupedToolPart }) {
  return (
    <div className="flex min-w-0 gap-2 py-1 text-muted-foreground">
      <MarkerIcon className="mt-0.5">
        <BrainIcon />
      </MarkerIcon>
      {/* Codex 摘要惯以 **标题** 开头，内联展示统一字重，与相邻工具行同调；
          streamdown 把 strong 渲染为 span[data-streamdown=strong]，须锁 data 标记 */}
      <div className="min-w-0 flex-1 text-sm [&_[data-streamdown=strong]]:font-normal">
        <MessageRendererProvider value={[]}>
          <MessageResponse>{part.detail ?? ""}</MessageResponse>
        </MessageRendererProvider>
      </div>
    </div>
  );
}

// ─── 工具行：Marker 行样式 + Collapsible 交互（决策 6），min-w-0 保证截断 ───

function ToolMarker({
  icon,
  open,
  title,
}: {
  icon: ReactNode;
  open?: boolean;
  title: string;
}) {
  return (
    <Marker className="min-w-0 flex-1">
      <MarkerIcon>{icon}</MarkerIcon>
      <span className="flex min-w-0 items-center gap-1">
        <MarkerContent>{title}</MarkerContent>
        {open !== undefined && (
          <ChevronRightIcon
            className={cn(
              "pointer-events-none size-3 shrink-0 opacity-0 transition-[opacity,transform] group-hover/tool-toggle:opacity-100 group-focus-visible/tool-toggle:opacity-100",
              open && "rotate-90"
            )}
          />
        )}
      </span>
    </Marker>
  );
}

function ToolRow({ part }: { part: GroupedToolPart }) {
  const [open, onOpenChange] = useFoldState();
  if (part.tool === "reasoning" && !part.merged && part.detail)
    return <ThoughtInline part={part} />;
  const row = (
    <ToolMarker
      icon={statusIcon(part)}
      open={part.detail ? open : undefined}
      title={part.title}
    />
  );
  if (!part.detail)
    return <div className="min-w-0 max-w-full py-1">{row}</div>;
  return (
    <Collapsible
      className="w-full min-w-0 max-w-full"
      onOpenChange={onOpenChange}
      open={open}
    >
      <CollapsibleTrigger className="group/tool-toggle flex w-full min-w-0 max-w-full cursor-pointer items-center py-1 text-left hover:[&_[data-slot=marker]]:text-foreground">
        {row}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ToolDetail part={part} />
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── 工具分组：连续工具行折叠为摘要行；默认折叠，展开与否只听用户 ───

// 占比最多的 tool 即组的身份；Map 保序，平票取首次出现者，流式追加不跳变
function dominantTool(parts: readonly DraftToolPart[]): DraftToolPart["tool"] {
  const counts = new Map<DraftToolPart["tool"], number>();
  for (const part of parts)
    counts.set(part.tool, (counts.get(part.tool) ?? 0) + 1);
  let top = parts[0].tool;
  for (const [tool, count] of counts)
    if (count > (counts.get(top) ?? 0)) top = tool;
  return top;
}

function groupIcon(parts: readonly DraftToolPart[]) {
  // 与 statusIcon 同律：组也不表达"正在跑"，进行中只归 ThinkingShimmer
  // 组的成败以末态为准：后续成功覆盖此前失败，中途报错已在展开子行留痕，
  // 聚合层只表达"最终落在哪"，避免重跑成功后仍虚报红叉
  if (parts.at(-1)?.status === "failed")
    return <CircleXIcon className="text-destructive" />;
  // icon 与摘要同源：谁占比最多就亮谁，全同是其退化情形（无需 uniform 特判）
  const Icon = TOOL_ICONS[dominantTool(parts)];
  return <Icon />;
}

function ToolGroup({ parts }: { parts: readonly DraftToolPart[] }) {
  const [open, onOpenChange] = useFoldState();
  return (
    <Collapsible
      className="w-full min-w-0 max-w-full"
      onOpenChange={onOpenChange}
      open={open}
    >
      <CollapsibleTrigger className="group/tool-toggle flex w-full min-w-0 max-w-full cursor-pointer items-center py-1 text-left hover:[&_[data-slot=marker]]:text-foreground">
        <ToolMarker
          icon={groupIcon(parts)}
          open={open}
          title={groupSummary(parts)}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="min-w-0 max-w-full">
        <div className="ml-[7px] min-w-0 max-w-full border-l pl-3">
          {parts.map((part) => (
            <ToolRow key={part.itemId} part={part} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function TurnParts({
  parts,
  subagents = {},
  onOpenSubagent,
  streamingIds = new Set<string>(),
  imageSourceRef,
  onOpenImage,
}: {
  parts: readonly DraftPart[];
  subagents?: Record<string, ProjectedSubagent>;
  onOpenSubagent?: (agentThreadId: string) => void;
  streamingIds?: ReadonlySet<string>;
  imageSourceRef?: (itemId: string) => GallerySourceRef | null;
  onOpenImage?: (source: ConversationImageSource) => void;
}) {
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
                  ? "该 Subagent 的详情已被清理"
                  : unavailable
                    ? "实时详情已达上限"
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

const WORKED_FOR_RULE = "w-full border-b pb-2";

export function WorkedForRow({
  label,
  open,
}: {
  label: string;
  open?: boolean;
}) {
  const collapsible = open !== undefined;
  return (
    <div className={WORKED_FOR_RULE}>
      <Marker
        className={cn(
          "select-none",
          collapsible && "cursor-pointer hover:text-foreground"
        )}
      >
        <MarkerContent>{label}</MarkerContent>
        {collapsible && (
          <MarkerIcon>
            <ChevronRightIcon
              className={cn("transition-transform", open && "rotate-90")}
            />
          </MarkerIcon>
        )}
      </Marker>
    </div>
  );
}

// ─── 过程区：Worked for 计时头 + 可折叠过程条目，plan 与普通终态消息共用 ───

function TurnProcess({
  message,
  subagents,
  onOpenSubagent,
  imageSourceRef,
  onOpenImage,
}: {
  message: AssistantChatMessage;
  subagents: Record<string, ProjectedSubagent>;
  onOpenSubagent?: (agentThreadId: string) => void;
  imageSourceRef?: (itemId: string) => GallerySourceRef | null;
  onOpenImage?: (source: ConversationImageSource) => void;
}) {
  const [open, onOpenChange] = useFoldState();
  const hasParts = (message.parts?.length ?? 0) > 0;
  // 头说什么、说不说，同归 workedForLabel（lib/chat-format）：null 即这条 turn
  // 没有工时可报——旧消息，或一秒即死、错误卡自成一体的失败 turn。
  const workedFor = workedForLabel(message);
  if (!workedFor) return null;
  if (!hasParts) {
    return (
      <div className={WORKED_FOR_RULE}>
        <Marker>
          <MarkerContent>{workedFor}</MarkerContent>
        </Marker>
      </div>
    );
  }
  return (
    <Collapsible
      className="w-full min-w-0 max-w-full"
      onOpenChange={onOpenChange}
      open={open}
    >
      <CollapsibleTrigger asChild>
        <button className="w-full text-left" type="button">
          <WorkedForRow label={workedFor} open={open} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4">
        <TurnParts
          onOpenImage={onOpenImage}
          onOpenSubagent={onOpenSubagent}
          parts={(message.parts ?? []) as DraftPart[]}
          subagents={subagents}
          imageSourceRef={imageSourceRef}
        />
      </CollapsibleContent>
    </Collapsible>
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
}: {
  message: AssistantChatMessage;
  isExpanded: boolean;
  onToggle?: () => void;
  subagents: Record<string, ProjectedSubagent>;
  onOpenSubagent?: (agentThreadId: string) => void;
  imageSourceRef?: (itemId: string) => GallerySourceRef | null;
  onOpenImage?: (source: ConversationImageSource) => void;
}) {
  return (
    <Message from="assistant">
      <TurnProcess
        message={message}
        onOpenSubagent={onOpenSubagent}
        subagents={subagents}
        imageSourceRef={imageSourceRef}
        onOpenImage={onOpenImage}
      />
      <PlanCard
        content={message.content}
        copyable
        editing={false}
        isExpanded={isExpanded}
        onToggle={onToggle}
      />
      <MemoryTurnReceipt receipt={message.contextReceipt} />
    </Message>
  );
}

function RegularChatTurn({
  backendDisplayName,
  message,
  showContinue,
  onContinue,
  onRetry,
  subagents,
  onOpenSubagent,
  imageSourceRef,
  onOpenImage,
}: {
  backendDisplayName: string;
  message: AssistantChatMessage;
  showContinue: boolean;
  onContinue: () => void;
  onRetry: () => void;
  subagents: Record<string, ProjectedSubagent>;
  onOpenSubagent?: (agentThreadId: string) => void;
  imageSourceRef?: (itemId: string) => GallerySourceRef | null;
  onOpenImage?: (source: ConversationImageSource) => void;
}) {
  // 额度耗尽是"等一等就好"，不是错误——它有自己的结构与动作，
  // 不该套在通用红框里；usageLimit 存在与否即是这条岔路的唯一判据。
  const usageLimit =
    message.failureKind === "usage-limit" ? message.usageLimit : undefined;
  return (
    <Message from="assistant">
      <TurnProcess
        message={message}
        onOpenSubagent={onOpenSubagent}
        subagents={subagents}
        imageSourceRef={imageSourceRef}
        onOpenImage={onOpenImage}
      />
      {usageLimit ? (
        <UsageLimitCard
          backendDisplayName={backendDisplayName}
          limit={usageLimit}
          message={message.content}
          onRetry={onRetry}
        />
      ) : message.isError ? (
        // 「继续」交给卡片而非另起一行：canContinue 本就要求 isError
        // （use-chat-session.ts），动作与病因同框，才不会是红框下面浮着一个孤儿按钮
        <TurnErrorCard
          content={message.content}
          onContinue={showContinue ? onContinue : undefined}
        />
      ) : (
        <MessageContent>
          <MessageResponse>{message.content}</MessageResponse>
        </MessageContent>
      )}
      <MemoryTurnReceipt receipt={message.contextReceipt} />
      <ChatMessageActions
        content={message.content}
        createdAt={message.createdAt}
        role="assistant"
      />
    </Message>
  );
}

export function ChatTurn(props: {
  chatId: string;
  incarnationId: string | null;
  backendDisplayName: string;
  message: AssistantChatMessage;
  isPlanExpanded?: boolean;
  showContinue: boolean;
  onContinue: () => void;
  onRetry: () => void;
  onTogglePlan?: () => void;
  subagents: Record<string, ProjectedSubagent>;
  onOpenSubagent?: (agentThreadId: string) => void;
  onOpenImage?: (source: ConversationImageSource) => void;
}) {
  const imageSourceRef = useCallback(
    (itemId: string): GallerySourceRef | null =>
      props.incarnationId
        ? {
            kind: "transcript",
            chatId: props.chatId,
            incarnationId: props.incarnationId,
            assistantSeq: props.message.seq,
            itemId,
          }
        : null,
    [
      props.chatId,
      props.incarnationId,
      props.message.seq,
    ]
  );
  const message = useMemo(
    () => projectAssistantTurn(props.message),
    [props.message]
  );
  return message.kind === "plan" ? (
    <PlanTurn
      isExpanded={props.isPlanExpanded ?? false}
      message={message}
      onOpenSubagent={props.onOpenSubagent}
      onOpenImage={props.onOpenImage}
      onToggle={props.onTogglePlan}
      subagents={props.subagents}
      imageSourceRef={imageSourceRef}
    />
  ) : (
    <RegularChatTurn
      backendDisplayName={props.backendDisplayName}
      message={message}
      onContinue={props.onContinue}
      onOpenSubagent={props.onOpenSubagent}
      onOpenImage={props.onOpenImage}
      onRetry={props.onRetry}
      showContinue={props.showContinue}
      subagents={props.subagents}
      imageSourceRef={imageSourceRef}
    />
  );
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
  const [now, setNow] = useState(() => endedAt ?? Date.now());
  useEffect(() => {
    if (endedAt !== undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [endedAt]);
  const displayNow = endedAt ?? now;
  return (
    <WorkedForRow
      label={`${endedAt === undefined ? "Working" : "Worked"} for ${formatDuration(
        Math.max(0, displayNow - startedAt)
      )}`}
    />
  );
}
