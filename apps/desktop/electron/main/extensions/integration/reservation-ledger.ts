/**
 * [INPUT]: Depends on Node durable JSON, canonical JSON identity, and Registry generation refs with frozen requirement handoff sets
 * [OUTPUT]: Provides AppExtensionReservationLedger prepare/commit/abort/release with canonical frozen-set comparison and permanent generationBuildId tombstones
 * [POS]: Single writer of App×Extension durable handoffs; object insertion order never creates a false generation drift
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ExtensionPackageGenerationRef,
  FrozenAppExtensionRequirementSetV1,
} from "../../../../shared/extensions-ipc";
import { canonicalJson, type ExtensionRegistryStore } from "../registry-store";

export type AppExtensionBuildFence = {
  generationBuildId: string;
  revision: number;
  disposition:
    | "open"
    | "reservation-prepared"
    | "reservation-committed"
    | "abort-pending"
    | "aborted"
    | "released";
  reservationId?: string;
};

export type AppPackageGenerationReservation = {
  reservationId: string;
  generationBuildId: string;
  appId: string;
  appGenerationId: string;
  requirementResolutionDigest: string;
  packageGenerationRefs: ExtensionPackageGenerationRef[];
  state: "prepared" | "committed" | "released";
  handoffFrozenSet?: FrozenAppExtensionRequirementSetV1;
};

type Ledger = {
  schemaVersion: 1;
  fences: AppExtensionBuildFence[];
  reservations: AppPackageGenerationReservation[];
  retiredBuildIds: string[];
};

export class AppExtensionReservationLedger {
  readonly filePath: string;
  private state: Ledger = {
    schemaVersion: 1,
    fences: [],
    reservations: [],
    retiredBuildIds: [],
  };
  private serial = Promise.resolve();

  constructor(
    userData: string,
    private readonly registry: ExtensionRegistryStore
  ) {
    this.filePath = join(userData, "agent-extensions", "app-reservations.json");
  }

  async initialize() {
    try {
      this.state = validateLedger(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      await this.persist();
    }
    await this.reconcileRefs();
  }

  prepare(input: {
    generationBuildId: string;
    expectedRevision: number;
    appId: string;
    frozenSet: FrozenAppExtensionRequirementSetV1;
  }) {
    return this.mutate(async () => {
      this.assertNotRetired(input.generationBuildId);
      const fence = this.fence(input.generationBuildId, true)!;
      if (
        fence.disposition === "reservation-prepared" ||
        fence.disposition === "reservation-committed"
      ) {
        return structuredClone(this.requireReservation(fence.reservationId!));
      }
      this.assertFence(fence, input.expectedRevision, "open");
      const packageGenerationRefs = uniqueRefs(
        input.frozenSet.extensionRequirements.flatMap((entry) =>
          entry.state === "resolved" ? [entry.packageGenerationRef] : []
        )
      );
      const reservation: AppPackageGenerationReservation = {
        reservationId: randomUUID(),
        generationBuildId: input.generationBuildId,
        appId: input.appId,
        appGenerationId: input.frozenSet.appGenerationId,
        requirementResolutionDigest: input.frozenSet.resolutionDigest,
        packageGenerationRefs,
        state: "prepared",
        handoffFrozenSet: structuredClone(input.frozenSet),
      };
      this.state.reservations.push(reservation);
      fence.revision += 1;
      fence.disposition = "reservation-prepared";
      fence.reservationId = reservation.reservationId;
      await this.persist();
      for (const ref of packageGenerationRefs) {
        await this.registry.acquireGenerationRef(ref, refOwner(reservation));
      }
      return structuredClone(reservation);
    });
  }

  commit(input: {
    generationBuildId: string;
    expectedRevision: number;
    appGenerationFrozenSet: FrozenAppExtensionRequirementSetV1;
  }) {
    return this.mutate(() => {
      const fence = this.requireFence(input.generationBuildId);
      if (fence.disposition === "reservation-committed") {
        return structuredClone(this.requireReservation(fence.reservationId!));
      }
      this.assertFence(fence, input.expectedRevision, "reservation-prepared");
      const reservation = this.requireReservation(fence.reservationId!);
      if (
        reservation.requirementResolutionDigest !==
          input.appGenerationFrozenSet.resolutionDigest ||
        canonicalJson(reservation.handoffFrozenSet) !==
          canonicalJson(input.appGenerationFrozenSet)
      ) {
        throw Object.assign(new Error("App generation frozen handoff 不一致"), {
          status: 409,
        });
      }
      reservation.state = "committed";
      delete reservation.handoffFrozenSet;
      fence.revision += 1;
      fence.disposition = "reservation-committed";
      return structuredClone(reservation);
    });
  }

  async abort(generationBuildId: string, expectedRevision?: number) {
    return this.mutate(async () => {
      let fence = this.fence(generationBuildId, false);
      if (!fence) {
        fence = { generationBuildId, revision: 1, disposition: "aborted" };
        this.state.fences.push(fence);
        this.retire(generationBuildId);
        return structuredClone(fence);
      }
      if (fence.disposition === "aborted" || fence.disposition === "released") {
        return structuredClone(fence);
      }
      if (expectedRevision !== undefined && fence.revision !== expectedRevision) {
        throw conflict("App extension build fence revision 已变化");
      }
      fence.revision += 1;
      fence.disposition = "abort-pending";
      await this.persist();
      const reservation = fence.reservationId
        ? this.requireReservation(fence.reservationId)
        : undefined;
      if (reservation) await this.releaseRefs(reservation);
      if (reservation) reservation.state = "released";
      fence.revision += 1;
      fence.disposition = "aborted";
      this.retire(generationBuildId);
      return structuredClone(fence);
    });
  }

  release(generationBuildId: string, expectedRevision: number) {
    return this.mutate(async () => {
      const fence = this.requireFence(generationBuildId);
      if (fence.disposition === "released") return structuredClone(fence);
      this.assertFence(fence, expectedRevision, "reservation-committed");
      const reservation = this.requireReservation(fence.reservationId!);
      await this.releaseRefs(reservation);
      reservation.state = "released";
      fence.revision += 1;
      fence.disposition = "released";
      this.retire(generationBuildId);
      return structuredClone(fence);
    });
  }

  snapshot() {
    return structuredClone(this.state);
  }

  private async reconcileRefs() {
    for (const reservation of this.state.reservations) {
      if (reservation.state === "released") continue;
      for (const ref of reservation.packageGenerationRefs) {
        await this.registry.acquireGenerationRef(ref, refOwner(reservation));
      }
    }
  }

  private async releaseRefs(reservation: AppPackageGenerationReservation) {
    for (const ref of reservation.packageGenerationRefs) {
      await this.registry.releaseGenerationRef(ref, refOwner(reservation));
    }
  }

  private fence(generationBuildId: string, create: boolean) {
    let fence = this.state.fences.find(
      (item) => item.generationBuildId === generationBuildId
    );
    if (!fence && create) {
      fence = { generationBuildId, revision: 0, disposition: "open" };
      this.state.fences.push(fence);
    }
    return fence;
  }

  private requireFence(generationBuildId: string) {
    const fence = this.fence(generationBuildId, false);
    if (!fence) throw new Error("App extension build fence 不存在");
    return fence;
  }

  private requireReservation(reservationId: string) {
    const reservation = this.state.reservations.find(
      (item) => item.reservationId === reservationId
    );
    if (!reservation) throw new Error("App extension reservation 不存在");
    return reservation;
  }

  private assertFence(
    fence: AppExtensionBuildFence,
    expectedRevision: number,
    disposition: AppExtensionBuildFence["disposition"]
  ) {
    if (fence.revision !== expectedRevision || fence.disposition !== disposition) {
      throw conflict("App extension build fence 已变化");
    }
  }

  private assertNotRetired(generationBuildId: string) {
    if (this.state.retiredBuildIds.includes(generationBuildId)) {
      throw conflict("App extension build 已永久退役");
    }
  }

  private retire(generationBuildId: string) {
    if (!this.state.retiredBuildIds.includes(generationBuildId)) {
      this.state.retiredBuildIds.push(generationBuildId);
      this.state.retiredBuildIds.sort();
    }
  }

  private async mutate<T>(operation: () => T | Promise<T>) {
    const wait = this.serial;
    let release!: () => void;
    this.serial = new Promise<void>((resolve) => {
      release = resolve;
    });
    await wait;
    const previous = structuredClone(this.state);
    try {
      const value = await operation();
      await this.persist();
      return value;
    } catch (cause) {
      this.state = previous;
      throw cause;
    } finally {
      release();
    }
  }

  private async persist() {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.filePath);
  }
}

function uniqueRefs(refs: readonly ExtensionPackageGenerationRef[]) {
  return [...new Map(refs.map((ref) => [`${ref.packageGenerationId}:${ref.recordDigest}`, ref])).values()];
}

function refOwner(reservation: AppPackageGenerationReservation) {
  return `app-reservation:${reservation.reservationId}`;
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}

function validateLedger(value: unknown): Ledger {
  if (!value || typeof value !== "object") throw new Error("reservation ledger 无效");
  const record = value as Partial<Ledger>;
  if (
    record.schemaVersion !== 1 ||
    !Array.isArray(record.fences) ||
    !Array.isArray(record.reservations) ||
    !Array.isArray(record.retiredBuildIds)
  ) {
    throw new Error("reservation ledger schema 无效");
  }
  return structuredClone(record as Ledger);
}
