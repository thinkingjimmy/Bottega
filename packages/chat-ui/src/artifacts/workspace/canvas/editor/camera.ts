/**
 * [INPUT]: Canvas bounds, viewport dimensions and trusted pointer coordinates.
 * [OUTPUT]: Bounded viewport fit, pointer-centred zoom and pan calculations without source mutations.
 * [POS]: Canvas editor camera math; the workspace checkpoint owns persistence.
 */
export type CanvasBox = { x: number; y: number; width: number; height: number };
export type CanvasCamera = { x: number; y: number; zoom: number };
export const MIN_ZOOM = .05, MAX_ZOOM = 3;
const finite = (value: number) => Number.isFinite(value) ? Math.max(-100000, Math.min(100000, value)) : 0;
export const clampZoom = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, finite(value)));
export function zoomAt(camera: CanvasCamera, point: { x: number; y: number }, zoom: number): CanvasCamera {
  const scale = clampZoom(zoom);
  return { x: finite(camera.x + point.x / camera.zoom - point.x / scale), y: finite(camera.y + point.y / camera.zoom - point.y / scale), zoom: scale };
}
export function panCamera(camera: CanvasCamera, dx: number, dy: number): CanvasCamera {
  return { ...camera, x: finite(camera.x - dx / camera.zoom), y: finite(camera.y - dy / camera.zoom) };
}
export function fitCamera(box: CanvasBox, area: { width: number; height: number }, widthOnly = false): CanvasCamera {
  const zoom = clampZoom(Math.min(1, Math.max(1, area.width - 64) / Math.max(1, box.width), widthOnly ? MAX_ZOOM : Math.max(1, area.height - 64) / Math.max(1, box.height)));
  return { x: box.x - (area.width / zoom - box.width) / 2, y: widthOnly ? box.y - 32 / zoom : box.y - (area.height / zoom - box.height) / 2, zoom };
}
export function unionBoxes(boxes: CanvasBox[]): CanvasBox {
  if (!boxes.length) return { x: 0, y: 0, width: 800, height: 600 };
  const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
  return { x, y, width: Math.max(1, ...boxes.map(box => box.x + box.width - x)), height: Math.max(1, ...boxes.map(box => box.y + box.height - y)) };
}
export const screenBox = (box: CanvasBox, camera: CanvasCamera): CanvasBox => ({ x: (box.x - camera.x) * camera.zoom, y: (box.y - camera.y) * camera.zoom, width: box.width * camera.zoom, height: box.height * camera.zoom });
