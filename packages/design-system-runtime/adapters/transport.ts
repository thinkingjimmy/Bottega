/**
 * [INPUT]: Exact native module transport and original System local resource addresses.
 * [OUTPUT]: Closed local/encrypted System file reads and captured blob/data reads without global fetch replacement.
 * [POS]: Trusted System source adapter; authored opaque children receive no native capability.
 */
import { nativeFetch, nativeBase } from "../../canvas-runtime/build/transport";
export const systemFetch: typeof fetch = (input, init) => {
  const base = nativeBase(), raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/^(?:blob:|data:)/i.test(raw)) return globalThis.fetch(input, init);
  if (base.startsWith("https://native.invalid/")) {
    const url = new URL(raw, location.href);
    if (url.origin === location.origin) {
      const path = url.pathname.replace(/^.*\/editor\//, "").replace(/^\//, "");
      if (url.search || url.hash || !/^(?:project\/|_blob\/|artifact-type\/|_files\.json$|__deck\/)/.test(path)) throw new Error("The System module requested an unissued resource");
      return nativeFetch(base + path, init);
    }
  }
  return nativeFetch(input, init);
};

export { nativeHistoryLabel, openNativeHistory, nativeProjectExportAvailable, nativeProjectExportLabel, openNativeProjectExport } from "../../canvas-runtime/adapters/export-runtime";
