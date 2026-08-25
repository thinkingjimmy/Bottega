/**
 * [INPUT]: Depends on shared BackendModelInfo with supervised-commanded shared flight waiting for native language
 * [OUTPUT]: Provides createModelCatalog template TTL cache + singleflight + generation fence + Abort Unified model directory core isolated
 * [POS]: The only mechanism layer in the model directory of backends; The four descriptors declare that key and read, cache/default definitions are no longer repeated
 */

import type { BackendModelInfo } from "../../../shared/agent-ipc";
import { waitForSharedFlight } from "./supervised-command";

const CACHE_TTL_MS = 5 * 60_000;

export type ModelCatalogSpec<TRuntime> = {
  /** invalidate 中止在飞 flight 时的诊断主语，如 "Kimi 模型目录" */
  label: string;
  /** 缓存身份：必须包含会改变目录内容的全部输入（executable/version/状态根/workspace…） */
  key(runtime: TRuntime, workspace: string): string;
  read(
    runtime: TRuntime,
    workspace: string,
    signal: AbortSignal
  ): Promise<BackendModelInfo[]>;
  now?(): number;
  ttlMs?: number;
};

export type ModelCatalog<TRuntime> = {
  list(
    runtime: TRuntime,
    workspace: string,
    signal?: AbortSignal
  ): Promise<BackendModelInfo[]>;
  /** 用户显式 Recheck 后目录必须立刻重取；TTL 是省事的默认，不是真相。 */
  invalidate(): void;
};

export function createModelCatalog<TRuntime>(
  spec: ModelCatalogSpec<TRuntime>
): ModelCatalog<TRuntime> {
  const now = spec.now ?? Date.now;
  const ttlMs = spec.ttlMs ?? CACHE_TTL_MS;
  const cache = new Map<
    string,
    { expiresAt: number; models: BackendModelInfo[] }
  >();
  type ModelFlight = {
    generation: number;
    controller: AbortController;
    promise: Promise<BackendModelInfo[]>;
  };
  const pending = new Map<string, ModelFlight>();
  let generation = 0;

  return {
    async list(runtime, workspace, signal) {
      signal?.throwIfAborted();
      const key = spec.key(runtime, workspace);
      const current = cache.get(key);
      if (current && current.expiresAt > now()) {
        return structuredClone(current.models);
      }
      /* singleflight 的后加入者只取消自己的等待；首个 caller 是实际 flight
         owner，它的 signal 才控制共享子进程。 */
      const active = pending.get(key);
      if (active) {
        return structuredClone(
          await waitForSharedFlight(active.promise, signal)
        );
      }
      const flightGeneration = generation;
      const controller = new AbortController();
      const flightSignal = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal;
      const request = spec
        .read(runtime, workspace, flightSignal)
        .catch((cause) => {
          controller.abort(cause);
          throw cause;
        });
      const flight = {
        generation: flightGeneration,
        controller,
        promise: request,
      };
      pending.set(key, flight);
      try {
        const models = await request;
        /* invalidate 之后旧 flight 即使成功也不得回填缓存 */
        if (generation === flightGeneration) {
          cache.set(key, {
            models: structuredClone(models),
            expiresAt: now() + ttlMs,
          });
        }
        return structuredClone(models);
      } finally {
        if (pending.get(key) === flight) pending.delete(key);
      }
    },
    invalidate() {
      generation += 1;
      cache.clear();
      for (const flight of pending.values()) {
        flight.controller.abort(new Error(`${spec.label}已失效`));
      }
      pending.clear();
    },
  };
}
