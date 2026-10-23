/**
 * [INPUT]: An immutable resource key, cancellable Blob/native-byte/Base64 reader, actual visibility/zoom/resize bounds, gesture activity and optional Canvas camera.
 * [OUTPUT]: Acquisition-bound shared preview URLs and errors, committed-version acknowledgements, direct-buffer image byte conversion and gesture-deferred quality upgrades.
 * [POS]: Resource hook shared by Chat thumbnails and Canvas images; viewport timing uses the central policy.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { useArtifactHost } from "../../../context";
import { previewPool, type PreviewDemand } from "./pool";
import { VIEWPORT_POLICY } from "../editor/motion/policy";
import type { CanvasCameraController } from "../editor/motion/controller";
const idle = () => () => {};
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
export function usePreviewResource(root: RefObject<HTMLDivElement | null>, kind: "thumbnail" | "image", key: string, load: (signal: AbortSignal) => Promise<Blob>, controller?: CanvasCameraController) {
  const host = useArtifactHost()!, [admission, setAdmission] = useState({ active: false, epoch: 0, retry: false }), [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ host: typeof host; kind: typeof kind; key: string; epoch: number; token: object; url: string; failed: boolean } | null>(null);
  const visibilityRef = useRef(visible), movingRef = useRef(false);
  const held = useRef<HeldPreview | null>(null), imageOwners = useRef(new WeakMap<HTMLImageElement, object>());
  const zoom = useSyncExternalStore(controller?.subscribe ?? idle, () => controller?.snapshot().zoom ?? 1, () => 1);
  const demand = (): PreviewDemand => { const bounds = root.current?.getBoundingClientRect(); return { width: Math.max(1, Math.ceil((bounds?.width ?? 1) * devicePixelRatio)), height: Math.max(1, Math.ceil((bounds?.height ?? 1) * devicePixelRatio)), visible: visibilityRef.current, moving: movingRef.current }; };
  useEffect(() => {
    const node = root.current; if (!node || !key) return;
    const viewportRoot = node.closest("[data-canvas-stage]");
    let timer: ReturnType<typeof setTimeout> | undefined, retained = false;
    const cancel = () => { clearTimeout(timer); timer = undefined; };
    const prefetch = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { cancel(); setAdmission(value => value.active ? value : { active: true, epoch: value.epoch + 1, retry: false }); } }, { root: viewportRoot, rootMargin: `${VIEWPORT_POLICY.prefetchMarginCssPx}px` });
    const retention = new IntersectionObserver(entries => {
      retained = entries.some(entry => entry.isIntersecting);
      if (retained) cancel(); else if (!timer) timer = setTimeout(() => { timer = undefined; if (!retained) setAdmission(value => value.active ? { ...value, active: false } : value); }, VIEWPORT_POLICY.releaseDelayMs);
    }, { root: viewportRoot, rootMargin: `${VIEWPORT_POLICY.retentionMarginCssPx}px` });
    const visibility = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { root: viewportRoot });
    for (const observer of [prefetch, retention, visibility]) observer.observe(node);
    return () => { cancel(); for (const observer of [prefetch, retention, visibility]) observer.disconnect(); };
  }, [host, key, root]);
  useEffect(() => {
    if (!admission.active || !key) return;
    let current = true; const token = {};
    const lease = previewPool(host, kind).acquire(key, load, demand(), (url, failed) => { if (current) setResult({ host, kind, key, epoch: admission.epoch, token, url, failed }); });
    held.current = { token, lease };
    if (admission.retry) lease.retry();
    let resizeFrame: number | null = null;
    const observer = new ResizeObserver(() => { if (resizeFrame === null) resizeFrame = requestAnimationFrame(() => { resizeFrame = null; lease.update(demand()); }); }); if (root.current) observer.observe(root.current);
    return () => { current = false; observer.disconnect(); if (resizeFrame !== null) cancelAnimationFrame(resizeFrame); if (held.current?.token === token) held.current = null; lease.release(); };
    // A resource key freezes its reader; a new render cannot retarget a queued immutable read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, kind, key, admission]);
  useEffect(() => controller?.motionTo(active => { movingRef.current = active; held.current?.lease.motion(active); }), [controller]);
  useLayoutEffect(() => { visibilityRef.current = visible; held.current?.lease.update(demand());
    // Pan changes position only; demand follows visibility, zoom and ResizeObserver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, zoom, root]);
  const matches = admission.active && result?.host === host && result.kind === kind && result.key === key && result.epoch === admission.epoch;
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
export async function workspaceImageBlob(result: unknown) {
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
