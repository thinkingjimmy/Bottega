/**
 * [INPUT]: Depends on i18n, the shared AppDialogContent shell, DialogChoice featured/plain option rows and choice group, Lucide icons, the selected backend's display name, and the chat composer recovery controller
 * [OUTPUT]: Provides a dismissible resume dialog and non-modal recovery entry, with request-scoped pending/error feedback and consequence-aware actions
 * [POS]: conversation/interactions' recovery dialog; closing it leaves the durable turn pending and its recovery entry reachable.
 */

import { useRef } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Play, RotateCcw, Trash2 } from "lucide-react";
import {
  AppDialogAlert,
  AppDialogContent,
  AppDialogHeader,
  DialogChoice,
  DialogChoiceGroup,
} from "@ai-chat/ui/components/ui/app-dialog";
import { Dialog } from "@ai-chat/ui/components/ui/dialog";
import type { ComposerTranslate } from "../../composer/controls/copy/translation";
export type ResumeFailureController = {
  resumeFailure: { retried: boolean; allowedActions: { sameSession: boolean; freshSession: boolean; abandon: boolean } } | null;
  resumeFailureOpen: boolean; resumeFailurePending: "sameSession" | "freshSession" | "abandon" | null;
  /** The failure's own line, already localized by the host; never a raw error. */
  resumeFailureError: string; selectedBackend?: { displayName: string };
  setResumeFailureOpen(open: boolean): void;
  retrySameSession(): Promise<unknown>; retryWithoutSession(): Promise<unknown>; abandonResumeFailure(): Promise<unknown>;
};

type ResumeAction = "sameSession" | "freshSession";

export function ResumeFailureDialog({
  controller, translate: t,
}: {
  controller: ResumeFailureController; translate: ComposerTranslate;
}) {
  const failure = controller.resumeFailure;
  const pending = controller.resumeFailurePending;
  const error = controller.resumeFailureError;
  const sameRef = useRef<HTMLButtonElement>(null);
  const freshRef = useRef<HTMLButtonElement>(null);
  const abandonRef = useRef<HTMLButtonElement>(null);
  const reopenRef = useRef<HTMLButtonElement>(null);

  const backend = controller.selectedBackend?.displayName ?? "Agent";
  const allowed = failure?.allowedActions;
  const retried = failure?.retried === true;
  // A failed retry prioritizes an alternate recovery; it does not establish that the source session was deleted.
  const leading: ResumeAction =
    retried && allowed?.freshSession ? "freshSession" : "sameSession";

  const isLeading = (key: ResumeAction) => leading === key;
  const sameSession = (
    <DialogChoice
      key="sameSession"
      ref={sameRef}
      variant={isLeading("sameSession") ? "featured" : "plain"}
      icon={<Play />}
      title={t(
        retried
          ? "chat.resumeFailure.sameSessionRetry"
          : "chat.resumeFailure.sameSession"
      )}
      detail={t(
        retried
          ? "chat.resumeFailure.sameSessionRetryDetail"
          : "chat.resumeFailure.sameSessionDetail"
      )}
      badge={
        leading === "sameSession"
          ? t("chat.resumeFailure.recommended")
          : undefined
      }
      busy={pending === "sameSession"}
      disabled={pending !== null || !allowed?.sameSession}
      onClick={() => void controller.retrySameSession()}
    />
  );

  const freshSession = (
    <DialogChoice
      key="freshSession"
      ref={freshRef}
      variant={isLeading("freshSession") ? "featured" : "plain"}
      icon={<RotateCcw />}
      title={t("chat.resumeFailure.freshSession")}
      // Keep unavailable actions visible with their reason.
      detail={t(
        allowed?.freshSession
          ? "chat.resumeFailure.freshSessionDetail"
          : "chat.resumeFailure.freshSessionBlocked"
      )}
      badge={
        leading === "freshSession"
          ? t("chat.resumeFailure.recommended")
          : undefined
      }
      busy={pending === "freshSession"}
      disabled={pending !== null || !allowed?.freshSession}
      onClick={() => void controller.retryWithoutSession()}
    />
  );

  if (!failure) return null;
  return (
    <>
    <div className="mb-3 flex items-center gap-3 rounded-xl border bg-muted/30 px-3 py-2" role="status">
      <div className="min-w-0 flex-1 text-xs">
        <p className="font-medium">{t("chat.resumeFailure.pendingTitle")}</p>
        <p className="mt-1 text-muted-foreground">{t("chat.resumeFailure.pendingDetail")}</p>
        {error && !controller.resumeFailureOpen && <p className="mt-1 text-destructive" role="alert">{error}</p>}
      </div>
      <Button ref={reopenRef} type="button" variant="outline" size="sm" onClick={() => controller.setResumeFailureOpen(true)}>
        {t("chat.resumeFailure.review")}
      </Button>
    </div>
    <Dialog open={controller.resumeFailureOpen} onOpenChange={controller.setResumeFailureOpen}>
      <AppDialogContent
        /* The × is the only exit here: the choice rows perform the actions and there is no footer Cancel (D6/D14). */
        showCloseButton
        onCloseAutoFocus={(event) => {
          if (!reopenRef.current?.isConnected) return;
          event.preventDefault();
          reopenRef.current.focus();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const preferred = leading === "freshSession" ? freshRef : sameRef;
          [preferred, sameRef, freshRef, abandonRef]
            .find((target) => target.current && !target.current.disabled)
            ?.current?.focus();
        }}
      >
        <AppDialogHeader
          className="min-h-0 overflow-y-auto"
          title={retried
            ? t("chat.resumeFailure.retriedTitle")
            : t("chat.resumeFailure.title", { backend })}
          description={retried
            ? t("chat.resumeFailure.retriedDescription", { backend })
            : t("chat.resumeFailure.description")}
        />

        <div className="mt-4 shrink-0">
          {leading === "freshSession" ? freshSession : sameSession}
          <DialogChoiceGroup label={t("chat.resumeFailure.otherOptions")}>
            {leading === "freshSession" ? sameSession : freshSession}
            <DialogChoice
              ref={abandonRef}
              variant="plain"
              tone="danger"
              icon={<Trash2 />}
              title={t("chat.resumeFailure.abandon")}
              detail={t("chat.resumeFailure.abandonDetail")}
              busy={pending === "abandon"}
              disabled={pending !== null || !allowed?.abandon}
              onClick={() => void controller.abandonResumeFailure()}
            />
          </DialogChoiceGroup>
        </div>

        {error && <AppDialogAlert className="shrink-0">{error}</AppDialogAlert>}
      </AppDialogContent>
    </Dialog>
    </>
  );
}
