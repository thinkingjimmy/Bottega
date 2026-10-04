/**
 * [INPUT]: Published bounded conversation model, shared subagent views and private file port.
 * [OUTPUT]: Window-aware list/detail drill-down with imported-history disclosure.
 * [POS]: Read-only platform subagent panel; detail navigation does not add browser history.
 */
import { useMemo, useState } from "react";
import { useConversationModel } from "../../conversation/body/model";
import { mergeSubagents } from "../../conversation/subagents/merge";
import { SubagentList } from "../../conversation/subagents/list";
import { SubagentDetail } from "../../conversation/subagents/detail";
import { sidePanelCopy } from "../../../i18n/side-panel";
import type { TranscriptSource } from "../../../platform/contracts";
import type { ImageIdentity } from "../image/identity";
export function SubagentsTab({ chatId, source, locale, onOpenImage }: { chatId: string; source: TranscriptSource; locale: string; onOpenImage(identity: ImageIdentity): void }) {
  const model = useConversationModel(), copy = sidePanelCopy(locale), [path, setPath] = useState<string[]>([]);
  const agents = useMemo(() => mergeSubagents(model), [model]), selected = agents.find(agent => agent.meta.agentThreadId === path.at(-1));
  return <>
    {model.segments.some(segment => segment.kind === "imported") && <p role="note" className="px-4 pt-3 text-xs text-muted-foreground">{copy.importedUnavailable}</p>}
    {selected ? <SubagentDetail agent={selected} onBack={() => setPath(value => value.slice(0, -1))} onOpen={id => setPath(value => [...value, id])} chatId={chatId} source={source} locale={locale} onOpenImage={onOpenImage} />
      : <SubagentList subagents={Object.fromEntries(agents.map(agent => [agent.meta.agentThreadId, agent]))} onOpen={id => setPath([id])} copy={copy} locale={locale} empty={model.hasEarlier || !model.latest ? copy.subagentsEmptyWindow : copy.subagentsEmpty} />}
  </>;
}
