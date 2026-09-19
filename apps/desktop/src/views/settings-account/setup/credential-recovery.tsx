/**
 * [INPUT]: Depends on main-issued discard reviews, closed expiry/removal outcomes and accessible controls.
 * [OUTPUT]: Provides credential recovery, fresh confirmation after expiry and original-operation removal retry.
 * [POS]: Setup form step 1 recovery outlet; preserves account ownership and all local content.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import type { CloudAccountState } from "../../../../shared/cloud-ipc";
import { cloudAccountClient } from "@/lib/cloud/client";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsButton } from "@/components/settings/settings-layout";
export function CredentialRecovery({ state }: { state: CloudAccountState }) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false), [review, setReview] = useState<{ reviewId: string } | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState<"removal" | "expired" | null>(null), [actionFailed, setActionFailed] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null), failureRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (failed) failureRef.current?.focus(); }, [failed]);
  if (!state.canDiscardSavedLogin && !state.canRetryCredentialStorage && !open) return null;
  const inspect = async () => {
    if (busy) return; setBusy(true); setActionFailed(false);
    try { setReview(await cloudAccountClient().inspectSavedLoginDiscard()); setOpen(true); setFailed(null); }
    catch { setActionFailed(true); } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!review || busy) return; setBusy(true); setFailed(null);
    try {
      const result = await cloudAccountClient().discardSavedLogin(review);
      if (result.status === "review-expired") {
        setReview(null); setFailed("expired");
        // Refresh the disclosure only; a new review always needs another explicit confirmation.
        try { setReview(await cloudAccountClient().inspectSavedLoginDiscard()); } catch { /* Keep the review retry available. */ }
      } else { setOpen(false); setReview(null); }
    } catch { setFailed("removal"); } finally { setBusy(false); }
  };
  const run = async (action: "retryCredentialStorage" | "openCloudAccount") => {
    if (busy) return; setBusy(true); setActionFailed(false);
    try { await cloudAccountClient()[action](); } catch { setActionFailed(true); } finally { setBusy(false); }
  };
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      {state.canRetryCredentialStorage && <SettingsButton variant="outline" disabled={busy} onClick={() => { void run("retryCredentialStorage"); }}>{t("cloud.retryCredentialStorage")}</SettingsButton>}
      {state.canDiscardSavedLogin && <SettingsButton variant="outline" disabled={busy} onClick={() => { void inspect(); }}>{t("cloud.discardSavedLogin")}</SettingsButton>}
      <SettingsButton variant="ghost" disabled={busy} onClick={() => { void run("openCloudAccount"); }}>{t("cloud.openCloudAccount")}</SettingsButton>
    </div>
    {actionFailed && <p role="alert" className="text-sm text-destructive">{t("cloud.actionFailed")}</p>}
    <Dialog open={open} onOpenChange={next => { if (!busy) { setOpen(next); if (!next) setFailed(null); } }}>
      <DialogContent showCloseButton={!busy} onOpenAutoFocus={event => { event.preventDefault(); cancelRef.current?.focus(); }}
        onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>{t("cloud.discardSavedLoginTitle")}</DialogTitle>
          <DialogDescription>{t("cloud.discardSavedLoginDescription")}</DialogDescription></DialogHeader>
        {failed && <p ref={failureRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{failed === "expired" ? t("cloud.discardSavedLoginExpired") : t("cloud.discardSavedLoginFailed")}</p>}
        <DialogFooter><Button ref={cancelRef} variant="outline" disabled={busy} onClick={() => setOpen(false)}>{t("cloud.cancel")}</Button>
          <Button variant="destructive" disabled={busy} onClick={() => { void (review ? confirm() : inspect()); }}>{failed === "removal" || !review ? t("cloud.retry") : t("cloud.discardSavedLoginConfirm")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
