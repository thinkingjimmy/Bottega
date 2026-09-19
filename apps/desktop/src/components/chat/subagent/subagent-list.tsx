/**
 * [INPUT]: Native subagent projections, shared list presentation and desktop locale.
 * [OUTPUT]: Desktop SubagentList adapter preserving native detail navigation.
 * [POS]: Native host over the shared subagent list.
 */
import type { ProjectedSubagent } from "@/lib/chat-turn-attach";
import { SubagentList as SharedList } from "@ai-chat/chat-ui/subagents/list";
import { sidePanelCopy } from "@ai-chat/chat-ui/side-panel-copy";
import { useAppTranslation } from "@/components/providers/i18n-provider";
export function SubagentList({ subagents, onOpen }: { subagents: Record<string, ProjectedSubagent>; onOpen(id: string): void }) {
  const { i18n, t } = useAppTranslation();
  const copy = { ...sidePanelCopy(i18n.language), subagentsEmpty: t("chat.subagent.empty"), detailUnavailable: t("chat.subagent.detailUnavailable"), detailLimit: t("chat.subagent.detailLimit"), starting: t("chat.subagent.starting"), noTranscript: t("chat.subagent.noTranscript"), active: t("chat.subagent.active"), done: t("chat.subagent.done") };
  const projected = Object.fromEntries(Object.entries(subagents).map(([id, agent]) => [id, { meta: agent.meta, detailState: agent.draft ? "available" as const : "unavailable" as const, draft: agent.draft ? { ...agent.draft, streaming: [...agent.draft.streaming] } : undefined }]));
  return <SharedList subagents={projected} onOpen={onOpen} locale={i18n.language} copy={copy} avatarLabel={agent => t("chat.subagent.avatarLabel", { agent })} />;
}
