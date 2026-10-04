/**
 * [INPUT]: Depends on streamdown Plugin type with dynamic input from @streamdown/code/math/mermaid
 * [OUTPUT]: Provides detectOptionalPlugins (Markdown feature detection), selectOptionalPlugins, createOptionalPluginLoader — a single-flight, process-wide-shared loader for the code/math/mermaid plugins whose failures retry after a 30 s→5 min backoff or when the network returns (E-20), with subscribe/revision to wake renderers — and preloadMessagePlugins for idle warmup
 * [POS]: Runtime plugin-selection layer for ai-elements/message's rich-text rendering; manages plugin load state only and never touches React rendering itself
 */

import type { PluginConfig } from "streamdown";

const OPTIONAL_PLUGIN_KEYS = ["code", "math", "mermaid"] as const;

export type OptionalPluginKey = (typeof OPTIONAL_PLUGIN_KEYS)[number];
type OptionalPlugin = NonNullable<PluginConfig[OptionalPluginKey]>;

export type OptionalPluginImporters = Record<
  OptionalPluginKey,
  () => Promise<OptionalPlugin>
>;

export type OptionalPluginSnapshot = {
  failed: OptionalPluginKey[];
  plugins: PluginConfig;
  settled: boolean;
  /** A failed plugin whose backoff is over (or the network came back): load again, keeping the degraded render meanwhile. */
  retry: boolean;
};

type LoaderClock = { now(): number; setTimeout(run: () => void, ms: number): void };
const systemClock: LoaderClock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => { (setTimeout(run, ms) as { unref?: () => void }).unref?.(); },
};
const RETRY_BASE_MS = 30_000;
const RETRY_CAP_MS = 5 * 60_000;
const backoff = (attempts: number) => Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_CAP_MS);

const FENCED_BLOCK =
  /^[\t ]{0,3}(?:`{3,}|~{3,})[\t ]*([^\s`~]+)?/gm;
const HTML_CODE_LANGUAGE =
  /<code\b[^>]*class=["'][^"']*\blanguage-[^"' ]+/i;

export function detectOptionalPlugins(
  markdown: string,
  customLanguages: readonly string[] = []
): OptionalPluginKey[] {
  const requested = new Set<OptionalPluginKey>();
  const custom = new Set(customLanguages.map((language) => language.toLowerCase()));
  if (markdown.includes("$$")) requested.add("math");
  if (HTML_CODE_LANGUAGE.test(markdown)) requested.add("code");

  for (const match of markdown.matchAll(FENCED_BLOCK)) {
    const language = match[1]?.toLowerCase();
    if (custom.has(language ?? "")) continue;
    if (language === "mermaid") requested.add("mermaid");
    else if (language) requested.add("code");
  }

  return OPTIONAL_PLUGIN_KEYS.filter((key) => requested.has(key));
}

export function selectOptionalPlugins(
  detected: readonly OptionalPluginKey[],
  codeEnabled: boolean
) {
  return codeEnabled
    ? [...detected]
    : detected.filter((key) => key !== "code");
}

export function createOptionalPluginLoader(
  importers: OptionalPluginImporters,
  onError: (key: OptionalPluginKey, cause: unknown) => void,
  clock: LoaderClock = systemClock
) {
  const loaded = new Map<OptionalPluginKey, OptionalPlugin>();
  /* E-20: a failure is remembered with its time, not forever; renderers are woken when its backoff ends or the network returns. */
  const failed = new Map<OptionalPluginKey, { at: number; attempts: number }>();
  const flights = new Map<OptionalPluginKey, Promise<void>>();
  const listeners = new Set<() => void>();
  let revision = 0, onlineBound = false;
  const notify = () => { revision += 1; for (const listener of listeners) listener(); };
  const due = (key: OptionalPluginKey) => {
    const failure = failed.get(key);
    return Boolean(failure) && clock.now() >= failure!.at + backoff(failure!.attempts);
  };
  const retryFailed = () => {
    for (const failure of failed.values()) failure.at = Number.NEGATIVE_INFINITY;
    notify();
  };

  const loadOne = (key: OptionalPluginKey) => {
    if (loaded.has(key) || failed.has(key) && !due(key)) return Promise.resolve();
    const active = flights.get(key);
    if (active) return active;

    const flight = importers[key]()
      .then((plugin) => {
        loaded.set(key, plugin);
        failed.delete(key);
      })
      .catch((cause) => {
        const attempts = (failed.get(key)?.attempts ?? 0) + 1;
        failed.set(key, { at: clock.now(), attempts });
        onError(key, cause);
        clock.setTimeout(notify, backoff(attempts));
        if (!onlineBound && typeof window !== "undefined") {
          onlineBound = true;
          window.addEventListener("online", retryFailed);
        }
      })
      .finally(() => {
        flights.delete(key);
      });
    flights.set(key, flight);
    return flight;
  };

  return {
    load(keys: readonly OptionalPluginKey[]) {
      return Promise.all(keys.map(loadOne)).then(() => undefined);
    },
    snapshot(keys: readonly OptionalPluginKey[]): OptionalPluginSnapshot {
      const plugins = Object.fromEntries(
        keys.flatMap((key) => {
          const plugin = loaded.get(key);
          return plugin ? [[key, plugin]] : [];
        })
      ) as PluginConfig;
      return {
        failed: keys.filter((key) => failed.has(key)),
        plugins,
        settled: keys.every((key) => loaded.has(key) || failed.has(key)),
        retry: keys.some(due),
      };
    },
    retryFailed,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    revision: () => revision,
  };
}

export const messagePluginLoader = createOptionalPluginLoader(
  {
    code: () => import("@streamdown/code").then((module) => module.code),
    math: () => import("@streamdown/math").then((module) => module.math),
    mermaid: () =>
      import("@streamdown/mermaid").then((module) => module.mermaid),
  },
  (key, cause) => {
    console.error(`[MessageResponse] Failed to load ${key} plugin`, cause);
  }
);

/** Warms a plugin chunk before any message needs it; the loader already reports and remembers its own failures. */
export function preloadMessagePlugins(keys: readonly OptionalPluginKey[]) {
  void messagePluginLoader.load(keys).catch(() => undefined);
}
