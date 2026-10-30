/**
 * [INPUT]: Depends on an async owner factory with an explicit current-lifetime predicate.
 * [OUTPUT]: Provides DeferredOwner and createDeferredOwner with cold lookup, one shared load, retry and exact shutdown.
 * [POS]: Main plugin lifetime leaf; a late import/factory cannot revive a retired owner or hide cleanup failure.
 */
type Disposable = {
  close(): void | Promise<void>;
};
export type DeferredOwner<T extends Disposable> = {
  peek(): T | null;
  loading(): boolean;
  get(): Promise<T>;
  close(): Promise<void>;
};
export function createDeferredOwner<T extends Disposable>(factory: (current: () => boolean) => Promise<T>): DeferredOwner<T> {
  let owner: T | null = null, pending: Promise<T> | null = null, closing: Promise<void> | null = null, retiredCleanup: Promise<void> | null = null, closed = false;
  const current = () => !closed;
  return {
    peek: () => owner,
    loading: () => pending !== null,
    get() {
      if (closed)
        return Promise.reject(new Error('DEFERRED_OWNER_CLOSED'));
      if (owner)
        return Promise.resolve(owner);
      if (pending)
        return pending;
      const flight = Promise.resolve().then(() => { if (!current())
        throw new Error('DEFERRED_OWNER_CLOSED'); return factory(current); }).then(async (value) => {
        if (!current()) {
          retiredCleanup = Promise.resolve().then(() => value.close());
          await retiredCleanup;
          throw new Error('DEFERRED_OWNER_CLOSED');
        }
        owner = value;
        return value;
      }).finally(() => { if (pending === flight)
        pending = null; });
      pending = flight;
      return flight;
    },
    close() {
      if (closing)
        return closing;
      closed = true;
      const retained = owner;
      owner = null;
      closing = (async () => { await pending?.catch(() => undefined); await retiredCleanup; await retained?.close(); })();
      return closing;
    },
  };
}
