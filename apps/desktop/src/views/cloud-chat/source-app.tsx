/**
 * [INPUT]: Depends on the current account and main-owned scoped App tombstone projection.
 * [OUTPUT]: Labels retained App conversations after source deletion without creating execution authority.
 * [POS]: Desktop mirror source status; local deletion proof remains readable offline and stale account results are ignored.
 */
import { useEffect, useState } from "react";
import { useCloudAccount } from "@/lib/cloud/client";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { CloudAppsBridge } from "../../../shared/cloud/apps/model";
declare global { interface Window { cloudApps?: CloudAppsBridge } }
export function SourceApp({ appId }: { appId: string }) {
  const userId = useCloudAccount().profile?.userId, { t } = useAppTranslation();
  const [value, setValue] = useState<{ userId: string; appId: string; deleted: boolean } | null>(null);
  useEffect(() => {
    const bridge = window.cloudApps; if (!bridge || !userId) return;
    let sequence = 0, live = true;
    const read = async () => {
      const current = ++sequence;
      try { const origin = await bridge.origin({ expectedUserId: userId, appId });
        if (live && current === sequence) setValue({ userId, appId, deleted: origin?.deleted ?? false });
      } catch { /* Existing scoped deletion proof remains valid during a transient outage. */ }
    };
    void read(); const off = bridge.onChanged(() => { void read(); });
    return () => { live = false; sequence++; off(); };
  }, [userId, appId]);
  return value?.userId === userId && value?.appId === appId && value.deleted ? <p role="status" className="px-4 py-2 text-sm text-muted-foreground">{t("cloud.appDeletion.sourceDeleted")}</p> : null;
}
