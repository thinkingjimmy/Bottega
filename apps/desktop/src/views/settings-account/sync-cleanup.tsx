/**
 * [INPUT]: Depends on the actual main cleanup inventory, shared copy, settings controls and the shared ConfirmationDialog.
 * [OUTPUT]: Provides CloudCleanupButton — sign out without deletion, or the reviewed Disable / switch-account confirmation stating what is removed, kept and left unsent.
 * [POS]: Account cleanup UI; a changed inventory requires a fresh review before main removes an account binding.
 */
import { useState } from "react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import type { SyncCleanupReview } from "../../../shared/cloud/sync";
import { cloudAccountClient } from "@/lib/cloud/client";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsButton } from "@/components/settings/settings-layout";
export function CloudCleanupButton({ mode, disabled, variant = "outline" }: {
  mode: "signOut" | "disableSync" | "switchAccount"; disabled?: boolean; variant?: "outline" | "ghost";
}) {
  const { t } = useAppTranslation(); const [review, setReview] = useState<SyncCleanupReview | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const switching = mode === "switchAccount";
  const label = t(mode === "signOut" ? "cloud.signOut" : switching ? "cloud.syncReview.switchAccount" : "cloud.syncReview.disable");
  const inspect = async () => {
    if (busy) return; setBusy(true); setFailed(false);
    try {
      if (mode === "signOut") { await cloudAccountClient().signOut(); return; }
      const client = cloudAccountClient();
      const value = await (switching ? client.inspectAccountSwitch() : client.inspectCleanup());
      if (value) setReview(value);
    } catch { setFailed(true); } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!review || busy) return; setBusy(true); setFailed(false);
    try { const client = cloudAccountClient();
      await client[switching ? "switchAccount" : "disableSync"]({ reviewId: review.reviewId });
      setReview(null);
    } catch { setFailed(true); } finally { setBusy(false); }
  };
  return <><SettingsButton type="button" variant={variant} className={variant === "ghost" ? "text-muted-foreground" : undefined} disabled={disabled || busy} onClick={() => { void inspect(); }}>{label}</SettingsButton>
    {failed && !review && <p role="alert" className="text-destructive text-xs">{t("cloud.actionFailed")}</p>}
    <ConfirmationDialog open={Boolean(review)} busy={busy} confirmTone={switching ? "default" : "destructive"}
      title={t(switching ? "cloud.syncReview.switchTitle" : "cloud.syncReview.disableTitle")}
      /* The question, then three facts — what goes, what stays, what was never sent —
         so the reader sees the consequence, not a paragraph they have to parse. */
      description={review && <>
        <p>{t(switching ? "cloud.syncReview.switchBody" : "cloud.syncReview.disableBody")}</p>
        <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-[18px] text-[13px]/[1.45] marker:text-muted-foreground/50">
          <li>{t("cloud.syncReview.disableRemove", review)}</li>
          <li>{t("cloud.syncReview.disableKeep", review)}</li>
          {review.pending > 0 && <li>{t("cloud.syncReview.pendingDiscard", { count: review.pending })}</li>}
        </ul>
        {failed && <p role="alert" className="mt-3 text-[13px]/[1.45] text-destructive">{t("cloud.actionFailed")}</p>}
      </>}
      cancelLabel={t("cloud.cancel")} confirmLabel={failed ? t("cloud.refresh") : switching ? label : t("cloud.syncReview.disableConfirm")}
      onOpenChange={open => { if (!open && !busy) { setReview(null); setFailed(false); } }}
      onConfirm={() => { void (failed ? inspect() : confirm()); }} />
  </>;
}
