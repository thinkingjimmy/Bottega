/**
 * [INPUT]: Depends on i18n, ConfirmationDialog, and the chat composer recovery controller
 * [OUTPUT]: Provides a non-dismissible ResumeFailureDialog with explicit retry, fresh-session, and abandon actions
 * [POS]: The recovery decision boundary in chat/composer; a failed durable turn always retains an immediately reachable decision surface
 */

import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { ChatSessionController } from "../runtime/use-chat-session";

type ResumeFailureController = Pick<
  ChatSessionController["composer"],
  | "resumeFailure"
  | "settingsSaving"
  | "retrySameSession"
  | "retryWithoutSession"
  | "abandonResumeFailure"
>;

export function ResumeFailureDialog({
  controller,
}: {
  controller: ResumeFailureController;
}) {
  const { t } = useAppTranslation();
  const failure = controller.resumeFailure;
  return (
    <ConfirmationDialog
      open={Boolean(failure)}
      title={t("chat.resumeFailure.title")}
      description={t("chat.resumeFailure.description")}
      confirmLabel={t("chat.resumeFailure.sameSession")}
      confirmDisabled={!failure?.allowedActions.sameSession}
      secondaryLabel={failure?.allowedActions.freshSession
        ? t("chat.resumeFailure.freshSession")
        : undefined}
      destructiveLabel={failure?.allowedActions.abandon
        ? t("chat.resumeFailure.abandon")
        : undefined}
      busy={controller.settingsSaving}
      dismissible={false}
      initialFocus="confirm"
      showCancel={false}
      onOpenChange={() => undefined}
      onConfirm={() => void controller.retrySameSession()}
      onSecondary={() => void controller.retryWithoutSession()}
      onDestructive={controller.abandonResumeFailure}
    />
  );
}
