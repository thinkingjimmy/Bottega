/**
 * [INPUT]: Depends on the production Apps bridge, current App record and the shared disable dialog/copy.
 * [OUTPUT]: Provides useAppEnablement for a fresh impact preview, explicit confirmation and on-demand reopening.
 * [POS]: Desktop App-card control; main owns revision checks, cancellation and durable state publication.
 */
import { useRef, useState } from "react";
import type { AppDisableImpact } from "@ai-chat/cloud-protocol/apps/build-status/enablement";
import { AppDisableDialog } from "@ai-chat/ui/components/catalog/app-disable-dialog";
import { appEnablementCopy, appEnablementError } from "@ai-chat/ui/lib/app-enablement/copy";
import { appDisplayName, type AppRecord } from "../../../../shared/ipc/apps/apps-ipc";
import { disableAppImpact, setAppEnabled } from "@/lib/apps/apps-client";
export function useAppEnablement(record: AppRecord, locale: string) {
  const [impact, setImpact] = useState<AppDisableImpact | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const flight = useRef(false), copy = appEnablementCopy(locale);
  const run = async (confirm: boolean) => {
    if (flight.current) return;
    flight.current = true; setBusy(true); setError("");
    try {
      if (confirm && impact) {
        await setAppEnabled({ appId: record.id, enabled: false, expectedRevision: impact.revision, impactDigest: impact.digest });
        setImpact(null);
      } else {
        const preview = await disableAppImpact(record.id);
        if (preview.enabled) setImpact(preview);
        else await setAppEnabled({ appId: record.id, enabled: true, expectedRevision: preview.revision });
      }
    } catch (cause) {
      setError(appEnablementError(cause, locale));
      if (cause instanceof Error && cause.message.includes("app-enablement-stale"))
        setImpact(await disableAppImpact(record.id).catch(() => null));
    } finally { flight.current = false; setBusy(false); }
  };
  return { busy, error, copy, toggle: () => void run(false), dialog: <AppDisableDialog name={appDisplayName(record)} locale={locale}
    impact={impact} busy={busy} error={error} onConfirm={() => void run(true)} onClose={() => setImpact(null)} /> };
}
