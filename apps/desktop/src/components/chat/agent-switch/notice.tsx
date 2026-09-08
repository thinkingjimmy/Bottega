/**
 * [INPUT]: Depends on immutable switch notice coverage and the shared transcript divider
 * [OUTPUT]: Renders the retained Agent boundary and expandable history gaps
 * [POS]: Transcript switch identity; never infers authors from adjacent notices
 */

import type { AgentSwitchedNotice } from "../../../../shared/chat-agent/contracts";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { TranscriptDividerRow } from "../transcript/transcript-divider";
export function AgentSwitchNotice({ notice }: { notice: AgentSwitchedNotice }) {
  const { t } = useAppTranslation();
  return <div><TranscriptDividerRow role="separator"><AgentBackendIcon backend={notice.to} className="size-3.5" />
    <span>{t("chat.agentSwitch.divider", { backend: backendLabel(notice.to) })}</span>
  </TranscriptDividerRow><details className="mx-auto w-fit max-w-full text-muted-foreground text-xs">
    <summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-ring">{t("chat.agentSwitch.details")}</summary>
    <div className="max-w-lg space-y-1 py-2 leading-relaxed"><p>{t("chat.agentSwitch.explanation")}</p>
      {notice.context.notInjected && <p>{t("chat.agentSwitch.notInjected")}</p>}
      {notice.context.storageTrimmed && <p>{t("chat.agentSwitch.storageTrimmed")}</p>}
      {notice.context.lookup !== "available" && <p>{t("chat.agentSwitch.lookupUnavailable")}</p>}
    </div></details></div>;
}
