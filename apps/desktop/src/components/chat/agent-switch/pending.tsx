/**
 * [INPUT]: Depends on pending Agent identity, canonical permission mode, and localized disclosure
 * [OUTPUT]: Renders the non-dismissible pending banner with undo, permission changes, and keyboard-accessible details
 * [POS]: Composer switch feedback; submitted operations remain visibly locked
 */

import type { AgentTurnOptions } from "../../../../shared/agent-ipc";
import type { PendingAgent } from "@/lib/chat-agent-draft/state";
import { backendLabel } from "@/lib/agent-backends";
import { useAppTranslation } from "@/components/providers/i18n-provider";
export function PendingAgentBanner({ pending, options, canonical, undo }: {
  pending: PendingAgent | null; options: AgentTurnOptions; canonical: AgentTurnOptions | null; undo(): void;
}) {
  const { t } = useAppTranslation();
  if (!pending) return null;
  return <div className="rounded-xl border bg-muted/30 px-3 py-2 text-xs" data-testid="pending-agent-switch">
    <div className="flex items-start justify-between gap-3">
      <p role="status" aria-live="polite">{pending.submitting ? t("chat.agentSwitch.confirming") : pending.stale
        ? t("chat.agentSwitch.stale") : t("chat.agentSwitch.pending", { backend: backendLabel(options.backend) })}</p>
      {!pending.submitting && <button type="button" onClick={undo} className="shrink-0 rounded px-2 py-1 underline underline-offset-4 focus-visible:outline focus-visible:outline-ring">{t("chat.agentSwitch.undo")}</button>}
    </div>
    {canonical && canonical.permissionMode !== options.permissionMode && <p className="mt-1 font-medium">{t("chat.agentSwitch.permission", {
      from: t(`permission.mode.${canonical.permissionMode}.label`), to: t(`permission.mode.${options.permissionMode}.label`),
    })}</p>}
    <details className="mt-1 text-muted-foreground"><summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-ring">{t("chat.agentSwitch.details")}</summary><p className="pt-1 leading-relaxed">{t("chat.agentSwitch.explanation")}</p></details>
  </div>;
}
