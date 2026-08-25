/**
 * [INPUT]: Depends on streamdown Plugin type with dynamic input from @streamdown/code/math/mermaid
 * [OUTPUT]: Provides Markdown capability testing, flow requested, plug-in selection, single-flight loaders and product-level sharing instances
 * [POS]: When selective rich text of ai-elements/message is running; Manage the plug-in load status only, not participate in React rendering
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
};

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
  onError: (key: OptionalPluginKey, cause: unknown) => void
) {
  const loaded = new Map<OptionalPluginKey, OptionalPlugin>();
  const failed = new Set<OptionalPluginKey>();
  const flights = new Map<OptionalPluginKey, Promise<void>>();

  const loadOne = (key: OptionalPluginKey) => {
    if (loaded.has(key) || failed.has(key)) return Promise.resolve();
    const active = flights.get(key);
    if (active) return active;

    const flight = importers[key]()
      .then((plugin) => {
        loaded.set(key, plugin);
      })
      .catch((cause) => {
        failed.add(key);
        onError(key, cause);
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
      };
    },
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
