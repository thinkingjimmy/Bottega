/**
 * [INPUT]: Depends on persistence/serial-queue and shared MemoryRuntime Snapshot
 * [OUTPUT]: Provides MemoryRuntime SnapshotPublisher, which generates, numbers and publishes snapshots while running in sequence; The transfer continues across normal snapshots before explicitly clearing
 * [POS]: The linearity of the flash boundary of memory/runtime; Permanent facts are read when lane flush, transfer valves are frozen when calling and are exclusive to the current value by the publisher
 */

import type { MemoryRuntimeSnapshot } from "../../../../shared/memory-ipc";
import { SerialQueue } from "../../persistence/serial-queue";

export class MemoryRuntimeSnapshotPublisher {
  private readonly lane = new SerialQueue();
  private revision = 0;
  private transfer: MemoryRuntimeSnapshot["transfer"] = null;

  constructor(
    private readonly read: (revision: number) => Promise<MemoryRuntimeSnapshot>,
    private readonly emit?: (snapshot: MemoryRuntimeSnapshot) => void
  ) {}

  /** 纯读也进同一 lane：它只观察所有先行 publish 已提交的 revision。 */
  snapshot() {
    return this.lane.enqueue(async () => ({
      ...(await this.read(this.revision)),
      transfer: this.transfer,
    }));
  }

  publish(
    overrides?: Partial<
      Omit<MemoryRuntimeSnapshot, "providerId" | "revision">
    >
  ) {
    const frozen = overrides ? structuredClone(overrides) : undefined;
    return this.lane.enqueue(async () => {
      const revision = this.revision + 1;
      const base = await this.read(revision);
      /* 键在即为显式意图；显式传 undefined 与传 null 说的是同一件事
         ——「这一帧没有传输」，归一成 null 让 owner 只持一种缺席。 */
      if (frozen && "transfer" in frozen) this.transfer = frozen.transfer ?? null;
      const snapshot = { ...base, transfer: this.transfer, ...frozen };
      this.revision = revision;
      this.emit?.(snapshot);
      return snapshot;
    });
  }
}
