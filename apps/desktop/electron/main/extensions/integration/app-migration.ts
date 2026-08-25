/**
 * [INPUT]: Depends on reservation ledger package generation Strong reference with durable migrationId on the Attach side
 * [OUTPUT]: Provides AppExtensionMigrator: Listing its still-binding App by package generation ref, and staying up to new pending generations as stable
 * [POS]: The App's update migration page for the AppXExtension; The only answer is "Who else is referring to the old generation?" and the new generation identity is written by Attach alone
 */

import type { ExtensionPackageGenerationRef } from "../../../../shared/extensions-ipc";
import type { ExtensionAffectedApp } from "../install/installer";
import type { AppExtensionReservationLedger } from "./reservation-ledger";

/** Attach 侧的唯一动作：为该 App 起一条新的 pending 代（同 manifest 也必须换代）。 */
export type AppGenerationMigrationCommand = (
  appId: string,
  migrationId: string
) => Promise<void>;

export class AppExtensionMigrator {
  constructor(
    private readonly reservations: AppExtensionReservationLedger,
    private readonly command: AppGenerationMigrationCommand
  ) {}

  /* prepared 与 committed 都是强引用，所以两者都算「仍绑定旧代」；released
     不算。同一个 App 的多条 reservation 去重后才是用户看见的那一行。 */
  boundApps(
    refs: readonly ExtensionPackageGenerationRef[]
  ): readonly ExtensionAffectedApp[] {
    const keys = new Set(
      refs.map((ref) => `${ref.packageGenerationId}:${ref.recordDigest}`)
    );
    const bound = new Map<string, ExtensionAffectedApp>();
    for (const reservation of this.reservations.snapshot().reservations) {
      if (reservation.state === "released") continue;
      const holds = reservation.packageGenerationRefs.some((item) =>
        keys.has(`${item.packageGenerationId}:${item.recordDigest}`)
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

  migrate(appId: string, migrationId: string) {
    return this.command(appId, migrationId);
  }
}
