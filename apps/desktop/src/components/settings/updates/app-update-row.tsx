/**
 * [INPUT]: Depends on update-client snapshots, update-view verdicts, brand identity, external-link IPC, shared update rows and Updates i18n
 * [OUTPUT]: Provides AppUpdateRow, appUpdateAction and runAppUpdate; download, manual download, retry and explicit restart share one action slot
 * [POS]: Bottega row of Settings › Updates; main owns update state, downloading has one trailing percentage, and failure detail stays collapsed
 */

import { useSyncExternalStore } from "react";
import { Download } from "lucide-react";
import type { UpdateSnapshot } from "../../../../shared/ipc/settings/update-ipc";
import { PRODUCT_MARK_URL, PRODUCT_NAME } from "@ai-chat/ui/components/workspace/brand";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsButton } from "@/components/settings/settings-layout";
import { openExternal } from "@/lib/agent/agent-client";
import { PERSONAL_RELEASES_URL, RELEASE_URL, updateStore } from "@/lib/platform/update-client";
import { describeUpdate } from "@/lib/updates/update-view";
import { UpdateButton, UpdateRow, UpdatingMark, UpToDateMark } from "./update-row";

/** null = nothing to do. Manual downloads and explicit restarts are excluded from Update all. */
export function appUpdateAction(update: UpdateSnapshot): "restart" | "install" | "manual" | null {
  if (update.manualOnly) return "manual";
  if (update.phase === "ready") return "restart";
  if (update.phase !== "available") return null;
  return update.automaticInstall ? "install" : "manual";
}

export function runAppUpdate(update: UpdateSnapshot) {
  const action = appUpdateAction(update);
  if (action === "restart") return updateStore.installNow();
  if (action === "install") return updateStore.downloadAndInstall();
  if (action === "manual") return openExternal(update.manualOnly ? PERSONAL_RELEASES_URL : RELEASE_URL);
}

export function AppUpdateRow({ disabled = false }: { disabled?: boolean }) {
  const { t } = useAppTranslation();
  const update = useSyncExternalStore(updateStore.subscribe, updateStore.getSnapshot);
  /* The page itself asked for this check, so a settled "up to date" is a receipt, not noise. */
  const view = describeUpdate(update, true, Boolean(window.update));
  const action = appUpdateAction(update);
  const message = view.messageKey ? t(view.messageKey, { checkedAt: "", ...view.messageVars }) : "";
  const busy = update.phase === "checking" || update.phase === "downloading" || update.phase === "installing";
  const failed = view.tone === "danger";
  const status = update.phase === "downloading"
    ? t("settings.updates.downloadProgress", { percent: view.percent ?? 0 })
    : update.phase === "installing" ? t("settings.updates.installingShort") : message;
  const trailing = busy ? <UpdatingMark label={message} icon={update.phase === "downloading" ? <Download aria-hidden className="size-3.5 shrink-0" /> : undefined}>{status}</UpdatingMark>
    : failed ? <UpdateButton disabled={disabled} onClick={() => void updateStore.check()}>{t("settings.updates.retry")}</UpdateButton>
      : action ? <UpdateButton disabled={disabled} label={action === "install" ? t("settings.updates.updateOne", { name: PRODUCT_NAME }) : undefined} onClick={() => void runAppUpdate(update)}>
        {t(action === "restart" ? "settings.updates.restartUpdate" : action === "manual" ? "settings.updates.manualUpgrade" : "settings.updates.upgrade")}
      </UpdateButton>
        : update.phase === "not-available" ? <UpToDateMark label={t("settings.updates.upToDate", { name: PRODUCT_NAME })} />
          : <span className="text-xs text-muted-foreground">{message}</span>;
  return <UpdateRow icon={<img src={PRODUCT_MARK_URL} alt="" className="size-6 object-contain" />} name={PRODUCT_NAME}
    current={update.currentVersion || undefined}
    latest={update.availableVersion && update.availableVersion !== update.currentVersion ? update.availableVersion : undefined}
    trailing={trailing}
    failure={failed ? {
      summary: t(update.phase === "error" ? "settings.updates.failedShort" : "settings.updates.checkFailedShort"),
      detail: <div className="space-y-2">
        <p className="break-words">{message}</p>
        {view.resolutionKey && <>
          <p>{t(view.resolutionKey)}</p>
          <SettingsButton variant="ghost" className="-ml-3" disabled={disabled} onClick={() => void openExternal(RELEASE_URL)}>{t("settings.updates.manualUpgrade")}</SettingsButton>
        </>}
      </div>,
    } : undefined} />;
}
