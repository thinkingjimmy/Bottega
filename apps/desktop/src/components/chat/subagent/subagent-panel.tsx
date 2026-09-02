/**
 * [INPUT]: Depends on App i18n, ProjectedSubagent projections, Conversation, shared TurnParts, ThinkingShimmer, Button, and SubagentAvatar
 * [OUTPUT]: Provides SubagentPanel to unify 20px headers, share ElapsedLabel to show read-only flow details and return list entries
 * [POS]: The tabs for chat/subagent are detailed; Panel Tabs, transcript renderer, is used to close the panel
 */

import { ArrowLeftIcon } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@ai-chat/ui/components/ai-elements/conversation";
import { MessageContent, MessageResponse } from "@ai-chat/ui/components/ai-elements/message";
import { ThinkingShimmer } from "@ai-chat/ui/components/ai-elements/thinking-shimmer";
import { Button } from "@ai-chat/ui/components/ui/button";
import type {
  ProjectedSubagent,
} from "@/lib/chat-turn-attach";
import { shimmerLabel } from "../../../../shared/chat-turn-reducer";
import { ElapsedLabel, TurnParts } from "../transcript/chat-turn";
import { SubagentAvatar } from "./subagent-avatar";
import { capPartMarkdown } from "@/lib/charts/chart-markdown";
import { ChartConversationBoundary } from "@/components/charts/chart-scroll-root";
import { useAppTranslation } from "@/components/providers/i18n-provider";

const activeStatus = (status: ProjectedSubagent["meta"]["status"]) =>
  ["pendingInit", "running"].includes(status);

export function SubagentPanel({
  agent,
  subagents,
  onBack,
  onOpenSubagent,
}: {
  agent: ProjectedSubagent;
  subagents: Record<string, ProjectedSubagent>;
  onBack: () => void;
  onOpenSubagent: (agentThreadId: string) => void;
}) {
  const { t } = useAppTranslation();
  const active = activeStatus(agent.meta.status);
  const draft = agent.draft;
  const streaming = draft
    ? [...draft.streaming].filter(
        ([itemId, text]) =>
          text && !draft.parts.some((part) => part.itemId === itemId)
      )
    : [];
  const capped = draft
    ? capPartMarkdown(
        draft.parts,
        streaming.map(([itemId, text]) => ({
          id: `stream:${itemId}`,
          markdown: text,
        }))
      )
    : null;
  return (
    <>
      <header className="flex h-[var(--page-shell-header-height)] shrink-0 items-center gap-3 border-b px-4 [-webkit-app-region:drag]">
        <Button
          aria-label={t("chat.subagent.back")}
          className="cursor-pointer [-webkit-app-region:no-drag]"
          onClick={onBack}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <ArrowLeftIcon />
        </Button>
        <SubagentAvatar
          agent={agent.meta.agent}
          agentThreadId={agent.meta.agentThreadId}
          size={20}
        />
        <h2 className="min-w-0 flex-1 truncate font-medium text-sm">
          {agent.meta.name}
        </h2>
      </header>
      <Conversation className="min-h-0 flex-1" initial="instant">
        <ChartConversationBoundary>
          <ConversationContent className="w-full max-w-none gap-4 px-4 py-7">
          <ElapsedLabel
            startedAt={agent.meta.spawnedAt}
            {...(active ? {} : { endedAt: agent.meta.lastActivityAt })}
          />
          {draft ? (
            <>
              <TurnParts
                onOpenSubagent={onOpenSubagent}
                parts={capped?.parts ?? draft.parts}
                streamingIds={
                  active ? new Set(draft.streaming.keys()) : new Set()
                }
                subagents={subagents}
              />
              {streaming.map(([itemId, text]) => (
                <MessageContent key={itemId}>
                  <MessageResponse
                    isAnimating={active && draft.streaming.has(itemId)}
                  >
                    {capped?.fragments.find(
                      (fragment) => fragment.id === `stream:${itemId}`
                    )?.markdown ?? text}
                  </MessageResponse>
                </MessageContent>
              ))}
              {active && (
                <ThinkingShimmer>{shimmerLabel(draft, false)}</ThinkingShimmer>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t("chat.subagent.detailLimit")}
            </p>
          )}
          </ConversationContent>
          <ConversationScrollButton />
        </ChartConversationBoundary>
      </Conversation>
    </>
  );
}
