"use client";

/**
 * [INPUT]: Depends on content generation, shared foreign blocks/grouping, i18n, Conversation/Collapsible primitives, turn folding, user-message folding, and shared message actions
 * [OUTPUT]: Provides generation-scoped canonical foreign rows with controlled Plan toggles, turn/tool folding, worked-time display, and copy actions
 * [POS]: The immutable prefix row renderer for chat/transcript; panel state is owned by the parent session
 */

import { useMemo } from "react";
import type {
  ForeignHistoryBlock,
  ForeignHistoryMessage,
} from "../../../../shared/history-import-ipc";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@ai-chat/ui/components/ai-elements/message";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@ai-chat/ui/components/ui/collapsible";
import type { DraftPart } from "../../../../shared/chat-turn-reducer";
import { translate } from "../../../../shared/i18n/runtime";
import { effectiveLocale } from "@/lib/i18n-locale";
import { formatDuration } from "@/lib/chat-format";
import { capMarkdown } from "@/lib/charts/chart-markdown";
import { ChatMessageActions } from "./chat-message-actions";
import { PlanCard } from "./chat-plan-card";
import { UserMessageFold } from "./chat-user-attachments";
import { TurnParts, useFoldState, WorkedForRow } from "./chat-turn";
import { projectForeignTools } from "./foreign-projection";
import {
  foreignHistoryAnchor,
  groupForeignHistoryBlocks,
} from "../../../../shared/foreign-history-grouping";

/* ── Codex 计划标签：<proposed_plan> 是模型输出里的机器语法 ─────────
 * 产品正史里 plan 走 PlanCard；源文本把计划内嵌在 assistant 正文的标签里，
 * 按普通 markdown 渲染标签就裸奔。此处拆出计划正文喂同一张 PlanCard，
 * 前言照常做正文；未闭合（中断留痕）按开标签起始截到末尾。 */
const PLAN_PATTERN = /<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/;
const OPEN_PLAN_PATTERN = /<proposed_plan>\s*([\s\S]*)$/;

function splitPlan(content: string): { prose: string; plan: string | null } {
  const match = PLAN_PATTERN.exec(content) ?? OPEN_PLAN_PATTERN.exec(content);
  if (!match) return { prose: content, plan: null };
  const prose = `${content.slice(0, match.index)}\n\n${content.slice(match.index + match[0].length)}`.trim();
  return { prose, plan: match[1].trim() || null };
}

/** 过程流里的中间陈述不放卡片：剥标签后计划正文以纯文本并入，防裸奔。 */
function flattenPlanTags(content: string): string {
  const { prose, plan } = splitPlan(content);
  return [prose, plan].filter(Boolean).join("\n\n");
}

/* ── 解析不出的来源块：不呈现 ────────────────────────────────────
 * 它们从来不是这段对话说过的话——是 agent 自己的文档、配置与协议噪音落进了
 * 同一个 jsonl。曾经它们以一行「Unsupported source block」出现在正文里，本意
 * 是诚实（这块没进标题/搜索/Memory/续聊），实际效果却是把一句用户永远无法处置
 * 的技术自白插进了会话——诚实的前提是对方能拿它做点什么，否则只是噪音。
 * 于是这里连同那两条文案一起消失：过滤在渲染之前，下面因此没有第二种行。
 * ────────────────────────────────────────────────────────── */
/* ── turn 聚合：与产品「一 turn 一条 assistant 消息」同构 ─────────────
 * codex/kimi 的一个 turn 在源里是多条 assistant 消息（中间陈述 + 最终回复）
 * 穿插工具；逐条渲染会让一个 turn 长出一串计时头、中间消息裸奔成正文——
 * 截图实锤的形态断裂。此处按 user 边界聚合：末条 assistant 是正文，其余
 * 文本与全部工具按原序编成 DraftPart 过程流（TurnParts 恰好就是产品过程区
 * 的渲染语言：text 落 MessageContent、连续工具聚簇成摘要组）。
 * 工时取 turn 内最后一笔源生账（adapter 已挂在末条 assistant 上）。 */
type ForeignRow =
  | { kind: "user"; key: string; block: ForeignHistoryMessage }
  | { kind: "turn"; key: string; final: ForeignHistoryMessage; process: DraftPart[]; workedForMs?: number };

function groupTurns(blocks: ForeignHistoryBlock[]): ForeignRow[] {
  return groupForeignHistoryBlocks(blocks).map((row) => {
    if (row.kind === "user") return row;
    const final = row.final;
    const process: DraftPart[] = [];
    row.messages.forEach((message, index) => {
      process.push(...projectForeignTools(message.tools));
      if (index < row.messages.length - 1 && message.content.trim()) {
        process.push({ type: "text", itemId: `${message.id}:${message.deliverySeq}`, text: flattenPlanTags(message.content) });
      }
    });
    const workedForMs = row.messages.map((message) => message.workedForMs).filter((ms) => ms !== undefined).at(-1);
    return {
      kind: "turn",
      key: row.key,
      final,
      process,
      ...(workedForMs !== undefined ? { workedForMs } : {}),
    };
  });
}

/* ── 过程区：与产品 TurnProcess 逐结构同构 ───────────────────────────
 * 计时头默认折叠住全部过程，点击展开——终态只剩最终回复。三态与产品同律：
 * 有过程出折叠头，无过程有账出静态头，两者皆无则无头。 */
function ForeignTurnProcess({ process, workedForMs }: {
  process: DraftPart[];
  workedForMs?: number;
}) {
  const [open, onOpenChange] = useFoldState();
  const label = workedForMs !== undefined
    ? translate(effectiveLocale(), "chat.workedFor", { duration: formatDuration(workedForMs) })
    : translate(effectiveLocale(), "chat.worked");
  if (!process.length) {
    return workedForMs === undefined ? null : <WorkedForRow label={label} />;
  }
  return (
    <Collapsible
      className="w-full min-w-0 max-w-full"
      onOpenChange={onOpenChange}
      open={open}
    >
      <CollapsibleTrigger asChild>
        <button className="w-full text-left" type="button">
          <WorkedForRow label={label} open={open} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4">
        <TurnParts parts={process} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function ForeignAssistantTurn({
  contentGenerationKey,
  row,
  expandedPlanKey,
  onTogglePlan,
}: {
  contentGenerationKey: string;
  row: ForeignRow & { kind: "turn" };
  expandedPlanKey?: string | null;
  onTogglePlan?: (plan: { anchorId: string; content: string }) => void;
}) {
  const { prose, plan } = useMemo(() => splitPlan(row.final.content), [row.final.content]);
  const anchorId = foreignHistoryAnchor(contentGenerationKey, row.key);
  return (
    <Message from="assistant">
      <ForeignTurnProcess process={row.process} workedForMs={row.workedForMs} />
      {prose && (
        <MessageContent>
          <MessageResponse>{capMarkdown(prose)}</MessageResponse>
        </MessageContent>
      )}
      {plan !== null && (
        <PlanCard
          content={plan}
          copyable
          editing={false}
          isExpanded={expandedPlanKey === anchorId}
          onToggle={onTogglePlan
            ? () => onTogglePlan({ anchorId, content: plan })
            : undefined}
        />
      )}
      <ChatMessageActions
        content={row.final.content}
        createdAt={row.final.createdAt}
        role="assistant"
      />
    </Message>
  );
}

function ForeignUserRow({ block }: { block: ForeignHistoryMessage }) {
  return (
    <Message from="user">
      <MessageContent className="gap-1">
        <UserMessageFold measurementKey={block.content}>
          <MessageResponse>{capMarkdown(block.content)}</MessageResponse>
        </UserMessageFold>
      </MessageContent>
      <ChatMessageActions
        content={block.content}
        createdAt={block.createdAt}
        role="user"
      />
    </Message>
  );
}

export function ForeignHistoryTranscriptRows({
  blocks,
  contentGenerationKey,
  expandedPlanKey,
  onTogglePlan,
}: {
  blocks: ForeignHistoryBlock[];
  contentGenerationKey: string;
  expandedPlanKey?: string | null;
  onTogglePlan?: (plan: { anchorId: string; content: string }) => void;
}) {
  const rows = useMemo(() => groupTurns(blocks), [blocks]);
  return rows.map((row) => (
    <div
      className="w-full min-w-0 max-w-full"
      data-message-id={foreignHistoryAnchor(contentGenerationKey, row.key)}
      key={foreignHistoryAnchor(contentGenerationKey, row.key)}
      tabIndex={-1}
    >
      {row.kind === "user" ? (
        <ForeignUserRow block={row.block} />
      ) : (
        <ForeignAssistantTurn
          contentGenerationKey={contentGenerationKey}
          expandedPlanKey={expandedPlanKey}
          onTogglePlan={onTogglePlan}
          row={row}
        />
      )}
    </div>
  ));
}
