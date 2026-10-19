/**
 * [INPUT]: Depends on the update-client store, update-view verdicts, brand identity, shared UpdateProgress, external-link IPC, manual download policy, lucide glyphs and Updates i18n
 * [OUTPUT]: Provides AppUpdateRow (the Bottega row) and appUpdateAction, the single "what does updating Bottega do now" decision shared with Update all
 * [POS]: Bottega row of Settings › Updates; electron-updater state stays in main, this file only renders its verdict and invokes typed commands
 */

import { useSyncExternalStore } from "react";
import { Download, RotateCw } from "lucide-react";
import type { UpdateSnapshot } from "../../../../shared/ipc/settings/update-ipc";
import { PRODUCT_MARK_URL, PRODUCT_NAME } from "@ai-chat/ui/components/workspace/brand";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsButton } from "@/components/settings/settings-layout";
import { UpdateProgress } from "@/components/updates/update-progress";
import { openExternal } from "@/lib/agent/agent-client";
import { PERSONAL_RELEASES_URL, RELEASE_URL, updateStore } from "@/lib/platform/update-client";
import { describeUpdate } from "@/lib/updates/update-view";
import { FailedMark, UpdateRow, UpdatingMark, UpToDateMark } from "./update-row";

/** null = nothing to do. "manual" opens Releases, so Update all never includes it. */
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

export function AppUpdateRow() {
  const { t } = useAppTranslation();
  const update = useSyncExternalStore(updateStore.subscribe, updateStore.getSnapshot);
  /* The page itself asked for this check, so a settled "up to date" is a receipt, not noise. */
  const view = describeUpdate(update, true, Boolean(window.update));
  const action = appUpdateAction(update);
  const message = view.messageKey ? t(view.messageKey, { checkedAt: "", ...view.messageVars }) : "";
  const busy = update.phase === "checking" || update.phase === "downloading" || update.phase === "installing";
  const status = update.phase === "downloading"
    ? t("settings.updates.downloadProgress", { percent: view.percent ?? 0 })
    : update.phase === "installing" ? t("settings.updates.installingShort") : message;
  const trailing = busy ? <UpdatingMark label={message} icon={update.phase === "downloading" ? <Download aria-hidden className="size-4 shrink-0" /> : undefined}>{status}</UpdatingMark>
    : action === "restart" ? <SettingsButton variant="outline" onClick={() => void runAppUpdate(update)}><RotateCw aria-hidden className="size-4" />{t("settings.updates.restartUpdate")}</SettingsButton>
      : action === "manual" ? <SettingsButton variant="outline" onClick={() => void runAppUpdate(update)}>{t("settings.updates.manualUpgrade")}</SettingsButton>
        : action ? <SettingsButton variant="outline" onClick={() => void runAppUpdate(update)}><Download aria-hidden className="size-4" />{t("settings.updates.download")}</SettingsButton>
        : view.tone === "danger" ? <FailedMark label={message} />
          : update.phase === "not-available" ? <UpToDateMark label={t("settings.updates.upToDate", { name: PRODUCT_NAME })} />
            : null;
  return <UpdateRow icon={<img src={PRODUCT_MARK_URL} alt="" className="size-5 object-contain" />} name={PRODUCT_NAME}
    current={update.currentVersion || undefined}
    latest={update.availableVersion && update.availableVersion !== update.currentVersion ? update.availableVersion : undefined}
    trailing={trailing}
    detail={update.phase === "downloading" && view.percent !== null ? <div className="space-y-2 text-xs text-muted-foreground">
      <p>{t("settings.updates.downloadContinue")}</p>
      <UpdateProgress percent={view.percent} label={message} className="h-1" />
    </div> : view.tone === "danger" && <div role="alert" className="space-y-1 text-xs">
      <p className="text-destructive">{message}</p>
      {view.resolutionKey && <p className="text-muted-foreground">{t(view.resolutionKey)}</p>}
      <div className="flex flex-wrap gap-2 pt-1"><SettingsButton variant="outline" onClick={() => void updateStore.check()}>{t("settings.updates.retry")}</SettingsButton>
        {view.resolutionKey && <SettingsButton variant="outline" onClick={() => void openExternal(RELEASE_URL)}>{t("settings.updates.manualUpgrade")}</SettingsButton>}
      </div>
    </div>} />;
}
