/**
 * [INPUT]: Depends on account state and the fixed cloud App catalog bridge.
 * [OUTPUT]: Shows portable identity, independent installation state, Base access, original install/removal/deletion recovery and retained files.
 * [POS]: Apps list cloud section; account changes remount private disclosures and discard stale results.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Cloud } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useCloudAccount } from "@/lib/cloud/client";
import type { CloudAppCatalog, CloudAppsBridge } from "../../../../shared/cloud/apps/model";
import { CloudAppInstallDialog } from "./install-dialog";
import { CloudAppRemovalDialog } from "./removal-dialog";
import { CloudAppDeletionDialog } from "./deletion-dialog";
declare global { interface Window { cloudApps?: CloudAppsBridge } }
export function CloudAppsCatalog() {
  const account = useCloudAccount(), userId = account.profile?.userId;
  if (!window.cloudApps || !userId || !["ready", "temporarily-offline"].includes(account.status) ||
    ["not-connected", "scanning", "initializing", "closing"].includes(account.sync.status)) return null;
  return <Catalog key={userId} userId={userId} online={account.status === "ready" && account.sync.status !== "paused"} />;
}
function Catalog({ userId, online }: { userId: string; online: boolean }) {
  const { t } = useAppTranslation();
  const statusLabels = {
    "not-installed": t("cloud.appInstall.notInstalled"), installed: t("cloud.appInstall.installed"),
    "update-available": t("cloud.appInstall.updateAvailable"), preparing: t("cloud.appInstall.installing"),
    failed: t("cloud.appInstall.interrupted"), deleted: t("cloud.appInstall.deleted"),
  };
  const [catalog, setCatalog] = useState<CloudAppCatalog | null>(null), [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<{ appId: string; name: string; update: boolean } | null>(null), [busy, setBusy] = useState<string | null>(null);
  const [removal, setRemoval] = useState<CloudAppCatalog["items"][number] | null>(null);
  const [deletion, setDeletion] = useState<CloudAppCatalog["items"][number] | null>(null);
  const requests = useRef({ sequence: 0 });
  const refresh = useCallback(async () => {
    const request = ++requests.current.sequence;
    try { const next = await window.cloudApps!.catalog({ expectedUserId: userId }); if (requests.current.sequence === request) { setCatalog(next); setFailed(false); } }
    catch { if (requests.current.sequence === request) setFailed(true); }
  }, [userId]);
  useEffect(() => {
    const current = requests.current, timer = window.setTimeout(() => { void refresh(); }, 0);
    const off = window.cloudApps!.onChanged(() => { void refresh(); });
    return () => { window.clearTimeout(timer); current.sequence++; off(); };
  }, [refresh, online]);
  const act = async (action: "retry" | "cancel" | "retryRemoval" | "dismissDeletion", requestId: string) => {
    setBusy(requestId); setFailed(false);
    try { await window.cloudApps![action]({ expectedUserId: userId, requestId }); }
    catch { setFailed(true); }
    finally { setBusy(null); await refresh(); }
  };
  if (catalog && !catalog.items.length && !failed) return null;
  return <section id="cloud-apps" tabIndex={-1} className="mb-6 space-y-3" aria-label={t("cloud.appInstall.title")}>
    <div className="flex items-center gap-2"><Cloud className="size-4" /><h2 className="text-sm font-medium">{t("cloud.appInstall.title")}</h2></div>
    {!online && <p role="status" className="text-sm text-muted-foreground">{t("cloud.appInstall.online")}</p>}
    {failed && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm"><span>{t("cloud.appInstall.failed")}</span>
      <Button variant="outline" size="sm" onClick={() => void refresh()}>{t("cloud.appInstall.refresh")}</Button></div>}
    {!catalog && !failed && <p role="status" className="text-sm text-muted-foreground">{t("cloud.appInstall.loading")}</p>}
    {catalog?.items.map(item => <div key={item.appId} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <div className="min-w-0 flex-1 basis-40"><h3 className="break-words text-sm font-medium">{item.name}</h3>
        <p className="text-xs text-muted-foreground">{item.deletion ? t(item.deletion.status === "confirmed" ? "cloud.appDeletion.confirmed" : "cloud.appDeletion.pending") : item.removalRequestId ? t("cloud.appRemoval.pending") : statusLabels[item.state]}{item.packageRevision ? ` · ${t("cloud.appInstall.version", { version: item.packageRevision })}` : ""}</p>
        {item.coverage === "partial" && <p className="mt-1 text-xs text-muted-foreground">{t("cloud.apps.partial")}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {item.baseReady && <Button asChild variant="ghost" size="sm"><Link to={`/bases/project/${item.projectId}`}>{t(item.state === "deleted" ? "cloud.appDeletion.retainedBase" : "cloud.catalog.openBase")}</Link></Button>}
        {!item.deletion && (item.removalRequestId ? <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void act("retryRemoval", item.removalRequestId!)}>{t("cloud.appRemoval.resume")}</Button> : item.requestId ? <>
          <Button size="sm" variant="outline" disabled={!!busy || !online} onClick={() => void act("retry", item.requestId!)}>{t(busy === item.requestId ? "cloud.appInstall.installing" : "cloud.appInstall.resume")}</Button>
          {item.canCancel && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void act("cancel", item.requestId!)}>{t("common.cancel")}</Button>}
        </> : ["not-installed", "update-available"].includes(item.state) ? <Button size="sm" disabled={!!busy || !online || !item.packageRevision || !item.baseReady}
          onClick={() => setSelected({ appId: item.appId, name: item.name, update: item.state === "update-available" })}>{t(item.state === "update-available" ? "cloud.appInstall.update" : "cloud.appInstall.install")}</Button> : null)}
        {item.localInstallation && !item.deletion && <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setRemoval(item)}>{t("cloud.appRemoval.remove")}</Button>}
        {item.state !== "deleted" && item.deletion?.status !== "confirmed" && <Button variant="ghost" size="sm" disabled={!!busy || !online} onClick={() => setDeletion(item)}>
          {t(item.deletion?.status === "pending" ? "cloud.appDeletion.retry" : item.deletion ? "cloud.appDeletion.review" : "cloud.appDeletion.action")}</Button>}
        {item.deletion && ["conflicted", "blocked"].includes(item.deletion.status) && <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void act("dismissDeletion", item.deletion!.requestId)}>{t("cloud.appDeletion.keep")}</Button>}
        {item.hasRetainedFiles && <Button variant="ghost" size="sm" onClick={() => {
          void window.cloudApps!.openRetained({ expectedUserId: userId, appId: item.appId }).catch(() => setFailed(true));
        }}>{t("cloud.appRemoval.retained")}</Button>}
      </div>
      {!item.packageRevision && item.state !== "deleted" && <p className="w-full text-xs text-muted-foreground">{t("cloud.apps.packagePending")}</p>}
      {!item.baseReady && item.state !== "deleted" && <p className="w-full text-xs text-muted-foreground">{t("cloud.appInstall.basePending")}</p>}
    </div>)}
    {selected && <CloudAppInstallDialog {...selected} userId={userId} online={online} onClose={() => { setSelected(null); void refresh(); }} />}
    {removal && <CloudAppRemovalDialog userId={userId} item={removal} onClose={() => { setRemoval(null); void refresh(); }} />}
    {deletion && <CloudAppDeletionDialog userId={userId} item={deletion} online={online} onClose={() => { setDeletion(null); void refresh(); }} />}
  </section>;
}
