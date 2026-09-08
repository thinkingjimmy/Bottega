/**
 * [INPUT]: Depends on the App reservation ledger's package-generation strong references, the shared refKey, and the Attach-side migration command keyed by a durable migrationId
 * [OUTPUT]: Provides AppExtensionMigrator: lists Apps still bound to given package generation refs and forwards migration to a new pending App generation
 * [POS]: The App×Extension update/uninstall migration surface; it only answers "who still references the old generation" while the new generation identity is written by Attach alone
 */

import type { ExtensionPackageGenerationRef } from "../../../../shared/extensions-ipc";
import type { ExtensionAffectedApp } from "../install/installer";
import { refKey } from "../registry-canonical";
import type { AppExtensionReservationLedger } from "./reservation-ledger";

/** Attach 侧的唯一动作：为该 App 起一条新的 pending 代（同 manifest 也必须换代）。 */
export type AppGenerationMigrationCommand = (
  appId: string,
  migrationId: string
) => Promise<void>;

export class AppExtensionMigrator {
  constructor(
    private readonly reservations: AppExtensionReservationLedger,
    readonly migrate: AppGenerationMigrationCommand
  ) {}

  /* prepared 与 committed 都是强引用，所以两者都算「仍绑定旧代」；released
     不算。同一个 App 的多条 reservation 去重后才是用户看见的那一行。 */
  boundApps(
    refs: readonly ExtensionPackageGenerationRef[]
  ): readonly ExtensionAffectedApp[] {
    const keys = new Set(refs.map(refKey));
    const bound = new Map<string, ExtensionAffectedApp>();
    for (const reservation of this.reservations.snapshot().reservations) {
      if (reservation.state === "released") continue;
      const holds = reservation.packageGenerationRefs.some((item) =>
        keys.has(refKey(item))
      );
      if (!holds) continue;
      bound.set(`${reservation.appId}\0${reservation.appGenerationId}`, {
        appId: reservation.appId,
        appGenerationId: reservation.appGenerationId,
      });
    }
    return [...bound.values()].sort((left, right) =>
      left.appId.localeCompare(right.appId)
    );
  }
}
