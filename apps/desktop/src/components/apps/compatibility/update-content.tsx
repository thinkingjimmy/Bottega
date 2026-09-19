/**
 * [INPUT]: Depends on main-owned return requests, explicit update confirmation and the shared reminder.
 * [OUTPUT]: Presents standalone lifecycle compatibility failures and resumes the original installed App.
 * [POS]: Root-level lifecycle reminder; install and share dialogs retain their own replacement content.
 */
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { AppCompatibilityRequiredError,applyAppCompatibility,resumeAppCompatibility } from "@/lib/apps-client";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { useState } from "react";
import type { AppCompatibilityFailure } from "../../../../shared/app-host/contract";
import { CompatibilityReminder } from "./reminder";

export default function CompatibilityUpdateContent({ initial, returnFocus }: { initial: AppCompatibilityFailure; returnFocus: HTMLElement | null }) {
  const { t } = useAppTranslation();
  const [failure, setFailure] = useState<AppCompatibilityFailure | null>(initial);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (apply = false) => {
    if (!failure?.requestId || busy) return;
    setBusy(true); setError("");
    try {
      const result = apply ? await applyAppCompatibility(failure.requestId) : await resumeAppCompatibility(failure.requestId);
      if (result.kind === "updated") setFailure(null);
      else if (result.kind === "installed-update") setReady(true);
      else setError(t("appHost.candidateUnavailable"));
    } catch (cause) {
      if (cause instanceof AppCompatibilityRequiredError) { setFailure(cause.compatibility); setReady(false); }
      else setError(errorMessage(cause, t("appHost.candidateUnavailable")));
    } finally { setBusy(false); }
  };
  return <Dialog open={Boolean(failure)} onOpenChange={(open) => { if (!open && !busy) setFailure(null); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto" onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus?.focus(); }}>
      {failure && (ready ? <>
        <DialogHeader><DialogTitle>{failure.candidate.appName}</DialogTitle><DialogDescription>{t(failure.candidate.hasUsableVersion ? "appHost.oldVersionUsable" : "appHost.resume")}</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setFailure(null)}>{t("appHost.cancel")}</Button><Button disabled={busy} onClick={() => void run(true)}>{t("appHost.resume")}</Button></DialogFooter>
      </> : <CompatibilityReminder failure={failure} busy={busy} onClose={() => setFailure(null)} onRetry={() => void run()} />)}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </DialogContent>
  </Dialog>;
}
