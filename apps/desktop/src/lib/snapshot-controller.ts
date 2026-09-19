/**
 * [INPUT]: Depends on the renderer error projection only
 * [OUTPUT]: Provides SnapshotControllerSnapshot, SnapshotControllerPorts and createSnapshotController — the subscribe/load/mutate core of every scoped bridge controller
 * [POS]: Generic revision-fenced controller skeleton under lib; mcp-servers-client and project-tools-client add scope checks, fences and commands on top instead of each owning a copy of the machine
 */

import { errorMessage } from "@ai-chat/ui/lib/errors";

export type SnapshotControllerSnapshot<T> = Readonly<{
  value: T | null;
  loading: boolean;
  error: string;
  pending: ReadonlySet<string>;
  bridgeAvailable: boolean;
}>;

export type SnapshotControllerPorts<T> = Readonly<{
  bridgeAvailable: boolean;
  bridgeUnavailableError: string;
  fetch: () => Promise<T>;
  /** Scope match plus revision monotonicity; a value that fails is dropped silently. */
  accepts: (value: T, current: T | null) => boolean;
  /** Subscribe to bridge change events and call `reload` for the ones that affect this scope. */
  watch: (reload: () => void, current: () => T | null) => () => void;
}>;

/* ============================================================
 * One machine, two owners.
 *
 * Load results are request-sequenced so a stale fetch never overwrites a newer
 * one; mutations are serialized through a tail promise so each CAS rebases on
 * the value the previous one produced; a rejected mutation refreshes the
 * authoritative baseline before surfacing its error, and the pending key is
 * released in `finally` so the caller's control never stays disabled.
 *
 * The subscription is the lifecycle, and that is the whole point: a one-way
 * teardown flag would assume a controller dies exactly once, but React hands
 * the same memoized controller through a StrictMode remount — mount, clean up,
 * mount — and nothing can ever un-set such a flag, so the second load's result
 * is thrown away and the view waits forever for data that already arrived.
 * Refcounting listeners has no such blind spot: the bridge watch starts with
 * the first listener and stops with the last, because a controller nobody
 * listens to has nothing worth watching, and the next listener starts it
 * again.
 * ============================================================ */
export function createSnapshotController<T>(ports: SnapshotControllerPorts<T>) {
  const listeners = new Set<() => void>();
  let requestSequence = 0;
  let mutationTail = Promise.resolve();
  let stopWatch: (() => void) | null = null;
  let snapshot: SnapshotControllerSnapshot<T> = {
    value: null,
    loading: false,
    error: "",
    pending: new Set(),
    bridgeAvailable: ports.bridgeAvailable,
  };

  const publish = (next: SnapshotControllerSnapshot<T>) => {
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const adopt = (value: T) => {
    if (!ports.accepts(value, snapshot.value)) return;
    publish({ ...snapshot, value, loading: false, error: "" });
  };
  const load = async () => {
    const request = ++requestSequence;
    if (!snapshot.bridgeAvailable) {
      publish({
        ...snapshot,
        loading: false,
        error: ports.bridgeUnavailableError,
      });
      return null;
    }
    publish({ ...snapshot, loading: true, error: "" });
    try {
      const value = await ports.fetch();
      if (request === requestSequence) adopt(value);
      return value;
    } catch (cause) {
      if (request === requestSequence) {
        publish({ ...snapshot, loading: false, error: errorMessage(cause) });
      }
      return null;
    }
  };
  const mutate = async (
    pendingKey: string,
    task: (current: T) => Promise<T>
  ) => {
    requestSequence += 1;
    const operation = mutationTail.then(async () =>
      task(snapshot.value ?? (await ports.fetch()))
    );
    mutationTail = operation.then(
      () => undefined,
      () => undefined
    );
    publish({
      ...snapshot,
      error: "",
      pending: new Set(snapshot.pending).add(pendingKey),
    });
    try {
      adopt(await operation);
      return true;
    } catch (cause) {
      const message = errorMessage(cause);
      const refreshed = await ports.fetch().catch(() => null);
      if (refreshed) adopt(refreshed);
      publish({ ...snapshot, error: message });
      return false;
    } finally {
      const pending = new Set(snapshot.pending);
      pending.delete(pendingKey);
      publish({ ...snapshot, pending });
    }
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1 && !stopWatch) {
        stopWatch = ports.watch(
          () => void load(),
          () => snapshot.value
        );
      }
      /* A released handle must stay released: React may call the same cleanup
         twice, and a second decrement would tear down the watch a newer
         listener now owns. */
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        listeners.delete(listener);
        if (listeners.size > 0) return;
        stopWatch?.();
        stopWatch = null;
      };
    },
    getSnapshot: () => snapshot,
    load,
    mutate,
  };
}
