/**
 * [INPUT]: Depends on shared BackendModelInfo/ProviderId, the supervised shared-flight helper, and an injected ModelCatalogPersistence
 * [OUTPUT]: Provides executableFileKey and adapterDigestKey (what a catalog key names its CLI and adapter by) and createModelCatalog with cold/refresh probe admission, TTL/single-flight caching, generation-fenced durable invalidation, Abort isolation, same-runtime sibling reuse across workspaces, a probe-free `cached` read, and stale-while-revalidate that refreshes a durable list only once it is a day old, after an injectable grace and one background refresh at a time across all catalogs, plus persistence configuration and change notifications
 * [POS]: The only mechanism layer behind the four model catalogs; descriptors declare identity and reads, freshness and durability live here
 */

import type { ProviderId } from "@bottega/contracts/model/provider";
import type {
  BackendModelInfo,
} from "../../../../shared/ipc/agent/agent-ipc";
import type {
  ModelCatalogPersistence,
  PersistedModelCatalog,
} from "./model-catalog-store";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { waitForSharedFlight } from "../jobs/supervised-command";

/** A catalog key's CLI: the file itself (canonical path, device, inode, mtime, size), so a same-version binary replaced in
    place misses instead of serving the old list (TASK-13 A). An unreadable file keys as unreadable, never as a readable one. */
export function executableFileKey(executable: string) {
  try {
    const path = realpathSync(executable), stat = statSync(path, { bigint: true });
    return `${path}#${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.size}`;
  } catch { return `${executable}#unreadable`; }
}

const adapterDigests = new Map<string, string>();
/** The bundled ACP adapter an ACP-probed catalog reads through: its package.json and entry, hashed once per process (the
    adapter only changes with Bottega itself, so a new build misses the lists the old adapter produced). */
export function adapterDigestKey(entry: string) {
  let digest = adapterDigests.get(entry);
  if (digest) return digest;
  try {
    let root = dirname(entry);
    while (!existsSync(join(root, "package.json")) && dirname(root) !== root) root = dirname(root);
    digest = createHash("sha256").update(readFileSync(join(root, "package.json"))).update("\u0000").update(readFileSync(entry)).digest("hex").slice(0, 32);
  } catch { digest = "unreadable"; }
  adapterDigests.set(entry, digest);
  return digest;
}

const CACHE_TTL_MS = 5 * 60_000;
/* Past a week the last known list stops being a plausible "what this account
   has"; below it, serving the known list beats a skeleton on every launch. */
const STALE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/* A failing probe must not turn every composer open into another spawn; the
   stale list keeps serving until this cools down. */
const REFRESH_RETRY_MS = 60_000;
/* Launch is the contended moment: discovery, auth checks and quota reads all
   want the same process slots, and the list just served is already good enough
   to open the composer with. Letting them go first costs the refresh nothing. */
const REFRESH_DELAY_MS = 20_000;
/* A durable list younger than a day is served without a probe (C-10): model lists change rarely, a Recheck or a
   login return invalidates on the spot, and every refresh is a CLI process of 200–400 MB. */
const REFRESH_AFTER_MS = 24 * 60 * 60_000;

/* Background refreshes of all four catalogs run one at a time, so a launch never starts four CLI children at once. */
let backgroundTail: Promise<unknown> = Promise.resolve();
function serially<T>(task: () => Promise<T>) {
  const run = backgroundTail.then(task, task);
  backgroundTail = run.catch(() => undefined);
  return run;
}

export type ModelCatalogSpec<TRuntime> = {
  /** 缓存/通知身份：持久化命名空间与 models-invalidated 的主语。 */
  backend: ProviderId;
  /** invalidate 中止在飞 flight 时的诊断主语，如 "Kimi 模型目录" */
  label: string;
  /** 缓存身份：必须包含会改变目录内容的全部输入（executable/version/状态根/workspace…） */
  key(runtime: TRuntime, workspace: string): string;
  /** Key prefix every workspace of one runtime shares; declaring it enables sibling reuse. */
  family?(runtime: TRuntime): string;
  read(
    runtime: TRuntime,
    workspace: string,
    signal: AbortSignal
  ): Promise<BackendModelInfo[]>;
  now?(): number;
  ttlMs?: number;
  /** Injected next to `now` so tests drive the refresh grace deterministically. */
  schedule?(action: () => void, delayMs: number): unknown;
  cancel?(handle: unknown): void;
};

/** Only a newly started probe needs admission; cache hits and joiners do not. */
export type ModelCatalogProbeRunner = (
  read: () => Promise<BackendModelInfo[]>,
  signal: AbortSignal,
  context: { background: boolean }
) => Promise<BackendModelInfo[]>;

export type ModelCatalog<TRuntime> = {
  list(
    runtime: TRuntime,
    workspace: string,
    signal?: AbortSignal,
    runProbe?: ModelCatalogProbeRunner
  ): Promise<BackendModelInfo[]>;
  /** The list this desktop already knows (memory, durable copy or a sibling workspace), or null; never starts a probe. */
  cached(runtime: TRuntime, workspace: string): Promise<BackendModelInfo[] | null>;
  /** 用户显式 Recheck 后目录必须立刻重取；TTL 是省事的默认，不是真相。 */
  invalidate(): void;
};

/* The four catalogs are module singletons built at import time — long before
   userData exists — so durability is injected once the app owns a path, and
   stays absent (memory-only) in tests that never ask for it. */
let persistence: ModelCatalogPersistence | null = null;

export function configureModelCatalogPersistence(
  value: ModelCatalogPersistence | null
) {
  persistence = value;
}

type ModelCatalogListener = (backend: ProviderId) => void;

const listeners = new Set<ModelCatalogListener>();

/**
 * Fires when a background refresh proved the served list wrong. The renderer
 * has no way to learn that on its own: it already rendered the stale answer.
 */
export function onModelCatalogChanged(listener: ModelCatalogListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function announce(backend: ProviderId) {
  for (const listener of [...listeners]) {
    try {
      listener(backend);
    } catch {
      // One broken subscriber never costs the others their notification.
    }
  }
}

/* Key order is an accident of how each reader builds its objects, so identity
   is compared on a normalized shape, not on raw JSON text. */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, normalize(entry)])
  );
}

const sameModels = (left: BackendModelInfo[], right: BackendModelInfo[]) =>
  JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));

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
    takeOver(signal?: AbortSignal): boolean;
  };
  const pending = new Map<string, ModelFlight>();
  const schedule =
    spec.schedule ??
    ((action: () => void, delayMs: number) => {
      const timer = setTimeout(action, delayMs);
      timer.unref?.();
      return timer;
    });
  const cancelSchedule =
    spec.cancel ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));
  type ScheduledRefresh = { handle: unknown; cancelled: boolean };
  const refreshes = new Map<string, ScheduledRefresh>();
  const retryAfter = new Map<string, number>();
  const reported = new Set<string>();
  let generation = 0;
  let persistenceReady = Promise.resolve(true);

  function store(key: string, models: BackendModelInfo[]) {
    /* Every reader signals failure by throwing, so an empty resolve is the
       genuine "no models for this account" (OpenCode). Persisting that buys
       nothing and would make a degraded probe look like an answer. */
    if (models.length === 0 || !persistence) return;
    void persistence
      .write(spec.backend, key, { models, savedAt: now() })
      .catch(() => undefined);
  }

  function usable(entry: PersistedModelCatalog | null | undefined) {
    if (!entry) return null;
    const age = now() - entry.savedAt;
    /* A future stamp means the clock moved, not that the entry is fresh. */
    return age >= 0 && age <= STALE_MAX_AGE_MS ? entry : null;
  }

  async function staleModels(key: string) {
    /* Recheck must finish clearing before a new generation can read disk. If
       clearing fails, that durable copy remains unusable for this generation. */
    if (!(await persistenceReady)) return null;
    return usable(await persistence?.read(spec.backend, key).catch(() => null));
  }

  /* Opening a project this runtime has never been asked about is not a new
     account: the list a sibling workspace already proved is the same list, so
     the composer skips the cold interactive handshake and the delayed refresh
     still writes the exact key. */
  async function siblingModels(runtime: TRuntime) {
    if (!spec.family || !(await persistenceReady)) return null;
    return usable(
      await persistence
        ?.readNewest(spec.backend, spec.family(runtime))
        .catch(() => null)
    );
  }

  /* `fence` is the generation the caller entered on, not the one in scope when
     the flight finally starts: an invalidate that lands while the caller is
     still reading the durable layer must still void this read's backfill. */
  function begin(
    key: string,
    runtime: TRuntime,
    workspace: string,
    fence: number,
    signal?: AbortSignal,
    runProbe?: ModelCatalogProbeRunner,
    background = false
  ) {
    const flightGeneration = fence;
    const controller = new AbortController();
    const flightSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    const admission = new AbortController();
    let started = false;
    let transferred = false;
    const read = async (ownerSignal = flightSignal) => {
      started = true;
      ownerSignal.throwIfAborted();
      return spec.read(runtime, workspace, ownerSignal);
    };
    let resolve!: (models: BackendModelInfo[]) => void;
    let reject!: (cause: unknown) => void;
    const request = new Promise<BackendModelInfo[]>((success, failure) => {
      resolve = success;
      reject = failure;
    }).catch((cause) => {
      controller.abort(cause);
      throw cause;
    });
    const admissionSignal = AbortSignal.any([flightSignal, admission.signal]);
    const admitted = async () => runProbe
      ? runProbe(() => {
          admissionSignal.throwIfAborted();
          return read();
        }, admissionSignal, { background })
      : read();
    void admitted().then(
      models => { if (!transferred) resolve(models); },
      cause => { if (!transferred) reject(cause); }
    );
    const flight: ModelFlight = {
      generation: flightGeneration,
      controller,
      promise: request,
      takeOver(ownerSignal) {
        if (!runProbe || started || transferred) return false;
        /* A turn already owns a process slot. Waiting behind its own queued
           catalog would deadlock at capacity, so it lends that slot to the
           unstarted shared read and cancels only the queued reservation. */
        transferred = true;
        admission.abort(new DOMException("Model probe admission transferred", "AbortError"));
        const readSignal = ownerSignal
          ? AbortSignal.any([flightSignal, ownerSignal]) : flightSignal;
        void read(readSignal).then(resolve, reject);
        return true;
      },
    };
    pending.set(key, flight);
    return request
      .then((models) => {
        /* invalidate 之后旧 flight 即使成功也不得回填缓存 */
        if (generation === flightGeneration) {
          cache.set(key, {
            models: structuredClone(models),
            expiresAt: now() + ttlMs,
          });
          store(key, models);
        }
        return models;
      })
      .finally(() => {
        if (pending.get(key) === flight) pending.delete(key);
      });
  }

  function refresh(
    key: string,
    runtime: TRuntime,
    workspace: string,
    served: BackendModelInfo[],
    fence: number,
    runProbe?: ModelCatalogProbeRunner
  ) {
    if (pending.has(key)) return Promise.resolve();
    if ((retryAfter.get(key) ?? 0) > now()) return Promise.resolve();
    /* The caller already left with an answer, so the background flight listens
       to its own controller only — never to a signal that returned long ago. */
    return begin(key, runtime, workspace, fence, undefined, runProbe, true)
      .then((models) => {
        retryAfter.delete(key);
        reported.delete(key);
        if (generation !== fence) return;
        if (sameModels(served, models)) return;
        announce(spec.backend);
      })
      .catch((cause) => {
        /* invalidate aborts its own flights on purpose; that is not a failure
           to report, and the forced read that follows must not be cooled. */
        if (generation !== fence) return;
        retryAfter.set(key, now() + REFRESH_RETRY_MS);
        if (reported.has(key)) return;
        reported.add(key);
        console.warn(
          `[models:${spec.backend}] ${spec.label}后台刷新失败，继续提供已缓存目录`,
          cause
        );
      });
  }

  function revalidate(
    key: string,
    runtime: TRuntime,
    workspace: string,
    served: BackendModelInfo[],
    fence: number,
    runProbe?: ModelCatalogProbeRunner
  ) {
    /* Single-flight covers the loop the notification could otherwise close:
       the re-fetch it triggers hits the now-fresh memory entry and starts
       nothing, and a refresh already in the air — or merely waiting out the
       grace — never gets a twin. */
    if (pending.has(key) || refreshes.has(key)) return;
    if ((retryAfter.get(key) ?? 0) > now()) return;
    const scheduled: ScheduledRefresh = { handle: undefined, cancelled: false };
    /* Registered before scheduling, so even a scheduler that fires inline
       leaves exactly one entry per key behind. */
    refreshes.set(key, scheduled);
    scheduled.handle = schedule(() => {
      if (refreshes.get(key) === scheduled) refreshes.delete(key);
      if (scheduled.cancelled || generation !== fence) return;
      void serially(() => generation === fence ? refresh(key, runtime, workspace, served, fence, runProbe) : Promise.resolve());
    }, REFRESH_DELAY_MS);
  }

  return {
    async list(runtime, workspace, signal, runProbe) {
      signal?.throwIfAborted();
      const key = spec.key(runtime, workspace);
      const fence = generation;
      const current = cache.get(key);
      if (current && current.expiresAt > now()) {
        return structuredClone(current.models);
      }
      const stale = await staleModels(key);
      signal?.throwIfAborted();
      /* An invalidate during the read just declared that copy void. */
      if (stale && generation === fence) {
        if (now() - stale.savedAt >= REFRESH_AFTER_MS) revalidate(key, runtime, workspace, stale.models, fence, runProbe);
        else cache.set(key, { models: structuredClone(stale.models), expiresAt: stale.savedAt + REFRESH_AFTER_MS });
        return structuredClone(stale.models);
      }
      const sibling = stale ? null : await siblingModels(runtime);
      signal?.throwIfAborted();
      if (sibling && generation === fence) {
        /* Deliberately not cached under this key: the refresh's own result is
           the first list this workspace gets to keep. */
        if (now() - sibling.savedAt >= REFRESH_AFTER_MS) revalidate(key, runtime, workspace, sibling.models, fence, runProbe);
        return structuredClone(sibling.models);
      }
      /* singleflight 的后加入者只取消自己的等待；首个 caller 是实际 flight
         owner，它的 signal 才控制共享子进程。 */
      const active = pending.get(key);
      if (active) {
        if (!runProbe && active.takeOver(signal)) {
          /* The new owner waits through probe cleanup before releasing its
             existing lease; only ordinary joiners may cancel their wait. */
          return structuredClone(await active.promise);
        }
        return structuredClone(
          await waitForSharedFlight(active.promise, signal)
        );
      }
      return structuredClone(
        await begin(key, runtime, workspace, fence, signal, runProbe)
      );
    },
    async cached(runtime, workspace) {
      const key = spec.key(runtime, workspace);
      const current = cache.get(key);
      if (current) return structuredClone(current.models);
      const known = (await staleModels(key)) ?? (await siblingModels(runtime));
      return known ? structuredClone(known.models) : null;
    },
    invalidate() {
      generation += 1;
      cache.clear();
      retryAfter.clear();
      reported.clear();
      for (const scheduled of refreshes.values()) {
        scheduled.cancelled = true;
        cancelSchedule(scheduled.handle);
      }
      refreshes.clear();
      for (const flight of pending.values()) {
        flight.controller.abort(new Error(`${spec.label}已失效`));
      }
      pending.clear();
      /* Recheck/login return is the user saying the account changed: the
         durable copy must go too, or the next launch would serve it back. */
      persistenceReady = persistence
        ? persistence.clear(spec.backend).then(() => true, () => false)
        : Promise.resolve(true);
    },
  };
}
