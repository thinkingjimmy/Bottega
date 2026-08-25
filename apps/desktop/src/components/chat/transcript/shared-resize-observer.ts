/**
 * [INPUT]: Depends on the browser ResizeObserver; Receiving multiple messages folding targets with their respective feedback
 * [OUTPUT]: Provides observeSharedResize, a method of creating a single observer and distributing it by target, retrieving it by target
 * [POS]: The shared size of the chat/transcript observer; Eliminate the linear cost of living of the exclusive observer for each user message
 */

type ResizeCallback = () => void;

const callbacks = new Map<Element, Set<ResizeCallback>>();
let observer: ResizeObserver | undefined;

function getSharedObserver() {
  if (typeof ResizeObserver === "undefined") return undefined;
  observer ??= new ResizeObserver((entries) => {
    // jsdom 的旧回归替身会用空 entries 表示「所有已观测目标变更」；
    // 真浏览器不会发出空批次，这条兼容路径不增加生产热路径成本。
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

export function observeSharedResize(
  target: Element,
  callback: ResizeCallback
) {
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
