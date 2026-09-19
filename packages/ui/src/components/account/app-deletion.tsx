/**
 * [INPUT]: Depends on explicit deletion state, controlled retention consent and shared localized copy.
 * [OUTPUT]: Presents all-device App deletion with immutable retries and fresh review after conflicts or definitive expiry.
 * [POS]: Pure shared confirmation UI; platform adapters own authorization, requests and receipts.
 */
import { useId } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import type { CloudCopy } from "../../lib/cloud-copy/en";
export type AppDeletionPhase = "reviewing" | "ready" | "submitting" | "unknown" | "conflicted" | "blocked" | "failed" | "expired" | "confirmed";
type AppDeletionDialogProps = {
  name: string; phase: AppDeletionPhase; connected: boolean; retainBase: boolean; copy: CloudCopy["appDeletion"];
  onRetainBaseChange(value: boolean): void; onConfirm(): void; onRetry(): void; onReview(): void; onClose(): void;
};
export function AppDeletionDialog({ name, phase, connected, retainBase, copy, onRetainBaseChange, onConfirm, onRetry, onReview, onClose }: AppDeletionDialogProps) {
  const id = useId(), busy = phase === "submitting", reviewable = ["conflicted", "blocked", "failed", "expired"].includes(phase);
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent showCloseButton={!busy} className="max-h-[90dvh] overflow-y-auto">
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (phase === "ready" && connected) onConfirm(); }}>
        <DialogHeader className="pr-8"><DialogTitle>{copy.title.replace("{{name}}", name)}</DialogTitle>
          <DialogDescription>{copy.details}</DialogDescription></DialogHeader>
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
        <DialogFooter>
          <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={onClose}>{copy.close}</Button>
          {reviewable ? <Button type="button" variant="outline" className="min-h-11" disabled={!connected} onClick={onReview}>{copy.review}</Button> :
            phase === "unknown" ? <Button type="button" className="min-h-11" disabled={!connected} onClick={onRetry}>{copy.retry}</Button> :
              phase !== "confirmed" && <Button type="submit" variant="destructive" className="min-h-11" disabled={phase !== "ready" || !connected}>{busy ? copy.deleting : copy.confirm}</Button>}
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
