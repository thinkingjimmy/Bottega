/**
 * [INPUT]: Depends on pending Agent submission custody and localized recovery copy
 * [OUTPUT]: Renders only unresolved submission status or a stale-selection recovery action
 * [POS]: Composer switch feedback; ordinary selections stay in the Agent picker
 */

import type { PendingAgent } from "@/lib/chat-agent-draft/state";
import { useAppTranslation } from "@/components/providers/i18n-provider";
export function PendingAgentStatus({ pending, undo }: {
  pending: PendingAgent | null; undo(): void;
}) {
  const { t } = useAppTranslation();
  if (!pending || (!pending.submitting && !pending.stale)) return null;
  return <div className="rounded-xl border bg-muted/30 px-3 py-2 text-xs" data-testid="pending-agent-switch">
    <div className="flex items-start justify-between gap-3">
      <p role="status" aria-live="polite">{pending.submitting ? t("chat.agentSwitch.confirming") : t("chat.agentSwitch.stale")}</p>
      {!pending.submitting && <button type="button" onClick={undo} className="touch-target-44 shrink-0 rounded px-2 py-1 underline underline-offset-4 focus-visible:outline focus-visible:outline-ring">{t("chat.agentSwitch.undo")}</button>}
    </div>
  </div>;
}
