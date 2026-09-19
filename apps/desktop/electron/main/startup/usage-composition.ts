/**
 * [INPUT]: Depends on the quota snapshot store, the usage-limits service, the usage service and the settings-backed pricing preference
 * [OUTPUT]: Provides composeUsageServices — the quota snapshot preload and the two usage owners, built in the one order that matters
 * [POS]: Composition-root helper for index.ts; the preload-before-window rule lives with the composition instead of being re-narrated by the entry file
 */

import { join } from "node:path";
import { UsageService } from "../usage/usage-service";
import { AgentUsageLimitsService } from "../usage-limits/service";
import { QuotaSnapshotStore } from "../usage-limits/snapshot-store";

export async function composeUsageServices(
  userData: string,
  pricingRefreshEnabled: () => boolean
) {
  const usageLimits = new AgentUsageLimitsService({
    persistence: new QuotaSnapshotStore(join(userData, "usage-limits-cache.json")),
  });
  /* One small JSON read, before the window exists: the first selector then opens on the
     last known numbers instead of an empty card while the live read is still queued. */
  await usageLimits.load();
  return {
    usageLimits,
    usage: new UsageService(userData, { pricingRefreshEnabled }),
  };
}
