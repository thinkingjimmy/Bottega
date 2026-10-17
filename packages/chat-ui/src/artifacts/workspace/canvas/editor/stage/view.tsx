/**
 * [INPUT]: Host-owned page item bounds, actual camera, active tool and real renderer/placement callbacks.
 * [OUTPUT]: Camera-positioned page stage with bounded placement/drawing previews and settled trusted gestures.
 * [POS]: Canvas stage; fixed board/object content is supplied by the workspace, never inferred from child DOM.
 */
import { useRef, useState, type ReactNode } from "react";
import { screenBox, type CanvasBox, type CanvasCamera } from "../camera";
import { useCanvasGestures } from "../gestures";
import type { CanvasTool } from "../tools";
import { canvasCopy } from "../copy";
import { useArtifactHost } from "../../../../context";
export type StageItem = { id: string; box: CanvasBox; node: ReactNode };
export type CanvasPlacement = { tool: CanvasTool; box: CanvasBox; points: { x: number; y: number }[] };
type Stroke = { id: number; tool: CanvasTool; from: { x: number; y: number }; points: { x: number; y: number }[] };
const placeTools: CanvasTool[] = ["text", "artboard", "note", "draw", "rectangle", "ellipse", "line", "arrow", "image"];
function placement(stroke: Stroke): CanvasPlacement {
  const end = stroke.points.at(-1)!, xs = stroke.points.map(point => point.x), ys = stroke.points.map(point => point.y), drawing = stroke.tool === "draw";
  const x = drawing ? Math.min(...xs) : Math.min(stroke.from.x, end.x), y = drawing ? Math.min(...ys) : Math.min(stroke.from.y, end.y);
  const width = Math.max(1, drawing ? Math.max(...xs) - x : Math.abs(end.x - stroke.from.x)), height = Math.max(1, drawing ? Math.max(...ys) - y : Math.abs(end.y - stroke.from.y));
  return { tool: stroke.tool, box: { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }, points: stroke.points.map(point => ({ x: Math.round((point.x - x) / width * 1000) / 1000, y: Math.round((point.y - y) / height * 1000) / 1000 })) };
}
export function CanvasStage({ camera, tool, items, children, canPlace, empty = false, changeCamera, settleCamera, onPlace, onClear }: {
  camera: CanvasCamera; tool: CanvasTool; items: StageItem[]; children?: ReactNode; canPlace: boolean; empty?: boolean;
  changeCamera(camera: CanvasCamera): void; settleCamera(): void; onPlace(value: CanvasPlacement): void; onClear(): void;
}) {
  const copy = canvasCopy(useArtifactHost()!.locale), root = useRef<HTMLDivElement>(null), live = useRef<Stroke | null>(null), [ghost, setGhost] = useState<CanvasPlacement | null>(null);
  useCanvasGestures(root, camera, tool === "hand", changeCamera, settleCamera);
  const placing = canPlace && placeTools.includes(tool), point = (event: { clientX: number; clientY: number }) => { const rect = root.current!.getBoundingClientRect(); return { x: camera.x + (event.clientX - rect.left) / camera.zoom, y: camera.y + (event.clientY - rect.top) / camera.zoom }; };
  const cancel = () => { live.current = null; setGhost(null); };
  const finish = (event: React.PointerEvent) => {
    const stroke = live.current; if (!event.nativeEvent.isTrusted || !stroke || event.pointerId !== stroke.id) return;
    event.preventDefault(); stroke.points.push(point(event)); const value = placement(stroke); cancel();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (value.tool !== "draw" || value.points.length > 2) onPlace(value);
  };
  const at = ghost ? screenBox(ghost.box, camera) : null;
  return <div ref={root} tabIndex={0} data-canvas-stage="" className="relative min-h-0 min-w-0 flex-1 overflow-hidden outline-offset-[-2px]" style={{ touchAction: tool === "hand" || placing ? "none" : "pan-x pan-y", cursor: tool === "hand" ? "grab" : placing ? "crosshair" : undefined }} onKeyDown={event => { if (event.key === "Escape" && live.current) { event.preventDefault(); event.stopPropagation(); cancel(); } }} onPointerDown={event => { if (tool === "text" && placing && event.target === event.currentTarget && event.nativeEvent.isTrusted && event.button === 0) { const from = point(event); live.current = { id: event.pointerId, tool, from, points: [from] }; event.currentTarget.setPointerCapture(event.pointerId); } }} onPointerUp={event => { if (tool === "text" && live.current) { finish(event); return; } if (!placing && event.nativeEvent.isTrusted && event.target === event.currentTarget && tool === "select") onClear(); }}>
    {items.map(item => { const box = screenBox(item.box, camera); return <div key={item.id} data-canvas-item={item.id} className="absolute" style={{ left: box.x, top: box.y, width: box.width, height: box.height }}>{item.node}</div>; })}
    {empty && <p role="status" className="pointer-events-none absolute inset-0 grid place-content-center px-8 text-center text-sm text-muted-foreground">{copy.emptyPage}</p>}
    {placing && tool !== "text" && <div className="absolute inset-0 z-10" data-canvas-placement="" onPointerDown={event => {
      if (!event.nativeEvent.isTrusted || event.button !== 0 || !event.isPrimary) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); const from = point(event); live.current = { id: event.pointerId, tool, from, points: [from] }; setGhost(placement(live.current));
    }} onPointerMove={event => {
      const stroke = live.current; if (!event.nativeEvent.isTrusted || !stroke || stroke.id !== event.pointerId) return;
      const next = point(event), previous = stroke.points.at(-1)!; if (Math.hypot(next.x - previous.x, next.y - previous.y) * camera.zoom < 2) return;
      if (stroke.tool === "draw") { stroke.points.push(next); if (stroke.points.length >= 128) stroke.points = stroke.points.filter((_, index) => index % 2 === 0); }
      else stroke.points = [stroke.from, next]; setGhost(placement(stroke));
    }} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel} />}
    {at && ghost && <svg className="pointer-events-none absolute z-20 overflow-visible text-primary" style={{ left: at.x, top: at.y, width: Math.max(1, at.width), height: Math.max(1, at.height) }} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {ghost.tool === "draw" || ghost.tool === "line" || ghost.tool === "arrow" ? <polyline points={ghost.points.map(point => `${point.x * 100},${point.y * 100}`).join(" ")} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" /> : ghost.tool === "ellipse" ? <ellipse cx={50} cy={50} rx={50} ry={50} fill="currentColor" fillOpacity={.08} stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" /> : <rect width={100} height={100} fill="currentColor" fillOpacity={.08} stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
    </svg>}
    {children}
    {placing && <p role="status" className="pointer-events-none absolute inset-x-4 bottom-3 z-20 rounded-md bg-background/90 px-3 py-2 text-center text-xs shadow-sm">{tool === "draw" ? copy.drawHint : copy.placementHint}</p>}
  </div>;
}
