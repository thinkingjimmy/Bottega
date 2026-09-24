/**
 * [INPUT]: Depends on main-issued discard reviews, closed expiry/removal outcomes and accessible controls.
 * [OUTPUT]: Provides CredentialRecovery — the storage-retry / discard / web-account buttons laid inline for a row's control area, fresh confirmation after expiry and original-operation removal retry; a failed action is reported to the host through onFailure.
 * [POS]: Recovery outlet of the signed-out Sync row (or of the browser sign-in dialog while one is open); preserves account ownership and all local content.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import type { CloudAccountState } from "../../../../shared/cloud-ipc";
import { cloudAccountClient } from "@/lib/cloud/client";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsButton } from "@/components/settings/settings-layout";
export function CredentialRecovery({ state, onFailure }: { state: CloudAccountState; onFailure(failed: boolean): void }) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false), [review, setReview] = useState<{ reviewId: string } | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState<"removal" | "expired" | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null), failureRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (failed) failureRef.current?.focus(); }, [failed]);
  if (!state.canDiscardSavedLogin && !state.canRetryCredentialStorage && !open) return null;
  const inspect = async () => {
    if (busy) return; setBusy(true); onFailure(false);
    try { setReview(await cloudAccountClient().inspectSavedLoginDiscard()); setOpen(true); setFailed(null); }
    catch { onFailure(true); } finally { setBusy(false); }
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
    if (busy) return; setBusy(true); onFailure(false);
    try { await cloudAccountClient()[action](); } catch { onFailure(true); } finally { setBusy(false); }
  };
  /* Inline buttons, so the host row keeps one control area and says a failure in its own description. */
  return <>
    {state.canRetryCredentialStorage && <SettingsButton variant="outline" disabled={busy} onClick={() => { void run("retryCredentialStorage"); }}>{t("cloud.retryCredentialStorage")}</SettingsButton>}
    {state.canDiscardSavedLogin && <SettingsButton variant="outline" disabled={busy} onClick={() => { void inspect(); }}>{t("cloud.discardSavedLogin")}</SettingsButton>}
    <SettingsButton variant="ghost" disabled={busy} onClick={() => { void run("openCloudAccount"); }}>{t("cloud.openCloudAccount")}</SettingsButton>
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
  </>;
}
