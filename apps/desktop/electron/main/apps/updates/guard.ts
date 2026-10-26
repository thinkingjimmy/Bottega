/**
 * [INPUT]: Main-owned AppRecord update custody and an optional internal operation identity.
 * [OUTPUT]: Rejects source and lifecycle mutations owned by another update transaction.
 * [POS]: Shared update fence for AppStore, Agent edit admission and rebuild entry points.
 */
import type { AppRecord } from "../../../../shared/ipc/apps/apps-ipc";
export function assertUpdateIdle(record: AppRecord | undefined, operationId?: string) {
  if (record?.presetUpdate && record.presetUpdate.operationId !== operationId) throw new Error("APP_UPDATE_IN_PROGRESS");
}
