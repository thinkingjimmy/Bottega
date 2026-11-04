/**
 * [INPUT]: Depends on a module Worker, Streamdown's async callback contract, protocol and bounded token cache
 * [OUTPUT]: Provides loadCodeHighlighter, one shared plugin with single-flight requests, serial work, bounded queue, timeout and idle disposal
 * [POS]: Browser adapter loaded by message/plugin-loader; expensive highlighting never falls back to the main thread
 */
import type { CodeHighlighterPlugin, HighlightOptions, HighlightResult } from "@streamdown/code";
import { createTokenCache, highlightKey } from "./cache";
import { plainTokens, type HighlightResponse } from "./protocol";

type Task = { options: HighlightOptions; callbacks: Set<(result: HighlightResult) => void> };
const TIMEOUT_MS = 15_000, IDLE_MS = 120_000, RETRY_MS = 30_000;
const QUEUE_LIMIT = 64, QUEUE_BYTES = 1024 * 1024;
let shared: Promise<CodeHighlighterPlugin> | undefined;

async function createWorkerPlugin(): Promise<CodeHighlighterPlugin> {
  const cache = createTokenCache(), pending = new Map<string, Task>();
  let worker: Worker | undefined, ready: Promise<void> | undefined;
  let resolveReady: (() => void) | undefined, rejectReady: ((error: Error) => void) | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined, idle: ReturnType<typeof setTimeout> | undefined;
  let active: { id: number; key: string } | undefined;
  let nextId = 0, queuedBytes = 0, retryAt = 0;
  let languages = new Set<string>();

  function terminate() {
    clearTimeout(deadline); clearTimeout(idle);
    worker?.terminate(); worker = undefined; ready = undefined;
    active = undefined;
  }
  function fail(error: Error) {
    terminate(); retryAt = Date.now() + RETRY_MS;
    rejectReady?.(error); resolveReady = undefined; rejectReady = undefined;
    const abandoned = [...pending.values()]; pending.clear(); queuedBytes = 0;
    for (const task of abandoned) {
      const result = plainTokens(task.options.code);
      for (const callback of task.callbacks) callback(result);
    }
    console.error("[MessageResponse] Code worker failed:", error);
  }
  function armDeadline() {
    clearTimeout(deadline);
    deadline = setTimeout(() => fail(new Error("Code worker timed out")), TIMEOUT_MS);
  }
  function pump() {
    if (!worker || active) return;
    const first = pending.entries().next().value;
    if (!first) {
      clearTimeout(idle); idle = setTimeout(terminate, IDLE_MS);
      return;
    }
    clearTimeout(idle);
    const [key, task] = first;
    active = { key, id: ++nextId };
    armDeadline();
    try { worker.postMessage({ id: active.id, options: task.options }); }
    catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  }
  function start() {
    if (ready) return ready;
    ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const opening = ready;
    try {
      const instance = worker = new Worker(new URL("./code-worker.ts", import.meta.url), { type: "module", name: "message-highlighter" });
      armDeadline();
      instance.onerror = event => { event.preventDefault(); if (worker === instance) fail(new Error(event.message || "Code worker could not load")); };
      instance.onmessageerror = () => { if (worker === instance) fail(new Error("Code worker returned invalid data")); };
      instance.onmessage = ({ data }: MessageEvent<HighlightResponse>) => {
        if (worker !== instance) return;
        if (data.type === "ready") {
          clearTimeout(deadline); languages = new Set(data.languages);
          resolveReady?.(); resolveReady = undefined; rejectReady = undefined;
          pump(); return;
        }
        if (data.id !== active?.id) return;
        if (data.type === "failure") { fail(new Error(data.message)); return; }
        clearTimeout(deadline);
        const key = active.key, task = pending.get(key)!;
        pending.delete(key); queuedBytes -= key.length * 2; active = undefined;
        cache.set(key, data.result);
        try { for (const callback of task.callbacks) callback(data.result); }
        finally { pump(); }
      };
    } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    return opening;
  }

  await start();
  // BFCache and hidden tabs must not retain a grammar engine indefinitely.
  window.addEventListener("pagehide", () => {
    terminate(); cache.clear();
    rejectReady?.(new Error("Page closed")); resolveReady = undefined; rejectReady = undefined;
    const abandoned = [...pending.values()]; pending.clear(); queuedBytes = 0;
    for (const task of abandoned) for (const callback of task.callbacks) callback(plainTokens(task.options.code));
  });
  return {
    name: "shiki", type: "code-highlighter",
    getThemes: () => ["github-light", "github-dark"],
    getSupportedLanguages: () => [...languages] as ReturnType<CodeHighlighterPlugin["getSupportedLanguages"]>,
    supportsLanguage: language => languages.has(language.trim().toLowerCase()),
    highlight(options, callback) {
      const key = highlightKey(options), cached = cache.get(key);
      if (cached) return cached;
      const existing = pending.get(key);
      if (existing) { if (callback) existing.callbacks.add(callback); return null; }
      if (Date.now() < retryAt || pending.size >= QUEUE_LIMIT || queuedBytes + key.length * 2 > QUEUE_BYTES) return plainTokens(options.code);
      pending.set(key, { options, callbacks: new Set(callback ? [callback] : []) });
      queuedBytes += key.length * 2;
      void start().then(pump).catch(() => {});
      return null;
    },
  };
}

export function loadCodeHighlighter() {
  return shared ??= createWorkerPlugin().catch(error => { shared = undefined; throw error; });
}
