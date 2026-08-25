/**
 * [INPUT]: Depends on AsyncLocalStorage and Promise
 * [OUTPUT]: Provides process-only Memory SpaceGate, sequence with Space/different Space parallel to the nested fail-fast diagnosis
 * [POS]: The main/memory linear coordinated native language; No lasting status, not the fifth Owner
 */

import { AsyncLocalStorage } from "node:async_hooks";

type GateContext = Readonly<{ kind: "memory-space"; key: string }>;

export class MemorySpaceGate {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly context = new AsyncLocalStorage<GateContext>();

  held() {
    return this.context.getStore() ?? null;
  }

  assertOutside(label: string) {
    const held = this.held();
    if (held) {
      throw new Error(`${label} 不得在 MemorySpaceGate(${held.key}) 内执行`);
    }
  }

  assertHeld(memorySpaceId: string, label: string) {
    const expected = `space:${memorySpaceId}`;
    const held = this.held();
    if (held?.key !== expected) {
      throw new Error(`${label} 必须在 MemorySpaceGate(${expected}) 内执行`);
    }
  }

  run<T>(memorySpaceId: string, task: () => Promise<T> | T): Promise<T> {
    if (this.held()) {
      throw new Error("MemorySpaceGate 禁止嵌套或重入");
    }
    const key = `space:${memorySpaceId}`;
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => next);
    this.tails.set(key, tail);
    return previous
      .then(() => this.context.run({ kind: "memory-space", key }, task))
      .finally(() => {
        release();
        if (this.tails.get(key) === tail) this.tails.delete(key);
      });
  }
}

export const memorySpaceGate = new MemorySpaceGate();
