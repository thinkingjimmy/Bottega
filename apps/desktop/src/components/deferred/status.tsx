/**
 * [INPUT]: Application translations, Button and Dialog primitives.
 * [OUTPUT]: DeferredStatus and DeferredDialog with loading, failure, retry and close controls.
 * [POS]: Shared renderer feedback for demand-loaded settings and workflow panels.
 */
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
export function DeferredStatus({ failed, retry, reloadRequired = false }: { failed: boolean; retry(): void; reloadRequired?: boolean }) {
  const { t } = useAppTranslation();
  return <div className="space-y-3 p-4" role={failed ? "alert" : "status"}>
    <p className="text-sm text-muted-foreground">{t(failed ? "cloud.loadFailed" : "common.loadingView")}</p>
    {failed && <Button variant="outline" onClick={retry}>{t(reloadRequired ? "chat.browser.reload" : "common.retry")}</Button>}
  </div>;
}
export function DeferredDialog({ title, failed, retry, onClose, reloadRequired }: { title: string; failed: boolean; retry(): void; onClose(): void; reloadRequired?: boolean }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <DeferredStatus failed={failed} retry={retry} reloadRequired={reloadRequired} />
    </DialogContent>
  </Dialog>;
}
