/**
 * [INPUT]: Depends on shared Dialog, Button, App enablement copy including missing Chat titles, and host-provided impact/counts.
 * [OUTPUT]: Provides AppDisableDialog with host-owned close autofocus, without owning execution or data authority.
 * [POS]: Approved desktop/Web/phone confirmation; the host owns preview freshness and cancellation.
 */
import type { ComponentProps } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/overlays/dialog";
import { Button } from "../ui/controls/button";
import { appEnablementCopy, enablementLine } from "../../lib/app-enablement/copy";
export function AppDisableDialog({ name, locale, impact, busy, confirmDisabled, error, onConfirm, onClose, onCloseAutoFocus }: {
  name: string; locale: string; impact: { runningCount: number; runningChats: readonly { id: string; title: string }[]; queuedMessages: number } | null;
  busy: boolean; confirmDisabled?: boolean; error?: string; onConfirm(): void; onClose(): void;
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>["onCloseAutoFocus"];
}) {
  const copy = appEnablementCopy(locale);
  return <Dialog open={impact !== null} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent onCloseAutoFocus={onCloseAutoFocus} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }} showCloseButton={!busy}>
      <DialogHeader><DialogTitle>{enablementLine(copy.title, { app: name })}</DialogTitle><DialogDescription>{copy.retained}</DialogDescription></DialogHeader>
      {impact && <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>{copy.windows}</li><li>{enablementLine(copy.running, { count: impact.runningCount })}
          {impact.runningChats.length > 0 && <ul className="mt-1 list-none space-y-1 pl-0">{impact.runningChats.map(chat => <li key={chat.id} className="truncate">{chat.title || copy.chatFallback}</li>)}{impact.runningCount > impact.runningChats.length && <li>{enablementLine(copy.moreRunning, { count: impact.runningCount - impact.runningChats.length })}</li>}</ul>}
        </li><li>{enablementLine(copy.queued, { count: impact.queuedMessages })}</li>
      </ul>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" className="max-md:min-h-11" disabled={busy} onClick={onClose}>{copy.cancel}</Button>
        <Button className="max-md:min-h-11" disabled={busy || confirmDisabled || !impact} onClick={onConfirm}>{busy ? copy.closing : copy.confirm}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
