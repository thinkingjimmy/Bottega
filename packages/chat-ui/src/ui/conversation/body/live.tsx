/**
 * [INPUT]: Verified live projection, shared localized turn views, portable text budgets and host-owned detail navigation.
 * [OUTPUT]: Native-equivalent live content retained until its matching durable body arrives; interactions belong to the composer.
 * [POS]: Remote transcript adapter for the same draft/parts/Plan presentation used by native turns.
 */
import { MessageContent, MessageResponse } from "@ai-chat/ui/components/ai-elements/message";
import { formatConversationDuration } from "@ai-chat/ui/components/conversation/activity/format";
import { hydrateDraft, projectDraftPlan, shimmerLabel } from "@ai-chat/cloud-protocol/turns/reducer";
import type { ChatLiveView } from "../../../platform/model";
import type { ChatCopy } from "../../../i18n/copy";
import { ArtifactMessageRenderers } from "../../../artifacts/renderer";
import { ConversationDraft, ConversationElapsed } from "../turn/draft";
import { ConversationParts } from "../turn/parts";
import { TranscriptPlan } from "./message";
import { ConversationSubagent } from "../turn/subagent";
import { capPartMarkdown } from "../turn/projection";
import { planTranslation, turnCopy } from "../turn/copy";

export function LiveReply({ value, copy, canonicalReady, locale = "en", interactive, onOpenSubagent, onOpenPlan, expandedPlanId }: {
  value: ChatLiveView; copy: ChatCopy; canonicalReady: boolean; locale?: string; interactive?: boolean;
  onOpenSubagent?(id: string): void; onOpenPlan?(id: string): void; expandedPlanId?: string | null;
}) {
  const state = value.state, projection = value.projection;
  if (!state || state.receipt.settlementState === "settled" && (state.receipt.resultKind === "empty" || canonicalReady)) return null;
  const draft = projection && hydrateDraft(projection.draft), plan = draft && projectDraftPlan(draft);
  const parts = draft?.parts.filter(part => part.itemId !== plan?.itemId) ?? [];
  const index = plan ? draft!.parts.findIndex(part => part.itemId === plan.itemId) : -1;
  const streaming = [...(draft?.streaming ?? [])].filter(([id, text]) => text && id !== plan?.itemId && !parts.some(part => part.itemId === id));
  const capped = capPartMarkdown(parts, [...streaming.map(([id, markdown]) => ({ id, markdown })), ...(plan ? [{ id: plan.itemId, markdown: plan.content }] : [])]);
  const text = (id: string, fallback: string) => capped.fragments.find(fragment => fragment.id === id)?.markdown ?? fallback;
  const active = state.state === "running" && state.receipt.settlementState === "open" && !projection?.terminal;
  const hasContent = Boolean(parts.length || streaming.length || plan), planId = state.receipt.assistantMessageId;
  const render = (values: typeof parts) => values.length > 0 && <ConversationParts parts={values} streamingIds={new Set(draft?.streaming.keys())}
    subagent={part => {
      const agent = projection?.subagents.find(item => item.meta.agentThreadId === part.agentThreadId);
      return <ConversationSubagent id={part.agentThreadId} agent={agent?.meta.agent ?? part.agent}
        name={agent?.meta.name || part.name || copy.subagent} status={agent?.meta.status ?? part.status}
        disabled={!agent?.draft || !onOpenSubagent} title={!agent?.draft ? copy.unavailableDetail : undefined}
        onOpen={onOpenSubagent ? () => onOpenSubagent(part.agentThreadId) : undefined} />;
    }} />;
  return <section className="min-w-0" data-live-reply=""><ArtifactMessageRenderers>
    <ConversationDraft active={active} editingPlan={Boolean(plan?.editing && active)}
      label={draft ? shimmerLabel(draft, Boolean(projection?.approvals.length || projection?.userInputs.length)) : turnCopy(locale).thinking}
      elapsed={draft && hasContent && <ConversationElapsed startedAt={draft.startedAt}
        endedAt={state.terminalSeenAt ?? undefined}
        label={duration => turnCopy(locale).workingFor.replace("{{duration}}", formatConversationDuration(duration, locale))} />}>
      {render(index >= 0 ? capped.parts.slice(0, index) : capped.parts)}
      {plan && <TranscriptPlan content={text(plan.itemId, plan.content)} editing={plan.editing && active} copyable={false} translate={planTranslation(locale)}
        isExpanded={expandedPlanId === planId} onToggle={onOpenPlan ? () => onOpenPlan(planId) : undefined} />}
      {index >= 0 && render(capped.parts.slice(index))}
      {streaming.map(([id, content]) => <MessageContent key={id}><MessageResponse isAnimating={active}>{text(id, content)}</MessageResponse></MessageContent>)}
      {!interactive && Boolean(projection?.approvals.length || projection?.userInputs.length) && <p className="text-sm text-muted-foreground">{copy.interactions}</p>}
    </ConversationDraft>
  </ArtifactMessageRenderers></section>;
}
