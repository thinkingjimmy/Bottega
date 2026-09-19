/**
 * [INPUT]: Depends on the browser ResizeObserver; multiplexes callbacks per observed target
 * [OUTPUT]: Provides observeSharedResize, which lazily creates one shared observer and dispatches its entries to per-target callbacks, and sharedResizeTargetCount for observed-target introspection
 * [POS]: Shared-size observer for conversation rows; avoids the linear overhead of a dedicated ResizeObserver per user message
 */

type ResizeCallback = () => void;

const callbacks = new Map<Element, Set<ResizeCallback>>();
let observer: ResizeObserver | undefined;

function getSharedObserver() {
  if (typeof ResizeObserver === "undefined") return undefined;
  observer ??= new ResizeObserver((entries) => {
    // Empty batches support layout test doubles; real observers dispatch per target.
    if (!entries.length) {
      for (const listeners of callbacks.values()) {
        for (const callback of listeners) callback();
      }
      return;
    }
    for (const entry of entries) {
      for (const callback of callbacks.get(entry.target) ?? []) callback();
    }
  });
  return observer;
}

export function observeSharedResize(target: Element, callback: ResizeCallback) {
  const shared = getSharedObserver();
  if (!shared) return () => {};
  const listeners = callbacks.get(target) ?? new Set<ResizeCallback>();
  listeners.add(callback);
  callbacks.set(target, listeners);
  if (listeners.size === 1) shared.observe(target);
  return () => {
    const current = callbacks.get(target);
    if (!current) return;
    current.delete(callback);
    if (current.size) return;
    callbacks.delete(target);
    shared.unobserve(target);
    if (!callbacks.size) {
      shared.disconnect();
      observer = undefined;
    }
  };
}

export const sharedResizeTargetCount = () => callbacks.size;
