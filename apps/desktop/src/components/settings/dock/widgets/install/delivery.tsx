/**
 * [INPUT]: Depends on bounded source delivery projections and fixed current-scope delivery control commands.
 * [OUTPUT]: Provides WidgetDeliveryStatus with exact original-version retry/abandon and honest pending/failed/ready copy.
 * [POS]: Host source delivery UI; network failure cannot roll back local Widget use or replace frozen bytes.
 */
import { useRef, useState } from "react";
import { SettingsButton } from "@/components/settings/settings-layout";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import type { WidgetDeliveryView } from "../../../../../../shared/system-dock/widgets/install/types";
export function WidgetDeliveryStatus({
  deliveries,
  onChanged,
}: {
  deliveries: readonly WidgetDeliveryView[];
  onChanged(): void;
}) {
  const { t } = useAppTranslation(),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    lock = useRef(false);
  const change = async (reference: string, action: "retry" | "abandon") => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await window.systemDockSettings!.widgetDeliveryControl({
        reference,
        action,
      });
      onChanged();
    } catch {
      setFailed(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1">
      {deliveries.map((value) => (
        <div
          key={value.reference}
          data-widget-delivery={value.state}
          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        >
          <span role="status">
            {t(`systemDock.widgets.delivery.${value.state}`)}
          </span>
          {(value.state === "failed" || value.state === "abandoned") && (
            <SettingsButton
              disabled={busy}
              variant="ghost"
              onClick={() => void change(value.reference, "retry")}
            >
              {t("common.retry")}
            </SettingsButton>
          )}
          {value.state === "failed" && (
            <SettingsButton
              disabled={busy}
              variant="ghost"
              onClick={() => void change(value.reference, "abandon")}
            >
              {t("systemDock.widgets.delivery.abandon")}
            </SettingsButton>
          )}
        </div>
      ))}
      {failed && (
        <span role="alert" className="text-xs">
          {t("systemDock.widgets.delivery.failed")}
        </span>
      )}
    </div>
  );
}
