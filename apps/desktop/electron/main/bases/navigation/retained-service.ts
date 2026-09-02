/**
 * [INPUT]: Depends on BaseStore canonical navigation, attachment-family cleanup, Base events, and retained Project custody cleanup
 * [OUTPUT]: Provides promotion and exact-owner deletion for retained App data exposed in root Bases
 * [POS]: Bases navigation lifecycle owner; BasesService delegates retained-data policy instead of embedding it among row and IO methods
 */

import { baseNavigationOf, type BasesEvent } from "../../../../shared/bases-ipc";
import type { BaseStore } from "../base-store";

type Dependencies = Readonly<{
  now: () => number;
  clearFamily: (ownerKey: string, ownerInstanceId: string) => void;
  emit: (event: BasesEvent) => void;
  onRemoved?: (projectId: string) => Promise<void>;
}>;

export class RetainedBaseNavigation {
  constructor(
    private readonly store: BaseStore,
    private readonly dependencies: Dependencies
  ) {}

  promote(projectId: string) {
    if (!this.store.get(`project:${projectId}`)) return null;
    return this.store.setNavigation(`project:${projectId}`, {
      kind: "root-user-managed",
      source: "retained-app-data",
      activatedAt: this.dependencies.now(),
    });
  }

  async remove(ownerKey: string, ownerInstanceId: string) {
    const snapshot = this.store.get(ownerKey, ownerInstanceId);
    if (!snapshot) return { removed: false };
    const navigation = baseNavigationOf(snapshot.meta);
    if (
      navigation.kind !== "root-user-managed" ||
      navigation.source !== "retained-app-data" ||
      snapshot.meta.owner.kind !== "project"
    ) {
      throw Object.assign(
        new Error("Only retained App data can be deleted here"),
        { status: 409 }
      );
    }
    if (!(await this.store.remove(ownerKey, ownerInstanceId))) {
      return { removed: false };
    }
    this.dependencies.clearFamily(ownerKey, ownerInstanceId);
    this.dependencies.emit({ type: "removed", ownerKey, ownerInstanceId });
    await this.dependencies.onRemoved?.(snapshot.meta.owner.projectId);
    return { removed: true };
  }
}
