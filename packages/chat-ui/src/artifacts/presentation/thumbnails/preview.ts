/**
 * [INPUT]: An immutable thumbnail key, cancellable Blob/byte reader, actual visibility and resize bounds.
 * [OUTPUT]: usePreviewResource and thumbnailBlob provide scoped URLs, byte conversion, committed-version acknowledgements and bounded quality upgrades.
 * [POS]: Resource hook shared by current Artifact thumbnails; viewport hysteresis keeps acquisition bounded.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useArtifactHost } from "../../context";
import { previewPool, type PreviewDemand } from "./pool";
const VIEWPORT_POLICY = { prefetchMarginCssPx: 200, retentionMarginCssPx: 400, releaseDelayMs: 500 } as const;
type HeldPreview = { token: object; lease: ReturnType<ReturnType<typeof previewPool>["acquire"]> };
const ignoreFailure = () => {};
function previewFailure(current: RefObject<HeldPreview | null>, token: object, url: string) {
  // Native image caches must not retain the hook's host or React update context.
  return (event: { target: EventTarget | null }) => {
    const held = current.current, target = event.target;
    if (held?.token !== token || !(target instanceof HTMLImageElement) || (target.currentSrc || target.src) !== url) return;
    held.lease.fail(url);
  };
}
export function usePreviewResource(root: RefObject<HTMLDivElement | null>, key: string, load: (signal: AbortSignal) => Promise<Blob>, fit: "contain" | "cover" = "contain") {
  const host = useArtifactHost()!, [admission, setAdmission] = useState({ active: false, epoch: 0, retry: false }), [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ host: typeof host; key: string; epoch: number; token: object; url: string; failed: boolean } | null>(null);
  const fitRef = useRef(fit), visibilityRef = useRef(visible);
  const held = useRef<HeldPreview | null>(null), imageOwners = useRef(new WeakMap<HTMLImageElement, object>());
  const demand = (): PreviewDemand => { const bounds = root.current?.getBoundingClientRect(); return { width: Math.max(1, Math.ceil((bounds?.width ?? 1) * devicePixelRatio)), height: Math.max(1, Math.ceil((bounds?.height ?? 1) * devicePixelRatio)), visible: visibilityRef.current, fit: fitRef.current }; };
  useEffect(() => {
    const node = root.current; if (!node || !key) return;
    let timer: ReturnType<typeof setTimeout> | undefined, retained = false;
    const cancel = () => { clearTimeout(timer); timer = undefined; };
    const prefetch = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { cancel(); setAdmission(value => value.active ? value : { active: true, epoch: value.epoch + 1, retry: false }); } }, { rootMargin: `${VIEWPORT_POLICY.prefetchMarginCssPx}px` });
    const retention = new IntersectionObserver(entries => {
      retained = entries.some(entry => entry.isIntersecting);
      if (retained) cancel(); else if (!timer) timer = setTimeout(() => { timer = undefined; if (!retained) setAdmission(value => value.active ? { ...value, active: false } : value); }, VIEWPORT_POLICY.releaseDelayMs);
    }, { rootMargin: `${VIEWPORT_POLICY.retentionMarginCssPx}px` });
    const visibility = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    for (const observer of [prefetch, retention, visibility]) observer.observe(node);
    return () => { cancel(); for (const observer of [prefetch, retention, visibility]) observer.disconnect(); };
  }, [host, key, root]);
  useEffect(() => {
    if (!admission.active || !key) return;
    let current = true; const token = {};
    const lease = previewPool(host).acquire(key, load, demand(), (url, failed) => { if (current) setResult({ host, key, epoch: admission.epoch, token, url, failed }); });
    held.current = { token, lease };
    if (admission.retry) lease.retry();
    let resizeFrame: number | null = null;
    const observer = new ResizeObserver(() => { if (resizeFrame === null) resizeFrame = requestAnimationFrame(() => { resizeFrame = null; lease.update(demand()); }); }); if (root.current) observer.observe(root.current);
    return () => { current = false; observer.disconnect(); if (resizeFrame !== null) cancelAnimationFrame(resizeFrame); if (held.current?.token === token) held.current = null; lease.release(); };
    // A resource key freezes its reader; a new render cannot retarget a queued immutable read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, key, admission]);
  useLayoutEffect(() => { visibilityRef.current = visible; fitRef.current = fit; held.current?.lease.update(demand());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, root, fit]);
  const matches = admission.active && result?.host === host && result.key === key && result.epoch === admission.epoch;
  const url = matches ? result.url : "";
  useLayoutEffect(() => {
    if (!url) return;
    // Canonical markup and failure renders can replace an image without changing its URL.
    const images = [...(root.current?.querySelectorAll<HTMLImageElement>("img") ?? [])].filter(image => image.getAttribute("src") === url);
    const owner = {}, owners = imageOwners.current;
    for (const image of images) owners.set(image, owner);
    // Same-commit effect replay renews ownership before detached nodes release their native source.
    return () => queueMicrotask(() => {
      for (const image of images) if (owners.get(image) === owner && image.getAttribute("src") === url) {
        // Empty src avoids the native viewport listener retained by a missing attribute.
        owners.delete(image); image.setAttribute("src", "");
      }
    });
  });
  useLayoutEffect(() => { if (url && result?.token === held.current?.token) held.current?.lease.commit(url); }, [url, result]);
  const retryResource = useCallback(() => setAdmission(value => ({ active: true, epoch: value.epoch + 1, retry: true })), []);
  const failureToken = matches ? result.token : null, failureUrl = matches ? result.url : "";
  // The factory captures the ref; only the returned event handler reads it.
  // eslint-disable-next-line react-hooks/refs
  const fail = useMemo(() => failureToken ? previewFailure(held, failureToken, failureUrl) : ignoreFailure, [failureToken, failureUrl]);
  return { url, failed: Boolean(matches && result.failed), retry: retryResource, fail };
}
export async function thumbnailBlob(result: unknown) {
  const value = result as { blob?: Blob; bytes?: Uint8Array<ArrayBuffer>; data?: string; mime?: string };
  let blob = value.blob ?? (value.bytes ? new Blob([value.bytes], { type: value.mime }) : undefined);
  if (!blob && value.data) {
    const binary = atob(value.data), bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    blob = new Blob([bytes], { type: value.mime });
  }
  if (!blob || !blob.type.startsWith("image/")) throw new Error("Preview image is unavailable");
  return blob;
}
