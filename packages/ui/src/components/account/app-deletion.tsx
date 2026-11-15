/**
 * [INPUT]: Depends on explicit deletion state, controlled retention consent and shared localized copy.
 * [OUTPUT]: Presents all-device App deletion with immutable retries, fresh conflict review and host-owned focus restoration.
 * [POS]: Pure shared confirmation UI; platform adapters own authorization, requests and receipts.
 */
import { useId, type ComponentProps } from "react";
import { Button } from "../ui/controls/button";
import { Dialog } from "../ui/overlays/dialog";
import { AppDialogCancel, AppDialogContent, AppDialogFooter, AppDialogHeader } from "../ui/overlays/app-dialog";
import type { CloudCopy } from "../../lib/cloud-copy/en";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
export type AppDeletionPhase = "reviewing" | "ready" | "submitting" | "unknown" | "conflicted" | "blocked" | "failed" | "expired" | "confirmed";
type AppDeletionDialogProps = {
  name: string; phase: AppDeletionPhase; connected: boolean; retainBase: boolean; copy: CloudCopy["appDeletion"];
  onRetainBaseChange(value: boolean): void; onConfirm(): void; onRetry(): void; onReview(): void; onClose(): void;
  onCloseAutoFocus?: ComponentProps<typeof AppDialogContent>["onCloseAutoFocus"];
};
export function AppDeletionDialog({ name, phase, connected, retainBase, copy, onRetainBaseChange, onConfirm, onRetry, onReview, onClose, onCloseAutoFocus }: AppDeletionDialogProps) {
  const id = useId(), busy = phase === "submitting", reviewable = ["conflicted", "blocked", "failed", "expired"].includes(phase);
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <AppDialogContent onCloseAutoFocus={onCloseAutoFocus} className="max-h-[90dvh]">
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (phase === "ready" && connected) onConfirm(); }}>
        <AppDialogHeader title={copy.title.replace("{{name}}", name)} description={copy.details}/>
        <fieldset disabled={phase !== "ready" || !connected} className="space-y-2">
          <legend className="mb-2 text-sm font-medium">{copy.dataChoice}</legend>
          {([true, false] as const).map(retain => <label key={String(retain)} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:disabled]:cursor-default">
            <input type="radio" name={id} className="mt-1 size-4 shrink-0 accent-primary" checked={retainBase === retain} onChange={() => onRetainBaseChange(retain)} />
            <span className="text-sm"><span className="block font-medium">{retain ? copy.keepData : copy.deleteData}</span>
              <span className="mt-1 block text-muted-foreground">{retain ? copy.keepDetails : copy.deleteDetails}</span></span>
          </label>)}
        </fieldset>
        <p className="text-sm text-muted-foreground">{copy.localFiles}</p>
        {!connected && <p role="status" className="text-sm">{copy.offline}</p>}
        {phase === "reviewing" && <p role="status" className="text-sm">{copy.reviewing}</p>}
        {["unknown", "conflicted", "blocked", "failed", "expired"].includes(phase) && <p role="alert" className="text-sm text-destructive">{copy[phase as "unknown" | "conflicted" | "blocked" | "failed" | "expired"]}</p>}
        {phase === "confirmed" && <p role="status" className="text-sm">{copy.confirmed}</p>}
        <AppDialogFooter>
          <AppDialogCancel type="button" disabled={busy} onClick={onClose}>{copy.close}</AppDialogCancel>
          {reviewable ? <Button type="button" size="pill" variant="outline" disabled={!connected} onClick={onReview}>{copy.review}</Button> :
            phase === "unknown" ? <Button type="button" size="pill" disabled={!connected} onClick={onRetry}>{copy.retry}</Button> :
              phase !== "confirmed" && <Button type="submit" size="pill" variant="destructive" disabled={phase !== "ready" || !connected}>{busy && <Spinner />}{copy.confirm}</Button>}
        </AppDialogFooter>
      </form>
    </AppDialogContent>
  </Dialog>;
}
