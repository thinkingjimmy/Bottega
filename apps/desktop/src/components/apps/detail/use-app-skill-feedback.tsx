/**
 * [INPUT]: Depends on React, AppsProvider retry intent, App skill status, i18n, error projection, and shared feedback toast primitives.
 * [OUTPUT]: Provides useAppSkillFeedback with attempt-scoped dismissal, single-flight retry, and persistent menu recovery state.
 * [POS]: App detail recovery owner; the page menu and top-center toast share one retry operation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { FeedbackToast, FeedbackToastAction, showFeedbackToast, toast } from "@ai-chat/ui/components/ui/sonner";
import { useApps } from "@/components/providers/apps-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import type { AppRecordProjection } from "../../../../shared/apps-ipc";

export function useAppSkillFeedback(record: Pick<AppRecordProjection, "id" | "state" | "skillStatus">) {
  const { t } = useAppTranslation();
  const { retrySkill } = useApps();
  const appId = record.id;
  const failed = record.state === "ready" && record.skillStatus?.state === "failed";
  const noticeId = `app-skill:${appId}:${record.skillStatus?.turnIntentId ?? ""}`;
  const [feedbackRevision, setFeedbackRevision] = useState(0);
  const toastId = `${noticeId}:${feedbackRevision}`;
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<{ id: string; message: string } | null>(null);
  const retryingRef = useRef(false);

  const retry = useCallback(async () => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    // A dismissed Sonner item keeps its exit animation; reopening needs a new identity.
    const retryToastId = dismissedId === toastId ? `${noticeId}:${feedbackRevision + 1}` : toastId;
    if (dismissedId === toastId) setFeedbackRevision(feedbackRevision + 1);
    setRetrying(true);
    setRetryError(null);
    setDismissedId(null);
    try {
      await retrySkill(appId);
      setDismissedId(retryToastId);
    } catch (cause) {
      setRetryError({ id: noticeId, message: errorMessage(cause) });
    } finally {
      retryingRef.current = false;
      setRetrying(false);
    }
  }, [appId, dismissedId, feedbackRevision, noticeId, retrySkill, toastId]);

  useEffect(() => {
    if (!failed || dismissedId === toastId) {
      toast.dismiss(toastId);
      return;
    }
    const dismiss = () => setDismissedId(toastId);
    showFeedbackToast((id) => (
      <FeedbackToast
        data-app-skill-feedback={appId}
        icon={retrying ? <LoaderCircle className="motion-safe:animate-spin" /> : <CircleAlert />}
        title={t("apps.baseDetail.skillFailed")}
        description={retryError?.id === noticeId ? retryError.message : undefined}
        onDismiss={() => { dismiss(); toast.dismiss(id); }}
      >
        <FeedbackToastAction disabled={retrying} onClick={() => void retry()}>
          {t("common.retry")}
        </FeedbackToastAction>
      </FeedbackToast>
    ), {
      id: toastId,
      ...(retrying ? { duration: Infinity } : {}),
      onDismiss: dismiss,
      onAutoClose: dismiss,
    });
  }, [appId, dismissedId, failed, noticeId, retry, retryError, retrying, t, toastId]);

  useEffect(() => () => { toast.dismiss(toastId); }, [toastId]);

  return { failed, retry, retrying };
}
