/**
 * [INPUT]: Depends on App build contracts, authoritative candidate inventory, canonical App Project/backend context, capability policy, reservation ledger, and sealed-resolution reader
 * [OUTPUT]: Provides AppExtensionBuildParticipant prepare/finalize/abort, frozen exact-instance handoff, and generation drain counts
 * [POS]: App×Extension build single writer; live precedence is resolved once at prepare and old App generations retain their frozen binding
 */

import type {
  AppGenerationBuildCheckpoint,
  AppGenerationBuildOperation,
  AppGenerationDrainCount,
} from "../../../../shared/app-lifecycle";
import type {
  ExtensionInventorySnapshot,
  FrozenAppExtensionRequirementSetV1,
} from "../../../../shared/extensions-ipc";
import type { TurnProjectContext } from "../../../../shared/product-resource-scope";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import { buildEffectiveExtensionProjection } from "../capability-snapshot";
import {
  EXTENSION_PRODUCT_POLICY,
  backendExtensionProbe,
} from "../product-policy";
import { canonicalJson } from "../registry-store";
import { freezeAppExtensionRequirements } from "./requirement-resolver";
import type { AppExtensionReservationLedger } from "./reservation-ledger";

/* ── 窄端口：participant 既不 import AppStore，也不回查 live Registry ────── */

export type AppExtensionInventorySource = Readonly<{
  visibleInventory(context: TurnProjectContext): ExtensionInventorySnapshot;
}>;

export type SealedAppExtensionResolution = Readonly<{
  frozenSet: FrozenAppExtensionRequirementSetV1;
  packageGenerationReservationId: string;
}>;

export type SealedAppResolutionReader = (input: {
  appId: string;
  appGenerationId: string;
}) => SealedAppExtensionResolution | null;

export type AppExtensionHandoff = Readonly<{
  reservationId: string;
  frozenSet: FrozenAppExtensionRequirementSetV1;
}>;

export class AppExtensionBuildParticipant {
  constructor(
    private readonly inventory: AppExtensionInventorySource,
    private readonly reservations: AppExtensionReservationLedger,
    private readonly readSealed: SealedAppResolutionReader,
    private readonly projectContextForApp: (
      appId: string
    ) => TurnProjectContext = () => ({
      projectId: null,
      projectLifecycleRevision: null,
    }),
    private readonly backendForApp: (appId: string) => AgentBackendId = () =>
      "codex"
  ) {}

  /* ① 在自身 gate 内用同一份 inventory snapshot 冻结整张图，并与 prepared
     reservation 一起 fsync。此后 AppStore 只复制，绝不重算。 */
  async prepare(
    operation: AppGenerationBuildOperation
  ): Promise<AppGenerationBuildCheckpoint> {
    if (!operation.extensionRequirements.length) {
      return this.attention(operation, "build 无 extensionRequirements，不应触发 participant");
    }
    try {
      const backend = this.backendForApp(operation.appId);
      const effective = buildEffectiveExtensionProjection({
        inventory: this.inventory.visibleInventory(
          this.projectContextForApp(operation.appId)
        ),
        probe: backendExtensionProbe(
          backend,
          `${backend}:app-build`,
          "app-build"
        ),
        policy: EXTENSION_PRODUCT_POLICY,
        deliveryScope: "app",
      });
      const reservation = await this.reservations.prepare({
        generationBuildId: operation.generationBuildId,
        expectedRevision: this.fenceRevision(operation.generationBuildId),
        appId: operation.appId,
        frozenSet: freezeAppExtensionRequirements({
          appGenerationId: operation.appGenerationId,
          declarations: operation.extensionRequirements,
          inventory: effective.inventory,
        }),
      });
      return {
        kind: "app-extension",
        operationId: reservation.reservationId,
        state: "prepared",
      };
    } catch (cause) {
      return this.attention(operation, message(cause));
    }
  }

  /* ④ 逐字节复核 AppStore 已落账的 frozen set 与 reservation id；AppStore 尚未
     落账不是失败，而是可重放的 needs-attention。 */
  async finalize(
    operation: AppGenerationBuildOperation
  ): Promise<AppGenerationBuildCheckpoint> {
    /* 幂等先行：commit 成功后 handoff payload 就被删了，若仍以「没有 handoff」
       判失败，则「commit 已落账但 build phase 未推进时崩溃」会让重放把一条本已
       成功的 build 推进 needs-attention。§3.3 要求 finalizer 可重放。 */
    const committed = this.committedReservation(operation.generationBuildId);
    if (committed) {
      return {
        kind: "app-extension",
        operationId: committed.reservationId,
        state: "committed",
      };
    }
    const handoff = this.handoff(operation.generationBuildId);
    if (!handoff) return this.attention(operation, "prepared reservation 不存在");
    const sealed = this.readSealed({
      appId: operation.appId,
      appGenerationId: operation.appGenerationId,
    });
    if (!sealed) return this.attention(operation, "AppGeneration 尚未落账 frozen resolution");
    if (
      sealed.packageGenerationReservationId !== handoff.reservationId ||
      canonicalJson(sealed.frozenSet) !== canonicalJson(handoff.frozenSet)
    ) {
      return this.attention(operation, "AppGeneration frozen set 与 handoff 不一致");
    }
    try {
      const reservation = await this.reservations.commit({
        generationBuildId: operation.generationBuildId,
        expectedRevision: this.fenceRevision(operation.generationBuildId),
        appGenerationFrozenSet: sealed.frozenSet,
      });
      return {
        kind: "app-extension",
        operationId: reservation.reservationId,
        state: "committed",
      };
    } catch (cause) {
      return this.attention(operation, message(cause));
    }
  }

  /* abort 即使 fence 尚不存在也写 durable tombstone；迟到 prepare 因此永久被拒。 */
  async abort(
    operation: AppGenerationBuildOperation
  ): Promise<AppGenerationBuildCheckpoint> {
    const fence = await this.reservations.abort(operation.generationBuildId);
    return {
      kind: "app-extension",
      operationId: fence.reservationId ?? `ext:${operation.generationBuildId}`,
      state: "aborted",
    };
  }

  /** 已 committed 的 reservation；finalize 的幂等判据，不依赖 handoff payload。 */
  private committedReservation(generationBuildId: string) {
    const state = this.reservations.snapshot();
    const fence = state.fences.find(
      (item) => item.generationBuildId === generationBuildId
    );
    if (fence?.disposition !== "reservation-committed") return null;
    return (
      state.reservations.find(
        (item) => item.reservationId === fence.reservationId
      ) ?? null
    );
  }

  /* ③ Attach 复制 handoff 的唯一读口；finalize 后 payload 消失，只剩 committed ref。 */
  handoff(generationBuildId: string): AppExtensionHandoff | null {
    const state = this.reservations.snapshot();
    const fence = state.fences.find(
      (item) => item.generationBuildId === generationBuildId
    );
    const reservation = state.reservations.find(
      (item) => item.reservationId === fence?.reservationId
    );
    if (!reservation?.handoffFrozenSet) return null;
    return {
      reservationId: reservation.reservationId,
      frozenSet: reservation.handoffFrozenSet,
    };
  }

  /* prepared|committed 一律是 package generation 强引用，所以也是 App generation
     的 drain blocker——释放只能走 release()。 */
  generationDrainCount(input: {
    appId: string;
    generationId: string;
  }): AppGenerationDrainCount {
    const held = this.reservations
      .snapshot()
      .reservations.filter(
        (item) =>
          item.appId === input.appId &&
          item.appGenerationId === input.generationId &&
          item.state !== "released"
      );
    return {
      providerId: "app-extension-reservation",
      count: held.length,
      evidenceIds: held.map((item) => item.reservationId),
    };
  }

  async release(generationBuildId: string) {
    await this.reservations.release(
      generationBuildId,
      this.fenceRevision(generationBuildId)
    );
  }

  private fenceRevision(generationBuildId: string) {
    return (
      this.reservations
        .snapshot()
        .fences.find((item) => item.generationBuildId === generationBuildId)
        ?.revision ?? 0
    );
  }

  /* needs-attention 是非终态：不降级跳过，也不静默——原因必须能被排障看见。 */
  private attention(
    operation: AppGenerationBuildOperation,
    reason: string
  ): AppGenerationBuildCheckpoint {
    console.warn(
      `[app-extension] build ${operation.generationBuildId} needs-attention：${reason}`
    );
    return {
      kind: "app-extension",
      operationId: `ext:${operation.generationBuildId}`,
      state: "needs-attention",
    };
  }
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
