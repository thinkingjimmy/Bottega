/**
 * [INPUT]: Depends on the renderer error projection only
 * [OUTPUT]: Provides SnapshotControllerSnapshot, SnapshotControllerPorts and createSnapshotController — the subscribe/load/mutate/dispose core of every scoped bridge controller
 * [POS]: Generic revision-fenced controller skeleton under lib; mcp-servers-client and project-tools-client add scope checks, fences and commands on top instead of each owning a copy of the machine
 */

import { errorMessage } from "./errors";

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
 * ============================================================ */
export function createSnapshotController<T>(ports: SnapshotControllerPorts<T>) {
  const listeners = new Set<() => void>();
  let disposed = false;
  let requestSequence = 0;
  let mutationTail = Promise.resolve();
  let snapshot: SnapshotControllerSnapshot<T> = {
    value: null,
    loading: false,
    error: "",
    pending: new Set(),
    bridgeAvailable: ports.bridgeAvailable,
  };

  const publish = (next: SnapshotControllerSnapshot<T>) => {
    if (disposed || next === snapshot) return;
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
      if (!disposed && request === requestSequence) adopt(value);
      return value;
    } catch (cause) {
      if (!disposed && request === requestSequence) {
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
  const stop = ports.watch(
    () => void load(),
    () => snapshot.value
  );

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    load,
    mutate,
    dispose() {
      disposed = true;
      requestSequence += 1;
      stop();
      listeners.clear();
    },
  };
}
