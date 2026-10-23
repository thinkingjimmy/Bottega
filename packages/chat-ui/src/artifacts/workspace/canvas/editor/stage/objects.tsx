/**
 * [INPUT]: CM-validated objects, immutable image identities, shared Blob previews and trusted host selection/navigation callbacks.
 * [OUTPUT]: Stable canonical-markup CanvasObjectView previews and localized screen-space CanvasObjectHit buttons without arbitrary HTML/CSS or network assets.
 * [POS]: Canvas object view; board children retain the canonical frame layer and expose only trusted parent hit areas.
 */
import { useEffect, useMemo, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { usePreviewResource, workspaceImageBlob } from "../../resources/preview";
import type { CanvasCameraController } from "../motion/controller";
import type { CanvasImageIdentity } from "@ai-chat/cloud-protocol/artifacts/design/canvas/model";
import { useArtifactHost } from "../../../../context";
import { workspaceCopy } from "../../../copy";
import { canvasCopy } from "../copy";
import { canvasObjectMarkup } from "@ai-chat/cloud-protocol/artifacts/design/canvas/markup";
import type { CanvasObject } from "@ai-chat/cloud-protocol/artifacts/design/canvas/model";
export function CanvasObjectView({ object, image, artifactId, snapshotRef, controller, selected, preview, navigate, onFailure }: {
  object: CanvasObject; image?: Omit<CanvasImageIdentity, "snapshotRef">; artifactId: string; snapshotRef: string; controller: CanvasCameraController; selected: boolean; preview: boolean;
  navigate(href: string): void; onFailure(id: string, retry: (() => void) | null): void;
}) {
  const root = useRef<HTMLDivElement>(null), host = useArtifactHost()!, copy = workspaceCopy(host.locale);
  const resource = usePreviewResource(root, "image", image ? JSON.stringify([snapshotRef, image.path, image.digest, image.mime, image.bytes]) : "", async signal => workspaceImageBlob(await host.workspace!({ action: "image", artifactId, image: { ...image!, snapshotRef } }, signal)), image ? controller : undefined);
  const imageUrl = resource.failed ? "" : resource.url;
  useEffect(() => { onFailure(object.id, resource.failed ? resource.retry : null); return () => onFailure(object.id, null); }, [object.id, resource.failed, resource.retry, onFailure]);
  const html = useMemo(() => (object.kind !== "image" || imageUrl) ? canvasObjectMarkup({ ...object, bounds: { ...object.bounds, x: 0, y: 0 } }, () => imageUrl ?? null) : "", [object, imageUrl]);
  const markup = useMemo(() => ({ __html: html }), [html]);
  return <div ref={root} onErrorCapture={resource.fail} className="relative h-full w-full" data-canvas-object={object.id} data-selected={selected || undefined}>
    {object.kind === "image" && !imageUrl && <span role="status" className="absolute inset-0 grid place-content-center text-xs text-muted-foreground">{resource.failed || !image ? copy.noPreview : copy.loading}</span>}
    <div className="absolute left-0 top-0" style={{ width: object.bounds.width, height: object.bounds.height }} dangerouslySetInnerHTML={markup} onClickCapture={event => {
      const href = event.target instanceof Element ? event.target.closest("a")?.getAttribute("href") : null;
      if (href) { event.preventDefault(); if (event.nativeEvent.isTrusted && preview) navigate(href); }
    }} />

  </div>;
}

export function CanvasObjectHit({ object, selected, choose, edit, retry }: { object: CanvasObject; selected: boolean; choose(): void; edit(): void; retry?: () => void }) {
  const host = useArtifactHost()!, copy = canvasCopy(host.locale);
  return <button type="button" className={`h-full w-full bg-transparent outline-offset-2 ${selected ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-primary/60"}`} aria-label={retry ? workspaceCopy(host.locale).retry : object.kind === "text" || object.kind === "note" ? object.text.slice(0, 100) || copy[object.kind] : object.kind === "image" ? object.alt || copy.image : object.kind === "drawing" ? copy.draw : copy[object.kind]} aria-pressed={selected} onClick={event => { if (event.nativeEvent.isTrusted) { event.stopPropagation(); choose(); retry?.(); } }} onDoubleClick={event => { if (event.nativeEvent.isTrusted && (object.kind === "text" || object.kind === "note")) { event.preventDefault(); edit(); } }}>{retry && <RefreshCw className="mx-auto size-5" aria-hidden />}</button>;
}
