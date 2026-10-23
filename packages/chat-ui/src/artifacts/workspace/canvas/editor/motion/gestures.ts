/**
 * [INPUT]: Trusted stage pointer events, a workspace wheel root with marked canvas surfaces and viewport camera callbacks.
 * [OUTPUT]: Native-input-safe Hand/pinch gestures and surface-bounded wheel admission across top/bottom control gaps, with viewport-relative zoom and checkpoint settlement.
 * [POS]: Parent canvas gesture adapter; frame gestures use the same camera calculations.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { canvasTiming, timedInput, timedAdmission, type CameraInput } from "./timing";
import { cameraTrace } from "../stage/state/diagnostics";
import { panCamera, zoomAt, type CanvasCamera } from "./camera";
export const isTypingTarget = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest("input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox']"));
export function isNativeScrollTarget(target: EventTarget | null, boundary: HTMLElement) {
  if (isTypingTarget(target)) return true;
  for (let node = target instanceof Element ? target : null; node && node !== boundary; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight || /auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth) return true;
  }
  return false;
}
export function useCanvasGestures(root: RefObject<HTMLDivElement | null>, wheelRoot: RefObject<HTMLElement | null>, getCamera: () => CanvasCamera, hand: boolean, change: (camera: CanvasCamera, input?: CameraInput) => void, settle: () => void) {
  const live = useRef({ getCamera, hand, change, settle });
  useLayoutEffect(() => { live.current = { getCamera, hand, change, settle }; }, [getCamera, hand, change, settle]);
  useEffect(() => {
    const element = root.current, wheelElement = wheelRoot.current; if (!element || !wheelElement) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let heldSpace = false;
    const local = (x: number, y: number) => { const rect = element.getBoundingClientRect(); return { x: x - rect.left, y: y - rect.top }; };
    const pair = () => { const [a, b] = [...pointers.values()]; return a && b ? { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), point: local((a.x + b.x) / 2, (a.y + b.y) / 2) } : null; };
    const apply = (next: CanvasCamera, input?: CameraInput) => { cameraTrace("gesture-write", { before: live.current.getCamera(), after: next }); live.current.change(next, input); };
    const key = (event: KeyboardEvent) => {
      if (event.isTrusted && event.type === "keyup" && event.key === " ") { heldSpace = false; return; }
      if (!event.isTrusted || isTypingTarget(event.target) || !element.contains(event.target as Node) || event.key !== " ") return;
      heldSpace = event.type === "keydown"; event.preventDefault();
    };
    const down = (event: PointerEvent) => {
      if (live.current.getCamera !== getCamera || !event.isTrusted || event.button !== 0 && event.button !== 1 || isNativeScrollTarget(event.target, element) || event.target instanceof Element && (event.target.closest("[data-canvas-chrome]") || event.target.closest("button,a") && !live.current.hand && !heldSpace)) return;
      if (!live.current.hand && !heldSpace && event.button !== 1) return;
      event.preventDefault(); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); element.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId); if (live.current.getCamera !== getCamera || !event.isTrusted || !previous) return;
      event.preventDefault(); const before = pair(); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); const after = pair();
      const panned = panCamera(live.current.getCamera(), event.clientX - previous.x, event.clientY - previous.y);
      apply(before && after ? zoomAt(panCamera(live.current.getCamera(), (event.clientX - previous.x) / 2, (event.clientY - previous.y) / 2), after.point, live.current.getCamera().zoom * after.distance / before.distance) : panned);
    };
    const end = (event: PointerEvent) => {
      if (!event.isTrusted || !pointers.delete(event.pointerId)) return;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      if (!pointers.size) live.current.settle();
    };
    const wheel = (event: WheelEvent) => {
      const input = timedInput(event);
      const target = event.target instanceof Element ? event.target : null, surface = target?.closest<HTMLElement>("[data-canvas-wheel-surface]");
      const boundary = target && element.contains(target) ? element : surface ?? wheelElement;
      const rejected = live.current.getCamera !== getCamera ? "scope" : !event.isTrusted ? "untrusted" : !surface ? "surface" : isNativeScrollTarget(target, boundary) ? "native" : null;
      cameraTrace("host-input", { accepted: !rejected, rejected, dx: event.deltaX, dy: event.deltaY, mode: event.deltaMode, ctrl: event.ctrlKey, meta: event.metaKey, height: event.deltaMode === 2 ? element.clientHeight : 0, before: live.current.getCamera() });
      if (rejected) { if (input) canvasTiming()?.reject(input, rejected); return; }
      timedAdmission(input);
      event.preventDefault(); const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      apply(event.ctrlKey || event.metaKey ? zoomAt(live.current.getCamera(), local(event.clientX, event.clientY), live.current.getCamera().zoom * Math.max(.8, Math.min(1.25, Math.exp(-event.deltaY * unit * .01)))) : panCamera(live.current.getCamera(), -event.deltaX * unit, -event.deltaY * unit), input);

    };
    const blur = () => { heldSpace = false; if (pointers.size) { pointers.clear(); live.current.settle(); } };
    element.addEventListener("pointerdown", down); element.addEventListener("pointermove", move); element.addEventListener("pointerup", end); element.addEventListener("pointercancel", end); element.addEventListener("lostpointercapture", end); wheelElement.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key); window.addEventListener("keyup", key); window.addEventListener("blur", blur);
    return () => { for (const id of pointers.keys()) if (element.hasPointerCapture(id)) element.releasePointerCapture(id); pointers.clear(); element.removeEventListener("pointerdown", down); element.removeEventListener("pointermove", move); element.removeEventListener("pointerup", end); element.removeEventListener("pointercancel", end); element.removeEventListener("lostpointercapture", end); wheelElement.removeEventListener("wheel", wheel); window.removeEventListener("keydown", key); window.removeEventListener("keyup", key); window.removeEventListener("blur", blur); };
  }, [root, wheelRoot, getCamera]);
}
