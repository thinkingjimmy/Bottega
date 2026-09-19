/**
 * [INPUT]: Depends on Setup context, shared CheckIssue facts and presentation, prioritized actions, diagnostic feedback and i18n.
 * [OUTPUT]: Renders a detailed Agent Settings row with historical timestamps and local recovery.
 * [POS]: Settings availability surface; onboarding uses the separate installation-only list.
 */

import { useSetup } from "@/components/providers/setup-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { AgentBackendIcon } from "@/lib/agent-backends";
import type { BackendInfo } from "../../../shared/agent-ipc";
import type { CheckIssue } from "../../../shared/agent-availability/types";
import { BackendStatusBadge, backendSetupPresentation } from "./backend-parts";
import { BackendActions } from "./backend-actions";
import { SetupDiagnostics, SetupFeedbackNotice } from "./backend-feedback";

const checkIssueKeys = {
  timeout: "setup.checkIssue.timeout",
  connection: "setup.checkIssue.connection",
  busy: "setup.checkIssue.busy",
  failed: "setup.checkIssue.failed",
} as const satisfies Record<CheckIssue, string>;

export function SetupBackendRow({ backend }: { backend: BackendInfo }) {
  const setup = useSetup();
  const { t, i18n } = useAppTranslation();
  const presentation = backendSetupPresentation(backend, setup.now);
  const feedback = setup.feedback[backend.id];
  const hintKeys = {
    checking: "", unverified: "setup.verification.unverified", expired: "setup.verification.expired",
    failed: "setup.verification.failed", unsupported: "setup.verification.updateRequired",
    "sign-in": "setup.verification.signInRequired", "cannot-check": "setup.verification.cannotCheck",
    "cannot-start": "setup.verification.cannotStart", waiting: "setup.verification.waiting",
  };
  const hintKey = presentation.hint ? hintKeys[presentation.hint] : "";
  const hint = presentation.hint === "failed" && backend.availability?.checkIssue
    ? t(checkIssueKeys[backend.availability.checkIssue])
    : hintKey ? t(hintKey, { version: backend.version, minimum: backend.minimumVersion }) : "";
  const showCheckedAt = presentation.checkedAt !== undefined;
  return <div role="group" aria-label={backend.displayName} aria-busy={presentation.refreshing} className="px-4 py-3">
    <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
      <AgentBackendIcon backend={backend.id} className="size-4 shrink-0" />
      <span className="w-24 shrink-0 truncate font-medium text-sm">{backend.displayName}</span>
      <BackendStatusBadge tone={presentation.tone}>{t(presentation.labelKey)}</BackendStatusBadge>
      {backend.version && <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={backend.path}>{`v${backend.version}`}</span>}
      <BackendActions backend={backend} presentation={presentation} />
    </div>
    <div className="min-w-0 pl-7">
      {hint && <p className="pt-1 text-xs text-muted-foreground" role="status">{hint}</p>}
      {showCheckedAt && <p className="pt-1 text-[11px] text-muted-foreground">{t("setup.checkedAt", {
        time: new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "short", timeStyle: "short" }).format(presentation.checkedAt),
      })}</p>}
      {backend.reason && <SetupDiagnostics reason={backend.reason} />}
      {feedback && <div className="pt-2"><SetupFeedbackNotice feedback={feedback} disabled={Boolean(setup.busy[backend.id])}
        onRetry={() => void (feedback.kind === "clipboard" || feedback.operation === "check" || feedback.operation === "load"
          ? setup.recheckBackend(backend.id) : setup.terminalAction(backend.id, feedback.operation))} /></div>}
    </div>
  </div>;
}
