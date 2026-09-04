/**
 * [INPUT]: Depends on canonical App source-state facts and Promise sequencing
 * [OUTPUT]: Provides the per-App mutation lane, a byte-observation revision projector that returns the current state unchanged when the fingerprint has not moved, and the exact publish-receipt validator
 * [POS]: Apps source concurrency kernel shared by install, repair, rebuild, and edit mutation paths
 */

import type { AppSourceState } from "../../../../shared/placement/facts";

/**
 * 指纹没动就把 `current` 原样交还——同一个对象，不是同值的新对象。上层据此
 * 判断「这次观察什么都没发生」，从而不写盘、不广播。给一条没变的事实盖一枚
 * 新的观察时间戳，只会让每 30 秒一次的轮询把整本 apps.json 重写一遍。
 */
export function observeAppSource(
  current: AppSourceState,
  fingerprint: string,
  observedAt: number
): AppSourceState {
  return current.fingerprint === fingerprint
    ? current
    : {
        sourceRevision: current.sourceRevision + 1,
        fingerprint,
        lastReconciledAt: observedAt,
      };
}

export function assertAppSourceReceipt(
  current: AppSourceState,
  receipt: AppSourceState
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
