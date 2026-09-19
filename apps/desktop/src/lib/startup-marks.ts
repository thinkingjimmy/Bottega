/**
 * [INPUT]: Depends on the browser performance timeline and the preload-exposed window.startupTrace bridge, which main only installs while startup tracing is enabled
 * [OUTPUT]: Provides markStartup, the renderer's only startup milestone sink
 * [POS]: Renderer half of the startup trace; the main process owns the aggregate timeline, this file only reports "the renderer reached here" and never changes what the renderer does
 */

declare global {
  interface Window {
    startupTrace?: { mark(name: string): void };
  }
}

/* Startup happens once, but the call sites are ordinary render/effect paths
   that run again on every re-render, remount and StrictMode double-invoke.
   Only the first report of a name is a startup fact; the rest are noise that
   would move the milestone later than it really was. */
const marked = new Set<string>();

export function markStartup(name: string) {
  if (marked.has(name)) return;
  marked.add(name);
  try {
    performance.mark(`bottega:${name}`);
    window.startupTrace?.mark(name);
  } catch {
    // Measurement never gets to break the thing it measures.
  }
}

/** Test seam: milestones are module-global, so suites that assert them reset here. */
export function resetStartupMarksForTests() {
  marked.clear();
}
