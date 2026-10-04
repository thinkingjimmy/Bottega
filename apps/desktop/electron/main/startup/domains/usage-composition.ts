/**
 * [INPUT]: Depends on the quota snapshot store, service, Electron power lifecycle and settings-backed pricing preference.
 * [OUTPUT]: Provides composeUsageServices with pre-window cache residency and one power subscription released at shutdown.
 * [POS]: Composition-root helper for index.ts; the preload-before-window rule lives with the composition instead of being re-narrated by the entry file
 */

import { join } from "node:path";
import { powerMonitor } from "electron";
import { UsageService } from "../../usage/usage-service";
import { AgentUsageLimitsService } from "../../usage-limits/service";
import { QuotaSnapshotStore } from "../../usage-limits/snapshot-store";

export async function composeUsageServices(
  userData: string,
  pricingRefreshEnabled: () => boolean
) {
  const usageLimits = new AgentUsageLimitsService({
    persistence: new QuotaSnapshotStore(join(userData, "usage-limits-cache.json")),
    subscribeSuspension(listener) {
      const suspend = () => listener(true), resume = () => listener(false);
      powerMonitor.on("suspend", suspend).on("resume", resume);
      return () => { powerMonitor.removeListener("suspend", suspend); powerMonitor.removeListener("resume", resume); };
    },
  });
  /* One small JSON read, before the window exists: the first selector then opens on the
     last known numbers instead of an empty card while the live read is still queued. */
  await usageLimits.load();
  usageLimits.startResident();
  return {
    usageLimits,
    usage: new UsageService(userData, { pricingRefreshEnabled }),
  };
}
