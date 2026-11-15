/**
 * [INPUT]: Depends on shared Dialog, Button, App enablement copy including missing Chat titles, and host-provided impact/counts.
 * [OUTPUT]: Provides AppDisableDialog with host-owned close autofocus, without owning execution or data authority.
 * [POS]: Approved desktop/Web/phone confirmation; the host owns preview freshness and cancellation.
 */
import type { ComponentProps } from "react";
import { Dialog } from "../ui/overlays/dialog";
import { AppDialogCancel, AppDialogContent, AppDialogFooter, AppDialogHeader } from "../ui/overlays/app-dialog";
import { Button } from "../ui/controls/button";
import { appEnablementCopy, enablementLine } from "../../lib/app-enablement/copy";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
export function AppDisableDialog({ name, locale, impact, busy, confirmDisabled, error, onConfirm, onClose, onCloseAutoFocus }: {
  name: string; locale: string; impact: { runningCount: number; runningChats: readonly { id: string; title: string }[]; queuedMessages: number } | null;
  busy: boolean; confirmDisabled?: boolean; error?: string; onConfirm(): void; onClose(): void;
  onCloseAutoFocus?: ComponentProps<typeof AppDialogContent>["onCloseAutoFocus"];
}) {
  const copy = appEnablementCopy(locale);
  return <Dialog open={impact !== null} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <AppDialogContent onCloseAutoFocus={onCloseAutoFocus} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
      <AppDialogHeader title={enablementLine(copy.title, { app: name })} description={copy.retained}/>
      {impact && <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>{copy.windows}</li><li>{enablementLine(copy.running, { count: impact.runningCount })}
          {impact.runningChats.length > 0 && <ul className="mt-1 list-none space-y-1 pl-0">{impact.runningChats.map(chat => <li key={chat.id} className="truncate">{chat.title || copy.chatFallback}</li>)}{impact.runningCount > impact.runningChats.length && <li>{enablementLine(copy.moreRunning, { count: impact.runningCount - impact.runningChats.length })}</li>}</ul>}
        </li><li>{enablementLine(copy.queued, { count: impact.queuedMessages })}</li>
      </ul>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <AppDialogFooter><AppDialogCancel disabled={busy} onClick={onClose}>{copy.cancel}</AppDialogCancel>
        <Button size="pill" disabled={busy || confirmDisabled || !impact} onClick={onConfirm}>{busy && <Spinner />}{copy.confirm}</Button></AppDialogFooter>
    </AppDialogContent>
  </Dialog>;
}
