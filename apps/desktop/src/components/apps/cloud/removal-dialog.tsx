/**
 * [INPUT]: Depends on a main-projected local generation and the fixed local-removal bridge.
 * [OUTPUT]: Confirms local installation removal and retries the same request after an uncertain response.
 * [POS]: Cloud App local disposition dialog; cloud deletion and Base retention are separate actions.
 */
import { useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog } from "@ai-chat/ui/components/ui/dialog";
import { AppDialogCancel, AppDialogContent, AppDialogFooter, AppDialogHeader } from "@ai-chat/ui/components/ui/app-dialog";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import type { CloudAppCatalog } from "../../../../shared/cloud/apps/model";
type Item = CloudAppCatalog["items"][number];
export function CloudAppRemovalDialog({ userId, item, onClose }: { userId: string; item: Item; onClose(): void }) {
  const { t } = useAppTranslation();
  const [requestId] = useState(() => crypto.randomUUID()), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const remove = async () => {
    if (!item.localInstallation || busy) return;
    setBusy(true); setFailed(false);
    try {
      await window.cloudApps!.removeLocal({ expectedUserId: userId, appId: item.appId, requestId, ...item.localInstallation });
      onClose();
    } catch { setFailed(true); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <AppDialogContent className="max-h-[90dvh]">
      <AppDialogHeader title={t("cloud.appRemoval.title", { name: item.name })} description={t("cloud.appRemoval.details")}/>
      {failed && <p role="alert" className="text-sm text-destructive">{t("cloud.appRemoval.failed")}</p>}
      <AppDialogFooter><AppDialogCancel disabled={busy} onClick={onClose}>{t("common.cancel")}</AppDialogCancel>
        <Button size="pill" disabled={busy || !item.localInstallation} onClick={() => void remove()}>{busy && <Spinner />}{t("cloud.appRemoval.confirm")}</Button>
      </AppDialogFooter>
    </AppDialogContent>
  </Dialog>;
}
