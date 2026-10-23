/**
 * [INPUT]: Host-owned world bounds, a scope-owned camera controller, editor wheel surface, active tool and real renderer/placement callbacks.
 * [OUTPUT]: Zoom-subscribed world stage, imperative pan projection with gesture-scoped compositing, optional camera-subscribed overlays and hysteretic content residency with bounded placement/drawing previews and trusted gestures across the editor wheel surface.
 * [POS]: Canvas stage; fixed board/object content is supplied by the workspace, never inferred from child DOM.
 */
import { memo, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { screenBox, type CanvasBox, type CanvasCamera } from "../motion/camera";
import { timedDomProjection, type CameraInput } from "../motion/timing";
import { cameraTrace } from "./state/diagnostics";
import { useCanvasResidency } from "../motion/residency";
import { INTERACTION_POLICY } from "../motion/policy";
import { useProjectedCamera, useProjectedZoom, type CanvasCameraController } from "../motion/controller";
import { useCanvasGestures } from "../motion/gestures";
import type { CanvasTool } from "../tools";
import { canvasCopy } from "../copy";
import { useArtifactHost } from "../../../../context";
export type StageItem = { id: string; box: CanvasBox; node: ReactNode; label?: ReactNode; hit?: ReactNode; pinned?: boolean };
export type CanvasPlacement = { tool: CanvasTool; box: CanvasBox; points: { x: number; y: number }[] };
type Stroke = { id: number; tool: CanvasTool; from: { x: number; y: number }; points: { x: number; y: number }[] };
const placeTools: CanvasTool[] = ["text", "artboard", "note", "draw", "rectangle", "ellipse", "line", "arrow", "image"];
function placement(stroke: Stroke): CanvasPlacement {
  const end = stroke.points.at(-1)!, xs = stroke.points.map(point => point.x), ys = stroke.points.map(point => point.y), drawing = stroke.tool === "draw";
  const x = drawing ? Math.min(...xs) : Math.min(stroke.from.x, end.x), y = drawing ? Math.min(...ys) : Math.min(stroke.from.y, end.y);
  const width = Math.max(1, drawing ? Math.max(...xs) - x : Math.abs(end.x - stroke.from.x)), height = Math.max(1, drawing ? Math.max(...ys) - y : Math.abs(end.y - stroke.from.y));
  return { tool: stroke.tool, box: { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }, points: stroke.points.map(point => ({ x: Math.round((point.x - x) / width * 1000) / 1000, y: Math.round((point.y - y) / height * 1000) / 1000 })) };
}
export function CanvasStage({ size, controller, wheelRoot, tool, items, children, canPlace, empty = false, changeCamera, getCamera, settleCamera, onPlace, onClear }: {
  size: { width: number; height: number }; controller: CanvasCameraController; wheelRoot: RefObject<HTMLElement | null>; tool: CanvasTool; items: StageItem[]; children?: (camera: CanvasCamera) => ReactNode; canPlace: boolean; empty?: boolean;
  getCamera(): CanvasCamera; changeCamera(camera: CanvasCamera, input?: CameraInput): void; settleCamera(): void; onPlace(value: CanvasPlacement): void; onClear(): void;
}) {
  const world = useRef<HTMLDivElement>(null), labels = useRef<HTMLDivElement>(null), hits = useRef<HTMLDivElement>(null);
  const zoom = useProjectedZoom(controller), resident = useCanvasResidency(controller, items, size);
  const copy = canvasCopy(useArtifactHost()!.locale), root = useRef<HTMLDivElement>(null), live = useRef<Stroke | null>(null), [ghost, setGhost] = useState<CanvasPlacement | null>(null);
  const hasOverlays = Boolean(ghost || children);
  useLayoutEffect(() => {
    const stage = root.current, stopMotion = controller.motionTo(active => stage?.toggleAttribute("data-canvas-moving", active));
    const stopProjection = controller.projectTo((camera, projection) => {
      const node = world.current; if (!node) return;
      node.style.transform = `translate(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px) scale(${camera.zoom})`;
      for (const layer of [labels.current, hits.current]) if (layer) layer.style.transform = `translate(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px)`;
      timedDomProjection(projection); cameraTrace("dom-projection", { scope: controller.scope, camera });
    });
    return () => { stopProjection(); stopMotion(); stage?.removeAttribute("data-canvas-moving"); };
  }, [controller]);
  useCanvasGestures(root, wheelRoot, getCamera, tool === "hand", changeCamera, settleCamera);
  const placing = canPlace && placeTools.includes(tool), point = (event: { clientX: number; clientY: number }) => { const rect = root.current!.getBoundingClientRect(), camera = controller.snapshot(); return { x: camera.x + (event.clientX - rect.left) / camera.zoom, y: camera.y + (event.clientY - rect.top) / camera.zoom }; };
  const cancel = () => { live.current = null; setGhost(null); };
  const finish = (event: React.PointerEvent) => {
    const stroke = live.current; if (!event.nativeEvent.isTrusted || !stroke || event.pointerId !== stroke.id) return;
    event.preventDefault(); stroke.points.push(point(event)); const value = placement(stroke); cancel();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (value.tool !== "draw" || value.points.length > 2) onPlace(value);
  };
  return <div ref={root} tabIndex={0} data-canvas-stage="" className="relative isolate z-0 min-h-0 min-w-0 flex-1 overflow-hidden outline-offset-[-2px]" style={{ touchAction: tool === "hand" || placing ? "none" : "pan-x pan-y", cursor: tool === "hand" ? "grab" : placing ? "crosshair" : undefined }} onKeyDown={event => { if (event.key === "Escape" && live.current) { event.preventDefault(); event.stopPropagation(); cancel(); } }} onPointerDown={event => { if (tool === "text" && placing && event.target === event.currentTarget && event.nativeEvent.isTrusted && event.button === 0) { const from = point(event); live.current = { id: event.pointerId, tool, from, points: [from] }; event.currentTarget.setPointerCapture(event.pointerId); } }} onPointerUp={event => { if (tool === "text" && live.current) { finish(event); return; } if (!placing && event.nativeEvent.isTrusted && event.target === event.currentTarget && tool === "select") onClear(); }}>
    <div ref={world} data-canvas-world="" className="pointer-events-none absolute left-0 top-0 z-0" style={{ transformOrigin: "0 0" }}>
      <CanvasWorld items={items} resident={resident} />
    </div>
    <CanvasScreenItems layer="labels" rootRef={labels} items={items} resident={resident} zoom={zoom} />
    <CanvasScreenItems layer="hits" rootRef={hits} items={items} resident={resident} zoom={zoom} />
    {empty && <p role="status" className="pointer-events-none absolute inset-0 grid place-content-center px-8 text-center text-sm text-muted-foreground">{copy.emptyPage}</p>}
    {placing && tool !== "text" && <div className="absolute inset-0 z-[200]" data-canvas-placement="" onPointerDown={event => {
      if (!event.nativeEvent.isTrusted || event.button !== 0 || !event.isPrimary) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); const from = point(event); live.current = { id: event.pointerId, tool, from, points: [from] }; setGhost(placement(live.current));
    }} onPointerMove={event => {
      const stroke = live.current; if (!event.nativeEvent.isTrusted || !stroke || stroke.id !== event.pointerId) return;
      const next = point(event), previous = stroke.points.at(-1)!; if (Math.hypot(next.x - previous.x, next.y - previous.y) * controller.snapshot().zoom < 2) return;
      if (stroke.tool === "draw") { stroke.points.push(next); if (stroke.points.length >= 128) stroke.points = stroke.points.filter((_, index) => index % 2 === 0); }
      else stroke.points = [stroke.from, next]; setGhost(placement(stroke));
    }} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel} />}
    {hasOverlays && <CanvasOverlays controller={controller} ghost={ghost} render={children} />}
    {placing && <p role="status" className="pointer-events-none absolute inset-x-4 bottom-3 z-20 rounded-md bg-background/90 px-3 py-2 text-center text-xs shadow-sm">{tool === "draw" ? copy.drawHint : copy.placementHint}</p>}
  </div>;
}

function CanvasOverlays({ controller, ghost, render }: { controller: CanvasCameraController; ghost: CanvasPlacement | null; render?: (camera: CanvasCamera) => ReactNode }) {
  const camera = useProjectedCamera(controller), at = ghost ? screenBox(ghost.box, camera) : null;
  return <>
    {at && ghost && <svg className="pointer-events-none absolute z-[200] overflow-visible text-primary" style={{ left: at.x, top: at.y, width: Math.max(1, at.width), height: Math.max(1, at.height) }} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {ghost.tool === "draw" || ghost.tool === "line" || ghost.tool === "arrow" ? <polyline points={ghost.points.map(point => `${point.x * 100},${point.y * 100}`).join(" ")} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" /> : ghost.tool === "ellipse" ? <ellipse cx={50} cy={50} rx={50} ry={50} fill="currentColor" fillOpacity={.08} stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" /> : <rect width={100} height={100} fill="currentColor" fillOpacity={.08} stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
    </svg>}
    {render?.(camera)}
  </>;
}

const CanvasWorld = memo(function CanvasWorld({ items, resident }: { items: StageItem[]; resident: ReadonlySet<string> }) {
  return <>{items.map(item => <div key={item.id} data-canvas-item={item.id} className="pointer-events-auto absolute" style={{ left: item.box.x, top: item.box.y, width: item.box.width, height: item.box.height }} data-canvas-resident={resident.has(item.id) || undefined}>{resident.has(item.id) ? item.node : null}</div>)}</>;
});

const CanvasScreenItems = memo(function CanvasScreenItems({ layer, rootRef, items, resident, zoom }: {
  layer: "labels" | "hits"; rootRef: RefObject<HTMLDivElement | null>; items: StageItem[]; resident: ReadonlySet<string>; zoom: number;
}) {
  const hit = layer === "hits";
  return <div ref={rootRef} data-canvas-layer={layer} className="pointer-events-none absolute inset-0 z-[100]">
    {items.filter(item => (hit ? item.hit : item.label) && resident.has(item.id)).map(item => <div key={item.id} data-canvas-hit={hit ? item.id : undefined} data-canvas-label={hit ? undefined : item.id}
      className={hit ? "pointer-events-auto absolute" : "pointer-events-none absolute [&>*]:pointer-events-auto"}
      style={{ left: item.box.x * zoom, top: item.box.y * zoom, width: hit ? Math.max(INTERACTION_POLICY.minTargetCssPx, item.box.width * zoom) : item.box.width * zoom, height: hit ? Math.max(INTERACTION_POLICY.minTargetCssPx, item.box.height * zoom) : undefined }}>
      {hit ? item.hit : item.label}
    </div>)}
  </div>;
});
