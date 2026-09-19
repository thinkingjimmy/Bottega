/**
 * [INPUT]: Merged subagent detail, nested navigation and the injected transcript file reader.
 * [OUTPUT]: SubagentDetailHeader, SubagentDetailFrame and read-only SubagentDetail with shared artifact-aware parts, streaming text and nested drill-down.
 * [POS]: conversation/subagents' detail panel; commands and execution authority remain outside this view.
 */
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { MessageResponse } from "@ai-chat/ui/components/ai-elements/message";
import { ToolRow } from "@ai-chat/ui/components/conversation/activity/tools";
import type { TranscriptSource } from "../../../platform/contracts";
import { chatCopy } from "../../../i18n/copy";
import { sidePanelCopy } from "../../../i18n/side-panel";
import { TranscriptParts } from "../body/message";
import { ArtifactMessageRenderers } from "../../../artifacts/renderer";
import type { ImageIdentity } from "../../side-panel/image/identity";
import { SubagentAvatar } from "./avatar";
import type { SubagentProjection } from "./merge";
export function SubagentDetailHeader({ meta, onBack, backLabel, avatar }: { meta: SubagentProjection["meta"]; onBack(): void; backLabel: string; avatar?: ReactNode }) {
  return <header className="flex h-[var(--page-shell-header-height)] shrink-0 items-center gap-3 border-b px-4 [-webkit-app-region:drag]">
    <Button aria-label={backLabel} className="cursor-pointer [-webkit-app-region:no-drag] max-lg:min-h-11 max-lg:min-w-11" onClick={onBack} size="icon-sm" type="button" variant="ghost"><ArrowLeft /></Button>
    {avatar ?? <SubagentAvatar agentThreadId={meta.agentThreadId} agent={meta.agent} size={20} />}
    <h2 className="min-w-0 flex-1 truncate font-medium text-sm">{meta.name}</h2>
  </header>;
}
export function SubagentDetailFrame({ agent, onBack, backLabel, children }: { agent: SubagentProjection; onBack(): void; backLabel: string; children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col"><SubagentDetailHeader meta={agent.meta} onBack={onBack} backLabel={backLabel} />
    <SlimScroller className="min-h-0 flex-1 overflow-y-auto px-4 py-7 text-sm">{children}</SlimScroller></div>;
}
export function SubagentDetail({ agent, onBack, onOpen, chatId, source, locale, onOpenImage }: {
  agent: SubagentProjection; onBack(): void; onOpen(id: string): void; chatId: string; source: Pick<TranscriptSource, "file">; locale: string; onOpenImage?(identity: ImageIdentity): void;
}) {
  const copy = sidePanelCopy(locale);
  return <ArtifactMessageRenderers><SubagentDetailFrame agent={agent} onBack={onBack} backLabel={copy.backToList}>
    {agent.body && agent.draft ? <TranscriptParts body={agent.body} chatId={chatId} parts={agent.body.subagents?.[agent.meta.agentThreadId]?.parts ?? []} parents={[agent.meta.agentThreadId]} source={source} copy={chatCopy(locale)} locale={locale} onOpenImage={onOpenImage} onOpenSubagent={onOpen} />
      : agent.draft?.parts.map(part => part.type === "text" ? <MessageResponse key={part.itemId}>{part.text}</MessageResponse>
        : part.type === "subagent" ? <Button key={part.itemId} variant="ghost" onClick={() => onOpen(part.agentThreadId)}>{part.name}</Button> : <ToolRow key={part.itemId} part={part} />)}
    {agent.draft?.streaming.map(([id, text]) => <MessageResponse key={id} isAnimating>{text}</MessageResponse>)}
    {!agent.draft && <p>{copy.detailUnavailable}</p>}
  </SubagentDetailFrame></ArtifactMessageRenderers>;
}
