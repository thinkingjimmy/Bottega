/**
 * [INPUT]: Depends on the update-client store, lib/updates/update-view verdicts, brand identity, the external-link IPC and Updates i18n
 * [OUTPUT]: Provides AppUpdateRow (the Bottega row) and appUpdateAction, the single "what does updating Bottega do now" decision shared with Update all
 * [POS]: Bottega row of Settings › Updates; electron-updater state stays in main, this file only renders its verdict and invokes typed commands
 */

import { useSyncExternalStore } from "react";
import type { UpdateSnapshot } from "../../../../shared/update-ipc";
import { PRODUCT_MARK_URL, PRODUCT_NAME } from "@ai-chat/ui/components/workspace/brand";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsButton } from "@/components/settings/settings-layout";
import { openExternal } from "@/lib/agent-client";
import { RELEASE_URL, updateStore } from "@/lib/update-client";
import { describeUpdate } from "@/lib/updates/update-view";
import { FailedMark, UpdateButton, UpdateRow, UpdatingMark, UpToDateMark } from "./update-row";

/** null = nothing to do. "manual" opens Releases, so Update all never includes it. */
export function appUpdateAction(update: UpdateSnapshot): "restart" | "install" | "manual" | null {
  if (update.phase === "ready") return "restart";
  if (update.phase !== "available") return null;
  return update.automaticInstall ? "install" : "manual";
}

export function runAppUpdate(update: UpdateSnapshot) {
  const action = appUpdateAction(update);
  if (action === "restart") return updateStore.installNow();
  if (action === "install") return updateStore.downloadAndInstall();
  if (action === "manual") return openExternal(RELEASE_URL);
}

export function AppUpdateRow() {
  const { t } = useAppTranslation();
  const update = useSyncExternalStore(updateStore.subscribe, updateStore.getSnapshot);
  /* The page itself asked for this check, so a settled "up to date" is a receipt, not noise. */
  const view = describeUpdate(update, true, Boolean(window.update));
  const action = appUpdateAction(update);
  const message = view.messageKey ? t(view.messageKey, { checkedAt: "", ...view.messageVars }) : "";
  const busy = update.phase === "checking" || update.phase === "downloading" || update.phase === "installing";
  const trailing = busy ? <>
      {view.percent !== null && <span className="text-muted-foreground text-xs tabular-nums">{view.percent}%</span>}
      <UpdatingMark label={message} />
    </>
    : action === "restart" ? <SettingsButton onClick={() => void runAppUpdate(update)}>{t("settings.presence.restart")}</SettingsButton>
      : action ? <UpdateButton label={t("settings.updates.updateOne", { name: PRODUCT_NAME })} onClick={() => void runAppUpdate(update)} />
        : view.tone === "danger" ? <FailedMark label={message} />
          : update.phase === "not-available" ? <UpToDateMark label={t("settings.updates.upToDate", { name: PRODUCT_NAME })} />
            : null;
  return <UpdateRow icon={<img src={PRODUCT_MARK_URL} alt="" className="size-5 object-contain" />} name={PRODUCT_NAME}
    current={update.currentVersion || undefined}
    latest={update.availableVersion && update.availableVersion !== update.currentVersion ? update.availableVersion : undefined}
    trailing={trailing}
    detail={view.tone === "danger" && <div role="alert" className="space-y-1 text-xs">
      <p className="text-destructive">{message}</p>
      {view.resolutionKey && <p className="text-muted-foreground">{t(view.resolutionKey)}</p>}
      <div className="pt-1"><SettingsButton variant="outline" onClick={() => void updateStore.check()}>{t("settings.updates.retry")}</SettingsButton></div>
    </div>} />;
}
