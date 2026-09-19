/**
 * [INPUT]: Depends on the browser idle callback when the runtime has one, window timers otherwise
 * [OUTPUT]: Provides prefetchWhenIdle(loader): a cancellable, once-per-loader idle fetch for lazy chunks
 * [POS]: lib's chunk scheduling primitive; chat-view uses it for the transcript and side-panel chunks
 */

/** The very `() => import(...)` the matching `lazy` calls: identity is the key. */
export type ChunkLoader = () => Promise<unknown>;

/* No idle callback in jsdom and none in older runtimes: 1.5s clears the startup
   burst while still landing long before a user types a first message. */
const FALLBACK_DELAY_MS = 1500;

/* Keyed on loader identity so remounting the same view never re-fetches; weak,
   because a loader that dies with its module should take its entry along. */
const scheduled = new WeakSet<ChunkLoader>();

const noop = () => {};

/**
 * Fetches a lazy chunk once the main thread is free, so the code is warm before
 * the render that needs it. Returns a cancel for unmount.
 */
export function prefetchWhenIdle(loader: ChunkLoader): () => void {
  if (scheduled.has(loader)) return noop;
  scheduled.add(loader);
  let started = false;
  const run = () => {
    started = true;
    /* A failed prefetch is not a product failure: the real `lazy` runs the same
       loader again and reports through its own Suspense boundary. */
    void loader().catch(() => {});
  };
  const idle = typeof window.requestIdleCallback === "function";
  const handle = idle
    ? window.requestIdleCallback(run)
    : window.setTimeout(run, FALLBACK_DELAY_MS);
  return () => {
    if (started) return;
    /* Unmounting before the idle window is no verdict on the chunk — let the
       next mount schedule it again. */
    scheduled.delete(loader);
    if (idle) window.cancelIdleCallback(handle);
    else window.clearTimeout(handle);
  };
}
