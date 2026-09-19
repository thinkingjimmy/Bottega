/**
 * [INPUT]: Depends on i18n, the shared AppDialogContent shell and DialogChoice option row, the selected backend's display name, and the chat composer recovery controller
 * [OUTPUT]: Provides a dismissible resume dialog and non-modal recovery entry, with request-scoped pending/error feedback and consequence-aware actions
 * [POS]: conversation/interactions' recovery dialog; closing it leaves the durable turn pending and its recovery entry reachable.
 */

import { useRef } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  AppDialogContent,
  DialogChoice,
} from "@ai-chat/ui/components/ui/app-dialog";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import type { ComposerTranslate } from "../../composer/controls/copy/translation";
export type ResumeFailureController = {
  resumeFailure: { retried: boolean; allowedActions: { sameSession: boolean; freshSession: boolean; abandon: boolean } } | null;
  resumeFailureOpen: boolean; resumeFailurePending: "sameSession" | "freshSession" | "abandon" | null;
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

  const sameSession = (
    <DialogChoice
      key="sameSession"
      ref={sameRef}
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
        {error && !controller.resumeFailureOpen && <p className="mt-1 text-destructive" role="alert">{t("chat.resumeFailure.actionFailed", { message: error })}</p>}
      </div>
      <Button ref={reopenRef} type="button" variant="outline" size="sm" onClick={() => controller.setResumeFailureOpen(true)}>
        {t("chat.resumeFailure.review")}
      </Button>
    </div>
    <Dialog open={controller.resumeFailureOpen} onOpenChange={controller.setResumeFailureOpen}>
      <AppDialogContent
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
        <DialogHeader className="min-h-0 gap-0 overflow-y-auto text-left">
          <DialogTitle className="text-xl/7 font-semibold">
            {retried
              ? t("chat.resumeFailure.retriedTitle")
              : t("chat.resumeFailure.title", { backend })}
          </DialogTitle>
          <DialogDescription className="mt-3 text-[15px]/[1.4] text-muted-foreground">
            {retried
              ? t("chat.resumeFailure.retriedDescription", { backend })
              : t("chat.resumeFailure.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid shrink-0 gap-2">
          {leading === "freshSession"
            ? [freshSession, sameSession]
            : [sameSession, freshSession]}
          <DialogChoice
            ref={abandonRef}
            tone="danger"
            title={t("chat.resumeFailure.abandon")}
            detail={t("chat.resumeFailure.abandonDetail")}
            busy={pending === "abandon"}
            disabled={pending !== null || !allowed?.abandon}
            onClick={() => void controller.abandonResumeFailure()}
          />
        </div>

        {error && (
          <p className="mt-3 shrink-0 text-[13px] text-destructive" role="alert">
            {t("chat.resumeFailure.actionFailed", { message: error })}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="ghost" onClick={() => controller.setResumeFailureOpen(false)}>
            {t("chat.resumeFailure.later")}
          </Button>
        </div>
      </AppDialogContent>
    </Dialog>
    </>
  );
}
