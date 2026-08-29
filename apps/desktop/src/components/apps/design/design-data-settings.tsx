"use client";

/**
 * [INPUT]: Depends on trusted Design data/status/visibility Apps client commands, SettingsButton, and localized copy
 * [OUTPUT]: Provides DesignDataSettings for durable visibility and confirmed custody deletion; workspace-owner migration is exclusively driven by main-owned Project rebind evidence
 * [POS]: Design-only trusted settings section; untrusted factory GUI cannot invoke destructive data or owner operations
 */

import { useEffect, useState } from "react";
import { SettingsButton } from "@/components/settings/settings-layout";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  deleteDesignData,
  readDesignDataStatus,
  setDesignEnabled,
} from "@/lib/apps-client";
import type { AppRecord, DesignDataStatus } from "../../../../shared/apps-ipc";

export function DesignDataSettings({ record }: { record: AppRecord }) {
  const { t } = useAppTranslation();
  const [status, setStatus] = useState<DesignDataStatus>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const enabled = record.defaultGrant != null;
  const refresh = () => readDesignDataStatus(record.id).then(setStatus);
  useEffect(() => {
    let active = true;
    void readDesignDataStatus(record.id).then((next) => active && setStatus(next));
    return () => { active = false; };
  }, [record.id]);
  const run = (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    void operation()
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };
  return (
    <section className="space-y-3 rounded-lg border p-3" data-testid="design-data-settings">
      <p className="font-medium text-sm">{t("apps.designDataTitle")}</p>
      <p className="text-muted-foreground text-xs">
        {t(enabled ? "apps.designEnabledHint" : "apps.designHiddenHint")}
      </p>
      <SettingsButton
        disabled={busy}
        onClick={() => run(() => setDesignEnabled({ appId: record.id, enabled: !enabled }))}
        variant="outline"
      >
        {t(enabled ? "apps.designHide" : "apps.designReopen")}
      </SettingsButton>
      {status && (
        <>
          <p className="break-all font-mono text-[11px] text-muted-foreground">
            {status.stableWorkspaceOwnerId}
          </p>
          <SettingsButton
            disabled={busy}
            onClick={() => {
              if (!window.confirm(t("apps.designDeleteConfirm"))) return;
              run(async () => {
                await deleteDesignData({
                  appId: record.id,
                  dataCustodyId: status.dataCustodyId,
                  confirmed: true,
                });
                await refresh();
              });
            }}
            variant="destructive"
          >
            {t("apps.designDeleteData")}
          </SettingsButton>
        </>
      )}
      {error && <p className="text-destructive text-xs" role="alert">{error}</p>}
    </section>
  );
}
