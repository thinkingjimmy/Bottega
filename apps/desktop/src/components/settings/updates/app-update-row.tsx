/**
 * [INPUT]: Depends on typed update-client failures, update-view verdicts, brand identity, external-link/clipboard IPC, shared update rows and Updates i18n
 * [OUTPUT]: Provides AppUpdateRow, appUpdateAction and runAppUpdate; download, stage-specific retry and explicit restart share one action slot; readable failure details keep diagnostics behind explicit copy
 * [POS]: Bottega row of Settings › Updates; main owns update state, downloading has one trailing percentage, and failure detail stays collapsed
 */

import { useState, useSyncExternalStore } from "react";
import { Download } from "lucide-react";
import type { UpdateSnapshot } from "../../../../shared/ipc/settings/update-ipc";
import { PRODUCT_MARK_URL, PRODUCT_NAME } from "@ai-chat/ui/components/workspace/brand";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsButton } from "@/components/settings/settings-layout";
import { openExternal, writeClipboardText } from "@/lib/agent/agent-client";
import { PERSONAL_RELEASES_URL, RELEASE_URL, updateStore } from "@/lib/platform/update-client";
import { describeUpdate, describeUpdateFailure } from "@/lib/updates/update-view";
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
  /* Only successful checks can produce the current-version receipt. */
  const view = describeUpdate(update, true, Boolean(window.update));
  const action = appUpdateAction(update);
  const message = view.messageKey ? t(view.messageKey, { checkedAt: "", ...view.messageVars }) : "";
  const busy = update.phase === "checking" || update.phase === "downloading" || update.phase === "installing";
  const failure = describeUpdateFailure(update);
  const [copied, setCopied] = useState<{ key: string; ok: boolean } | null>(null);
  const diagnostic = failure?.diagnostic;
  const diagnosticKey = `${update.revision ?? 0}:${failure?.retry}:${diagnostic}`;
  const copyDiagnostics = async () => {
    if (!diagnostic || !failure) return;
    try {
      await writeClipboardText(`${PRODUCT_NAME} ${update.currentVersion}\n${failure.retry}\n${diagnostic}`);
      setCopied({ key: diagnosticKey, ok: true });
    } catch { setCopied({ key: diagnosticKey, ok: false }); }
  };
  const status = update.phase === "downloading"
    ? t("settings.updates.downloadProgress", { percent: view.percent ?? 0 })
    : update.phase === "installing" ? t("settings.updates.installingShort") : message;
  const trailing = busy ? <UpdatingMark label={message} icon={update.phase === "downloading" ? <Download aria-hidden className="size-3.5 shrink-0" /> : undefined}>{status}</UpdatingMark>
    : action ? <UpdateButton disabled={disabled} label={action === "install" ? t("settings.updates.updateOne", { name: PRODUCT_NAME }) : undefined} onClick={() => void runAppUpdate(update)}>
        {t(action === "restart" ? "settings.updates.restartUpdate" : action === "manual" ? "settings.updates.manualUpgrade" : "settings.updates.upgrade")}
      </UpdateButton>
        : failure ? <UpdateButton disabled={disabled} onClick={() => void (failure.retry === "download" ? updateStore.downloadAndInstall() : updateStore.check())}>
          {t(failure.retry === "download" ? "settings.updates.retryDownload" : "settings.updates.retryCheck")}
        </UpdateButton>
        : update.phase === "not-available" ? <UpToDateMark label={t("settings.updates.upToDate", { name: PRODUCT_NAME })} />
          : <span className="text-xs text-muted-foreground">{message}</span>;
  return <UpdateRow icon={<img src={PRODUCT_MARK_URL} alt="" className="size-6 object-contain" />} name={PRODUCT_NAME}
    current={update.currentVersion || undefined} currentLabel={t("settings.updates.currentVersion", { version: update.currentVersion })}
    latest={update.availableVersion && update.availableVersion !== update.currentVersion ? update.availableVersion : undefined}
    trailing={trailing}
    failure={failure ? {
      summary: t(failure.summaryKey), tone: failure.tone,
      detail: <div className="space-y-2">
        <p>{t(failure.reasonKey)}</p>
        <p>{t("settings.updates.currentVersionRetained")}</p>
        <div className="-ml-3 flex flex-wrap items-center gap-1">
          {diagnostic && <SettingsButton variant="ghost" onClick={() => void copyDiagnostics()}>{t("settings.updates.copyDiagnostics")}</SettingsButton>}
          {failure.retry === "download" && <SettingsButton variant="ghost" disabled={disabled} onClick={() => void openExternal(RELEASE_URL)}>{t("settings.updates.manualUpgrade")}</SettingsButton>}
        </div>
        {copied?.key === diagnosticKey && <p role="status">{t(copied.ok ? "settings.updates.diagnosticsCopied" : "settings.updates.diagnosticsCopyFailed")}</p>}
      </div>,
    } : undefined} />;
}
