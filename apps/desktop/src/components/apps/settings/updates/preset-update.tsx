"use client";
/**
 * [INPUT]: Main-owned update status/decisions, the exact pending App record, shared permission disclosure and Settings controls.
 * [OUTPUT]: Explicit check, candidate-bound approval/decline and retry controls for independent Base App updates.
 * [POS]: General settings update section; remounts recover pending consent without starting a download or granting access.
 */
import { useEffect, useState } from "react";
import { SettingsButton, SettingsSection, SettingsSurface } from "@/components/settings/settings-layout";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { decidePresetUpdate, preparePresetUpdate, readPresetUpdate, retryPresetUpdate } from "@/lib/apps/apps-client";
import { StudioConsentPermissions, studioConsentRequest } from "../../authorization/app-consent-disclosure";
import type { AppSettingsTabProps } from "../tab-shell";
import type { PresetUpdateStatus } from "../../../../../shared/ipc/apps/apps-ipc";

export function PresetUpdateSection({ record, busy, fail, run }: Omit<AppSettingsTabProps, "onClose">) {
  const { t } = useAppTranslation();
  const [status, setStatus] = useState<PresetUpdateStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [notice, setNotice] = useState("");
  const hasUpdate = Boolean(record.presetUpdate);
  const operationId = record.presetUpdate?.operationId, phase = record.presetUpdate?.state;
  useEffect(() => {
    let active = true;
    if (!record.presetUpdatesEnabled && !hasUpdate) return;
    void readPresetUpdate(record.id).then(value => { if (active) { setStatus(value); setChecked(true); } })
      .catch(error => { if (active) fail(error, t("apps.presetUpdate.failed")); });
    return () => { active = false; };
  }, [record.id, record.presetUpdatesEnabled, hasUpdate, operationId, phase, fail, t]);
  const update = async (task: () => Promise<PresetUpdateStatus | null>, success: string) => {
    setNotice("");
    const next = await run(async () => {
      try { return await task(); }
      catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (code.includes("APP_UPDATE_NOT_CONFIGURED")) throw new Error(t("apps.presetUpdate.notConfigured"));
        if (code.includes("SCHEMA_CHANGE")) throw new Error(t("apps.presetUpdate.schemaChanged"));
        if (code.includes("SOURCE_CHANGED")) throw new Error(t("apps.presetUpdate.sourceChanged"));
        throw new Error(t("apps.presetUpdate.failed"));
      }
    }, t("apps.presetUpdate.failed"));
    if (next !== undefined) { setStatus(next); if (!next) setNotice(success); }
  };
  return (
    <SettingsSection title={t("apps.presetUpdate.title")} description={t("apps.presetUpdate.hint")}>
      <SettingsSurface className="space-y-3 p-4" data-testid="preset-update-section">
        <div aria-live="polite" role="status">
          {status ? <p>{t(status.state === "awaiting-consent" ? "apps.presetUpdate.available" : "apps.presetUpdate.finishing", { version: status.version })}</p> : notice}
        </div>
        {status?.state === "awaiting-consent" && <>
          <StudioConsentPermissions request={studioConsentRequest(record)} />
          {status.extensions.length > 0 && <p className="text-muted-foreground text-xs">{t("apps.presetUpdate.plugins", { names: status.extensions.join(", ") })}</p>}
          <div className="flex justify-end gap-2">
            <SettingsButton disabled={busy} variant="outline" onClick={() => void update(() => decidePresetUpdate({ appId: record.id, operationId: status.operationId, approve: false }), t("apps.presetUpdate.declined"))}>{t("apps.presetUpdate.decline")}</SettingsButton>
            <SettingsButton disabled={busy} onClick={() => void update(() => decidePresetUpdate({ appId: record.id, operationId: status.operationId, approve: true }), t("apps.presetUpdate.completed"))}>{t("apps.presetUpdate.approve")}</SettingsButton>
          </div>
        </>}
        {status && status.state !== "awaiting-consent" && <>
          <p className="text-muted-foreground text-xs">{t("apps.presetUpdate.recoveryHint")}</p>
          <SettingsButton disabled={busy} onClick={() => void update(() => retryPresetUpdate(record.id), t("apps.presetUpdate.completed"))}>{t("apps.presetUpdate.retry")}</SettingsButton>
        </>}
        {!record.presetUpdatesEnabled && !status && <p className="text-muted-foreground text-xs">{t("apps.presetUpdate.notConfigured")}</p>}
        {!status && <SettingsButton disabled={!record.presetUpdatesEnabled || busy || !checked || Boolean(record.presetUpdate) || Boolean(record.generationBinding.pending)} onClick={() => void update(() => preparePresetUpdate(record.id), t("apps.presetUpdate.current"))}>{t("apps.presetUpdate.check")}</SettingsButton>}
      </SettingsSurface>
    </SettingsSection>
  );
}
