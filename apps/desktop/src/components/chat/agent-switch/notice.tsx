/**
 * [INPUT]: Depends on immutable switch identity, localized Agent labels, and the shared transcript divider
 * [OUTPUT]: Renders the retained Agent boundary without continuation details
 * [POS]: Transcript switch identity; never infers authors from adjacent notices
 */

import type { AgentSwitchedNotice } from "../../../../shared/chat-agent/contracts";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { TranscriptDividerRow } from "../transcript/transcript-divider";
export function AgentSwitchNotice({ notice }: { notice: AgentSwitchedNotice }) {
  const { t } = useAppTranslation();
  return <TranscriptDividerRow role="separator"><AgentBackendIcon backend={notice.to} className="size-3.5" />
    <span>{t("chat.agentSwitch.divider", { backend: backendLabel(notice.to) })}</span>
  </TranscriptDividerRow>;
}
