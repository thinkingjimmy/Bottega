/**
 * [INPUT]: Depends on App i18n, ProjectedSubagent projections, Conversation, shared TurnParts, ThinkingShimmer, Button, and SubagentAvatar
 * [OUTPUT]: Provides SubagentPanel to unify 20px headers, share ElapsedLabel to show read-only flow details from the memoized subagentDraftView and return list entries
 * [POS]: The tabs for chat/subagent are detailed; Panel Tabs, transcript renderer, is used to close the panel
 */

import { SubagentDetailHeader } from "@ai-chat/chat-ui/subagents/detail";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@ai-chat/ui/components/ai-elements/conversation";
import { MessageContent, MessageResponse } from "@ai-chat/ui/components/ai-elements/message";
import { ThinkingShimmer } from "@ai-chat/ui/components/ai-elements/thinking-shimmer";
import type {
  ProjectedSubagent,
} from "@/lib/chat/session/chat-turn-attach";
import { shimmerLabel } from "../../../../shared/chats/model/chat-turn-reducer";
import { ElapsedLabel, TurnParts } from "../transcript/turns/chat-turn";
import { SubagentAvatar } from "./subagent-avatar";
import { subagentDraftView } from "./subagent-draft-view";
import { ChartConversationBoundary } from "@/components/charts/chart-scroll-root";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";

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
  // D-17: an event for another subagent, or a meta change, reuses this view instead of re-capping every part.
  const view = draft ? subagentDraftView(draft, active) : null;
  return (
    <>
      <SubagentDetailHeader meta={agent.meta} onBack={onBack} backLabel={t("chat.subagent.back")}
        avatar={<SubagentAvatar agent={agent.meta.agent} agentThreadId={agent.meta.agentThreadId} size={20} />} />
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
                parts={view!.parts}
                streamingIds={view!.streamingIds}
                subagents={subagents}
              />
              {view!.streaming.map(([itemId, text]) => (
                <MessageContent key={itemId}>
                  <MessageResponse
                    isAnimating={active && draft.streaming.has(itemId)}
                  >
                    {view!.fragment(itemId) ?? text}
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
