/**
 * [INPUT]: Depends on canonical App source-state facts and Promise sequencing
 * [OUTPUT]: Provides the per-App mutation lane, byte-observation revision projector, and exact publish-receipt validator
 * [POS]: Apps source concurrency kernel shared by install, repair, rebuild, and edit mutation paths
 */

import type { AppSourceState } from "../../../shared/placement/facts";

export type AppSourceReceipt = AppSourceState;

export function observeAppSource(
  current: AppSourceState,
  fingerprint: string,
  observedAt: number
): AppSourceState {
  return current.fingerprint === fingerprint
    ? { ...current, lastReconciledAt: observedAt }
    : {
        sourceRevision: current.sourceRevision + 1,
        fingerprint,
        lastReconciledAt: observedAt,
      };
}

export function assertAppSourceReceipt(
  current: AppSourceState,
  receipt: AppSourceReceipt
) {
  if (
    current.sourceRevision !== receipt.sourceRevision ||
    current.fingerprint !== receipt.fingerprint
  ) {
    throw new Error("STALE_APP_SOURCE_RECEIPT");
  }
}

export class AppMutationCoordinator {
  private readonly flights = new Map<string, Promise<unknown>>();

  async acquire(appId: string) {
    const previous = this.flights.get(appId) ?? Promise.resolve();
    let admit!: () => void;
    let unlock!: () => void;
    const admitted = new Promise<void>((resolve) => { admit = resolve; });
    const held = new Promise<void>((resolve) => { unlock = resolve; });
    const flight = previous
      .catch(() => undefined)
      .then(() => {
        admit();
        return held;
      })
      .finally(() => {
        if (this.flights.get(appId) === flight) this.flights.delete(appId);
      });
    this.flights.set(appId, flight);
    await admitted;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      unlock();
    };
  }

  run<T>(appId: string, operation: () => Promise<T>) {
    const previous = this.flights.get(appId) ?? Promise.resolve();
    const flight = previous
      .catch(() => undefined)
      .then(operation)
      .finally(() => {
        if (this.flights.get(appId) === flight) this.flights.delete(appId);
      });
    this.flights.set(appId, flight);
    return flight;
  }

  async drain() {
    await Promise.allSettled(this.flights.values());
  }
}
