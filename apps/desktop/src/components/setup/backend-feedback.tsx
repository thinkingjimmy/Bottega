/**
 * [INPUT]: Depends on typed Setup feedback, i18n and the shared diagnostic notice.
 * [OUTPUT]: Provides operation-specific feedback and selectable, copyable diagnostics.
 * [POS]: Shared recovery presentation for Agent rows and setup snapshot failures.
 */
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { ProductFailureNotice } from "@ai-chat/ui/components/feedback/failure-notice";
import { agentFailureNoticeLabels } from "@/components/agent-failure-notice";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { SetupFeedback } from "../../../shared/setup-ipc";

const feedbackTitleKeys = {
  load: "setup.feedback.load",
  check: "setup.feedback.check",
  install: "setup.feedback.install",
  update: "setup.feedback.update",
  login: "setup.feedback.login",
} as const satisfies Record<SetupFeedback["operation"], string>;

export function SetupFeedbackNotice({ feedback, onRetry, disabled }: {
  feedback: SetupFeedback; onRetry: () => void; disabled?: boolean;
}) {
  const { t } = useAppTranslation();
  const clipboard = feedback.kind === "clipboard";
  return <ProductFailureNotice compact tone={clipboard ? "warning" : "danger"}
    labels={agentFailureNoticeLabels(t)} copy={{
      title: clipboard ? t("setup.feedback.clipboard") : feedback.kind === "clipboard-failed" ? t("setup.feedback.clipboardFailed") : t(feedbackTitleKeys[feedback.operation]),
      explanation: clipboard ? t("setup.feedback.pasteCommand") : t("setup.feedback.retryHint"),
      resolution: "", diagnostic: feedback.diagnostic,
    }}>
    <Button variant="outline" size="sm" disabled={disabled} onClick={onRetry}>
      {t(clipboard ? "setup.completed" : "common.retry")}
    </Button>
  </ProductFailureNotice>;
}

export function SetupDiagnostics({ reason }: { reason: string }) {
  const { t } = useAppTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(reason); setCopied(true); }
    catch { /* The full diagnostic remains selectable when copying is unavailable. */ }
  };
  return <details className="group min-w-0 pt-1 text-xs text-muted-foreground">
    <summary className="w-fit cursor-pointer rounded-sm py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {t("agentFailure.technicalDetails")}
    </summary>
    <div className="mt-1 flex min-w-0 items-start gap-2 rounded-md border bg-muted/40 p-2">
      <pre className="max-h-40 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">{reason}</pre>
      <Button variant="ghost" size="icon-sm" onClick={() => void copy()}
        aria-label={t(copied ? "agentFailure.copiedDetails" : "agentFailure.copyDetails")}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  </details>;
}
