/**
 * [INPUT]: Depends on typed Setup feedback, i18n and the shared diagnostic notice.
 * [OUTPUT]: Provides operation-specific feedback with its retry or clipboard-completion action.
 * [POS]: Shared recovery presentation for Agent rows and setup snapshot failures.
 */
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
