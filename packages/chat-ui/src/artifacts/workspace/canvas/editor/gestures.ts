/**
 * [INPUT]: Trusted host pointer/wheel events and the viewport camera callbacks.
 * [OUTPUT]: Native-input-safe Hand/pinch/wheel gestures with one checkpoint settlement per gesture.
 * [POS]: Parent canvas gesture adapter; frame gestures use the same camera calculations.
 */
import { useEffect, useRef, type RefObject } from "react";
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
export function useCanvasGestures(root: RefObject<HTMLDivElement | null>, camera: CanvasCamera, hand: boolean, change: (camera: CanvasCamera) => void, settle: () => void) {
  const live = useRef({ camera, hand, change, settle });
  useEffect(() => { live.current = { camera, hand, change, settle }; }, [camera, hand, change, settle]);
  useEffect(() => {
    const element = root.current; if (!element) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let heldSpace = false, wheelEnd: ReturnType<typeof setTimeout> | undefined;
    const local = (x: number, y: number) => { const rect = element.getBoundingClientRect(); return { x: x - rect.left, y: y - rect.top }; };
    const pair = () => { const [a, b] = [...pointers.values()]; return a && b ? { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), point: local((a.x + b.x) / 2, (a.y + b.y) / 2) } : null; };
    const apply = (next: CanvasCamera) => { live.current.camera = next; live.current.change(next); };
    const key = (event: KeyboardEvent) => {
      if (event.isTrusted && event.type === "keyup" && event.key === " ") { heldSpace = false; return; }
      if (!event.isTrusted || isTypingTarget(event.target) || !element.contains(event.target as Node) || event.key !== " ") return;
      heldSpace = event.type === "keydown"; event.preventDefault();
    };
    const down = (event: PointerEvent) => {
      if (!event.isTrusted || event.button !== 0 && event.button !== 1 || isNativeScrollTarget(event.target, element) || event.target instanceof Element && (event.target.closest("[data-canvas-chrome]") || event.target.closest("button,a") && !live.current.hand && !heldSpace)) return;
      if (!live.current.hand && !heldSpace && event.button !== 1) return;
      event.preventDefault(); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); element.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId); if (!event.isTrusted || !previous) return;
      event.preventDefault(); const before = pair(); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); const after = pair();
      const panned = panCamera(live.current.camera, event.clientX - previous.x, event.clientY - previous.y);
      apply(before && after ? zoomAt(panCamera(live.current.camera, (event.clientX - previous.x) / 2, (event.clientY - previous.y) / 2), after.point, live.current.camera.zoom * after.distance / before.distance) : panned);
    };
    const end = (event: PointerEvent) => {
      if (!event.isTrusted || !pointers.delete(event.pointerId)) return;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      if (!pointers.size) live.current.settle();
    };
    const wheel = (event: WheelEvent) => {
      if (!event.isTrusted || isNativeScrollTarget(event.target, element)) return;
      if (!event.ctrlKey && !event.metaKey && !live.current.hand) return;
      event.preventDefault(); const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      apply(event.ctrlKey || event.metaKey ? zoomAt(live.current.camera, local(event.clientX, event.clientY), live.current.camera.zoom * Math.max(.8, Math.min(1.25, Math.exp(-event.deltaY * unit * .01)))) : panCamera(live.current.camera, -event.deltaX * unit, -event.deltaY * unit));
      clearTimeout(wheelEnd); wheelEnd = setTimeout(() => live.current.settle(), 180);
    };
    const blur = () => { heldSpace = false; if (pointers.size) { pointers.clear(); live.current.settle(); } };
    element.addEventListener("pointerdown", down); element.addEventListener("pointermove", move); element.addEventListener("pointerup", end); element.addEventListener("pointercancel", end); element.addEventListener("lostpointercapture", end); element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key); window.addEventListener("keyup", key); window.addEventListener("blur", blur);
    return () => { clearTimeout(wheelEnd); element.removeEventListener("pointerdown", down); element.removeEventListener("pointermove", move); element.removeEventListener("pointerup", end); element.removeEventListener("pointercancel", end); element.removeEventListener("lostpointercapture", end); element.removeEventListener("wheel", wheel); window.removeEventListener("keydown", key); window.removeEventListener("keyup", key); window.removeEventListener("blur", blur); };
  }, [root]);
}
