/**
 * [INPUT]: Depends on SurfaceResidenceLedger CAS, a main-validated target route, and bounded SurfaceCapsuleV1 exchange ports
 * [OUTPUT]: Provides SurfaceMigrationCoordinator with export→main-route normalization→CAS→hydrate→source-retire ordering, pre-hydrate rollback, transaction fencing, and drain
 * [POS]: Window surfaces core migration state machine; successful target hydrate is the no-rollback ownership point, while source retirement is cleanup
 */

import { randomUUID } from "node:crypto";
import type {
  SurfaceCapsuleV1,
  SurfaceKey,
  SurfaceResidence,
} from "../../../../../shared/window-surfaces-ipc";
import { assertSurfaceCapsule } from "./surface-capsule";
import { SurfaceResidenceLedger } from "./surface-residence";

export type SurfaceMigrationPorts = Readonly<{
  exportCapsule(
    sourceWindowId: string,
    transactionId: string,
    surface: SurfaceKey
  ): Promise<SurfaceCapsuleV1>;
  commitSource(
    sourceWindowId: string,
    transactionId: string,
    capsule: SurfaceCapsuleV1
  ): Promise<void>;
  hydrate(
    targetWindowId: string,
    sourceWindowId: string,
    transactionId: string,
    capsule: SurfaceCapsuleV1
  ): Promise<void>;
  restore(
    sourceWindowId: string,
    failedTargetWindowId: string,
    transactionId: string,
    capsule: SurfaceCapsuleV1
  ): Promise<void>;
}>;

export type SurfaceMigrationInput = Readonly<{
  surface: SurfaceKey;
  targetRoute: string;
  /** 关窗/退出收回时目标路由取胶囊自述（用户停在 data 就回 data），意图式打开仍用显式路由。 */
  deriveRouteFromCapsule?: true;
  expectedRevision: number;
  sourceWindowId: string;
  sourceResidenceWindowId: string | null;
  targetWindowId: string;
  targetResidenceWindowId: string | null;
  companions?: readonly Readonly<{
    surface: SurfaceKey;
    expectedRevision: number;
  }>[];
}>;

export type SurfaceMigrationResult = Readonly<{
  primary: SurfaceResidence;
  residences: readonly SurfaceResidence[];
  targetRoute: string;
}>;

export class SurfaceMigrationCoordinator {
  private readonly active = new Map<SurfaceKey, Promise<SurfaceMigrationResult>>();

  constructor(
    private readonly residence: SurfaceResidenceLedger,
    private readonly ports: SurfaceMigrationPorts
  ) {}

  migrate(input: SurfaceMigrationInput) {
    const surfaces = [input.surface, ...(input.companions ?? []).map((item) => item.surface)];
    const conflict = surfaces.find((surface) => this.active.has(surface));
    if (conflict) {
      return Promise.reject(new Error(`Surface migration already active: ${conflict}`));
    }
    const operation = this.drive(input).finally(() => {
      for (const surface of surfaces) {
        if (this.active.get(surface) === operation) this.active.delete(surface);
      }
    });
    for (const surface of surfaces) this.active.set(surface, operation);
    return operation;
  }

  async drain() {
    await Promise.allSettled([...this.active.values()]);
  }

  get activeCount() {
    return this.active.size;
  }

  isMigrating(surface: SurfaceKey) {
    return this.active.has(surface);
  }

  private async drive(input: SurfaceMigrationInput) {
    const transactionId = randomUUID();
    const capsule = assertSurfaceCapsule(
      await this.ports.exportCapsule(
        input.sourceWindowId,
        transactionId,
        input.surface
      ),
      input.deriveRouteFromCapsule ? undefined : input.targetRoute
    );
    if (capsule.surface !== input.surface) {
      throw new Error("Surface capsule identity mismatch");
    }
    const targetRoute = input.deriveRouteFromCapsule
      ? capsule.route.pathname
      : input.targetRoute;
    const moves = [
      { surface: input.surface, expectedRevision: input.expectedRevision },
      ...(input.companions ?? []),
    ];
    let claimed: readonly SurfaceResidence[];
    try {
      claimed = this.residence.moveMany(
        moves.map((move) => ({
          ...move,
          windowId: input.targetResidenceWindowId,
        }))
      );
    } catch (cause) {
      await this.restoreSource(input, transactionId, capsule);
      throw cause;
    }
    try {
      await this.ports.hydrate(
        input.targetWindowId,
        input.sourceWindowId,
        transactionId,
        capsule
      );
    } catch (cause) {
      /* 回滚 CAS 可能撞上 crash 回收已推进的 revision——那时面已被安置回主窗，
         回滚失败不许吞掉 restoreSource：源窗 composer 冻结即永久性草稿事故。 */
      try {
        this.residence.moveMany(
          claimed.map((residence) => ({
            surface: residence.surface,
            expectedRevision: residence.claimRevision,
            windowId: input.sourceResidenceWindowId,
          }))
        );
      } catch {
        /* crash 回收已接管驻留；restoreSource 仍必须执行。 */
      }
      await this.restoreSource(input, transactionId, capsule);
      throw cause;
    }
    await this.ports.commitSource(
      input.sourceWindowId,
      transactionId,
      capsule
    ).catch(() => undefined);
    return { primary: claimed[0]!, residences: claimed, targetRoute };
  }

  private restoreSource(
    input: SurfaceMigrationInput,
    transactionId: string,
    capsule: SurfaceCapsuleV1
  ) {
    return this.ports.restore(
      input.sourceWindowId,
      input.targetWindowId,
      transactionId,
      capsule
    ).catch(() => undefined);
  }
}
