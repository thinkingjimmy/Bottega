/**
 * [INPUT]: Depends on History renderer client, use memory of OptionalHistory Delivering snapshot, i18n, Settings Go to the original language and ConfirmationDialog
 * [OUTPUT]: Provides HistoryMemoryImportAction: eligibility→ unchanged delta preview→ Clearly confirm→ Received feedback and back-end delivery status presented
 * [POS]: Settings › Memory is the historical import entry; Chat scope is for preview/import session only, Group/Personal is external, and the renderer does not have the provider permission; Confirm return ≠ delivery completed, completed/delivered Chinese case by live status stream
 */

import { useEffect, useState } from "react";
import type {
  HistoryMemoryEligibility,
  HistoryMemoryPreview,
} from "../../../shared/history-import-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useOptionalHistory } from "@/components/providers/history/history-provider";
import {
  SettingsButton,
  SettingsList,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/settings-layout";
import { errorMessage } from "@/lib/errors";
import {
  commitHistoryMemory,
  historyMemoryEligibility,
  previewHistoryMemory,
} from "@/lib/history/client";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";

export function HistoryMemoryImportAction({ refreshKey }: { refreshKey: string }) {
  const { t, i18n } = useAppTranslation();
  /* 确认即受理：commit 返回只代表 Grant 已落盘，交付仍在后台泵里。
     delivering 直接读事件流快照，收尾/中断都不需要本组件轮询。 */
  const delivering = useOptionalHistory()?.snapshot.memoryDelivering ?? false;
  const [eligibility, setEligibility] = useState<HistoryMemoryEligibility | null>(null);
  const [preview, setPreview] = useState<HistoryMemoryPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  /* delivering 落定也重拉 eligibility：后台失败会把 interruptedGrant 翻真，
     这一拍不刷新的话，告警要等下次进页才出现。 */
  useEffect(() => {
    let active = true;
    void historyMemoryEligibility({ surface: "settings" })
      .then((next) => { if (active) setEligibility(next); })
      .catch((cause) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [refreshKey, delivering]);

  if (!eligibility?.visible) return null;
  const unavailable = !eligibility.enabled;
  const formatDate = (value: number | null) =>
    value === null ? "—" : new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(value);

  const prepare = async () => {
    setBusy(true);
    setError("");
    setComplete(false);
    try {
      setPreview(await previewHistoryMemory({ includeProductChats: true }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      await commitHistoryMemory(preview.snapshotId, preview.digest);
      setPreview(null);
      setComplete(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsSection
        title={t("history.settingsImportTitle")}
        description={unavailable
          ? t("history.settingsImportUnavailable")
          : eligibility.reason === "chat-mode"
            ? t("history.settingsProductOnly")
            : t("history.settingsImportDescription")}
        alert={error || (complete
          ? t(delivering ? "history.settingsDelivering" : "history.settingsComplete")
          : eligibility.interruptedGrant ? t("history.interruptedGrant") : undefined)}
      >
        <SettingsList>
          <SettingsRow
            label={t("history.settingsImportRow")}
            htmlFor="history-memory-import"
            description={eligibility.reason === "chat-mode"
              ? t("history.settingsProductOnly")
              : t("history.importMemoryDetail")}
            control={
              <SettingsButton id="history-memory-import" disabled={unavailable || busy} onClick={() => void prepare()}>
                {t("history.settingsImportAction")}
              </SettingsButton>
            }
          />
        </SettingsList>
      </SettingsSection>

      <ConfirmationDialog
        open={preview !== null}
        onOpenChange={(open) => { if (!open && !busy) setPreview(null); }}
        title={t("history.settingsPreviewTitle")}
        description={preview ? (
          <div className="space-y-3 text-left">
            <p>{t("history.settingsPreviewSummary", {
              chats: preview.chats,
              turns: preview.turns,
              from: formatDate(preview.from),
              to: formatDate(preview.to),
            })}</p>
            <p>{t("history.settingsPreviewDisclosure")}</p>
            <p>{t("history.memoryRetained")}</p>
            {preview.sharingMode === "personal" && <p>{t("history.personalCrossProject")}</p>}
            <code className="block break-all rounded-md bg-muted px-3 py-2 text-xs">
              {preview.digest}
            </code>
            {error && <p className="text-destructive" role="alert">{error}</p>}
          </div>
        ) : null}
        confirmLabel={t("history.settingsConfirm")}
        cancelLabel={t("common.cancel")}
        busy={busy}
        onConfirm={() => void commit()}
      />
    </>
  );
}
