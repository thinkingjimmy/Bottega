/**
 * [INPUT]: Depends on Streamdown highlight options and serializable token results
 * [OUTPUT]: Provides an exact-content key and a 500-entry / 4 MiB serialized-size LRU
 * [POS]: Main-thread result ownership for the shared highlighting worker; no second worker token cache
 */
import type { HighlightOptions, HighlightResult } from "@streamdown/code";

export const highlightKey = (options: HighlightOptions) => JSON.stringify([
  options.language.trim().toLowerCase(), options.themes, options.code,
]);

export function createTokenCache() {
  const entries = new Map<string, { result: HighlightResult; bytes: number }>();
  let bytes = 0;
  return {
    get(key: string) {
      const value = entries.get(key);
      if (!value) return null;
      entries.delete(key);
      entries.set(key, value);
      return value.result;
    },
    set(key: string, result: HighlightResult) {
      const size = 2 * (key.length + JSON.stringify(result).length);
      if (size > 4 * 1024 * 1024) return;
      const previous = entries.get(key);
      if (previous) bytes -= previous.bytes;
      entries.delete(key);
      entries.set(key, { result, bytes: size });
      bytes += size;
      while (entries.size > 500 || bytes > 4 * 1024 * 1024) {
        const oldest = entries.keys().next().value!;
        bytes -= entries.get(oldest)!.bytes;
        entries.delete(oldest);
      }
    },
    clear() { entries.clear(); bytes = 0; },
  };
}
