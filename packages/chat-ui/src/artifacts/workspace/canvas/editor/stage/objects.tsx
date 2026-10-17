/**
 * [INPUT]: CM-validated objects, fixed image data URLs and trusted host selection/navigation callbacks.
 * [OUTPUT]: Canonical page-object content and host-owned selection hit areas without arbitrary HTML/CSS or network assets.
 * [POS]: Canvas object view; board children retain the canonical frame layer and expose only trusted parent hit areas.
 */
import { useArtifactHost } from "../../../../context";
import { canvasCopy } from "../copy";
import { canvasObjectMarkup } from "@ai-chat/cloud-protocol/artifacts/design/canvas/markup";
import type { CanvasObject } from "@ai-chat/cloud-protocol/artifacts/design/canvas/model";
export function CanvasObjectView({ object, imageUrl, zoom, selected, preview, selecting = true, content = true, choose, edit, navigate }: {
  object: CanvasObject; imageUrl?: string; zoom: number; selected: boolean; preview: boolean; selecting?: boolean; content?: boolean;
  choose(extend: boolean): void; edit(): void; navigate(href: string): void;
}) {
  const copy = canvasCopy(useArtifactHost()!.locale);
  if (object.kind === "image" && !imageUrl && content) return <div role="status" className="grid h-full place-content-center border p-2 text-xs text-muted-foreground">{copy.imageMissing}</div>;
  const html = content ? canvasObjectMarkup({ ...object, bounds: { ...object.bounds, x: 0, y: 0 } }, () => imageUrl ?? null) : "";
  return <div className="relative h-full w-full" data-canvas-object={object.id} data-selected={selected || undefined}>
    {content && <div className="absolute left-0 top-0" style={{ width: object.bounds.width, height: object.bounds.height, transform: `scale(${zoom})`, transformOrigin: "top left" }} dangerouslySetInnerHTML={{ __html: html }} onClickCapture={event => {
      const href = event.target instanceof Element ? event.target.closest("a")?.getAttribute("href") : null;
      if (href) { event.preventDefault(); if (event.nativeEvent.isTrusted && preview) navigate(href); }
    }} />}
    {!preview && selecting && <button type="button" className={`absolute inset-0 min-h-[44px] min-w-[44px] bg-transparent outline-offset-2 ${selected ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-primary/60"}`} aria-label={object.kind === "text" || object.kind === "note" ? object.text.slice(0, 100) || copy[object.kind] : object.kind === "image" ? object.alt || copy.image : object.kind === "drawing" ? copy.draw : copy[object.kind]} aria-pressed={selected} onClick={event => { if (event.nativeEvent.isTrusted) { event.stopPropagation(); choose(event.shiftKey); } }} onDoubleClick={event => { if (event.nativeEvent.isTrusted && (object.kind === "text" || object.kind === "note")) { event.preventDefault(); edit(); } }} />}
  </div>;
}
