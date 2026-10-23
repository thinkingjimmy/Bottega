/**
 * [INPUT]: Verified selection geometry, compatible move/resize capabilities and the actual camera scale.
 * [OUTPUT]: Trusted host transform handles with transient geometry and one settled operation per gesture.
 * [POS]: Selection chrome; it cannot turn a flow/dynamic target into positioned source.
 */
import { useRef, useState, type PointerEvent } from "react";
import { INTERACTION_POLICY } from "../motion/policy";
import type { CanvasBox } from "../motion/camera";
import { useArtifactHost } from "../../../../context";
import { canvasCopy } from "../copy";
type Drag = { id: number; from: { x: number; y: number }; box: CanvasBox; resize: boolean };
export function CanvasSelection({ box, zoom, movable, resizable, busy, reason, preview, settle }: { box: CanvasBox; zoom: number; movable: boolean; resizable: boolean; busy: boolean; reason?: string; preview(box: CanvasBox | null): void; settle(box: CanvasBox): void }) {
  const copy = canvasCopy(useArtifactHost()!.locale), gesture = useRef<Drag | null>(null), [live, setLive] = useState<CanvasBox | null>(null), shown = live ?? box;
  const start = (event: PointerEvent, resize: boolean) => {
    if (!event.nativeEvent.isTrusted || event.button !== 0 || busy || (resize ? !resizable : !movable)) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); gesture.current = { id: event.pointerId, from: { x: event.clientX, y: event.clientY }, box, resize };
  };
  const move = (event: PointerEvent) => {
    const drag = gesture.current; if (!event.nativeEvent.isTrusted || !drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.from.x, dy = event.clientY - drag.from.y;
    const next = drag.resize ? { ...drag.box, width: Math.max(zoom, drag.box.width + dx), height: Math.max(zoom, drag.box.height + dy) } : { ...drag.box, x: drag.box.x + dx, y: drag.box.y + dy };
    setLive(next); preview(next);
  };
  const cancel = () => { gesture.current = null; setLive(null); preview(null); };
  const end = (event: PointerEvent) => {
    const drag = gesture.current; if (!event.nativeEvent.isTrusted || !drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.from.x, dy = event.clientY - drag.from.y, next = drag.resize ? { ...drag.box, width: Math.max(zoom, drag.box.width + dx), height: Math.max(zoom, drag.box.height + dy) } : { ...drag.box, x: drag.box.x + dx, y: drag.box.y + dy };
    const changed = Math.abs(dx) + Math.abs(dy) > .5;
    cancel(); if (changed && next) settle(next);
  };
  return <div data-workspace-selection="" data-canvas-chrome="" className="pointer-events-none absolute z-20 border-2 border-primary" style={{ left: shown.x, top: shown.y, width: shown.width, height: shown.height }} onKeyDown={event => { if (event.key === "Escape" && gesture.current) { event.preventDefault(); event.stopPropagation(); cancel(); } }}>
    {movable && <button type="button" style={{ minWidth: INTERACTION_POLICY.minTargetCssPx, minHeight: INTERACTION_POLICY.minTargetCssPx }} className="pointer-events-auto absolute inset-0 cursor-move bg-transparent" aria-label={copy.hand} title={reason ?? `${Math.round(shown.width / zoom)} × ${Math.round(shown.height / zoom)}`} disabled={busy} onPointerDown={event => start(event, false)} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel} onLostPointerCapture={cancel} />}
    {resizable && <button type="button" aria-label={`${copy.width} / ${copy.height}`} style={{ width: INTERACTION_POLICY.minTargetCssPx, height: INTERACTION_POLICY.minTargetCssPx }} className="pointer-events-auto absolute -bottom-[22px] -right-[22px] flex size-11 cursor-se-resize items-center justify-center" disabled={busy} onPointerDown={event => start(event, true)} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel} onLostPointerCapture={cancel}><span className="size-2.5 border border-primary bg-background" /></button>}
    {!resizable && <><span className="absolute -left-1 -top-1 size-2 border border-primary bg-background" /><span className="absolute -bottom-1 -right-1 size-2 border border-primary bg-background" /></>}
  </div>;
}
