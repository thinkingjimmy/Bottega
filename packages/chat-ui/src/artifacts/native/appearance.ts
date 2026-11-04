/**
 * [INPUT]: App theme classes, one exact native iframe lease and the document MutationObserver.
 * [OUTPUT]: nativeThemedLease and useNativeTheme apply the current App theme and locale without replacing an editor frame.
 * [POS]: Trusted native editor appearance bridge shared by editable and candidate frames.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useArtifactHost } from "../context";
import type { ArtifactLease } from "../context";
type Lease = ArtifactLease & { nativeToken: string };
const theme = () => document.documentElement.classList.contains("dark") ? "dark" : "light";
export function nativeThemedLease<T extends Lease>(lease: T, locale = document.documentElement.lang || navigator.language): T {
  if (lease.origin === "null") return lease;
  const url = new URL(lease.url); url.searchParams.set("theme", theme()); url.searchParams.set("lang", ["en", "zh-CN", "ja", "es", "fr"].includes(locale) ? locale : "en"); return { ...lease, url: url.href };
}
export function useNativeTheme(frame: RefObject<HTMLIFrameElement | null>, lease: Lease | null) {
  const locale = useArtifactHost()?.locale ?? document.documentElement.lang ?? navigator.language;
  const loaded = useRef<string | null>(null);
  const send = useCallback(() => {
    if (lease && loaded.current === lease.id) frame.current?.contentWindow?.postMessage({ type: "bottega:native:theme", token: lease.nativeToken, theme: theme(), locale }, lease.origin === "null" ? "*" : lease.origin);
  }, [lease, frame, locale]);
  useEffect(() => { send(); const observer = new MutationObserver(send); observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] }); return () => observer.disconnect(); }, [send]);
  return useCallback(() => { loaded.current = lease?.id ?? null; send(); }, [lease, send]);
}
