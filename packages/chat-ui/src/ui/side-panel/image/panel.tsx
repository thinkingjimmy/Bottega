/**
 * [INPUT]: An abortable host image source, localized copy and visibility.
 * [OUTPUT]: ImagePanel, ImagePanelFrame, ImageMedia and ImageUnavailable with five zoom levels, filename-preserving downloads and deterministic media release.
 * [POS]: The side panel's image view behind host/image-tab.tsx; native and private cloud readers supply media without leaking host authority.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useGalleryThumbnail } from "@ai-chat/base-ui/ui/media/use-gallery-thumbnail";
import { ImageShimmer } from "@ai-chat/ui/components/ai-elements/image-shimmer";
import { Button } from "@ai-chat/ui/components/ui/button";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { cn } from "@ai-chat/ui/lib/utils";
import type { SidePanelCopy } from "../../../i18n/side-panel";
export type ImageSource = { key: string; read(signal: AbortSignal): Promise<{ url: string; release(): void }> };
export type GalleryImageSource = { key: string; gallery: Omit<Parameters<typeof useGalleryThumbnail>[0], "retrySignal"> };
export const IMAGE_ZOOM_LEVELS = [25, 50, 100, 150, 200] as const;
export function ImagePanelFrame({ label, active, available, copy, controls, actions, children }: {
  label?: string; active: boolean; available: boolean; copy: SidePanelCopy;
  actions?: ReactNode;
  controls?(zoom: number, change: (zoom: number) => void): ReactNode;
  children(zoom: number, retry: number, onRetry: () => void): ReactNode;
}) {
  const [zoom, setZoom] = useState(100), [retry, setRetry] = useState(0);
  return <section aria-label={label ? copy.previewNamed.replace("{name}", label) : copy.preview} className="flex min-h-0 flex-1 flex-col">
    {controls ? controls(zoom, setZoom) : <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2">{actions}<label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">{copy.zoom}
      <select aria-label={copy.zoom} disabled={!available} className="min-h-11 rounded-md border bg-background px-2 text-sm" value={zoom} onChange={event => setZoom(Number(event.target.value))}>
        {IMAGE_ZOOM_LEVELS.map(value => <option key={value} value={value}>{value}%</option>)}
      </select></label></div>}
    {active && children(zoom, retry, () => setRetry(value => value + 1))}
  </section>;
}
export function ImageViewport({ zoom, children }: { zoom: number; children: ReactNode }) {
  return <SlimScroller className="min-h-0 flex-1 overflow-auto bg-muted/20" data-testid="conversation-image-scroll"><div className={cn("flex min-h-full min-w-full p-4", zoom <= 100 ? "items-center justify-center" : "items-start justify-start")}>{children}</div></SlimScroller>;
}
export function ImageUnavailable({ copy, retryable = false, onRetry }: { copy: SidePanelCopy; retryable?: boolean; onRetry?(): void }) {
  return <div className="mx-auto grid min-h-40 max-w-sm place-items-center gap-3 rounded-lg border bg-background p-6 text-center text-muted-foreground text-sm" role="status"><p>{copy.imageUnavailable}</p>
    {retryable && onRetry && <Button className="min-h-11" onClick={onRetry} type="button" variant="outline">{copy.retry}</Button>}
  </div>;
}
export function ImageMedia({ alt, onRetry, previewUrl, request, zoom, copy }: { alt: string; onRetry(): void; previewUrl: string; request: string | { error: string; retryable: boolean }; zoom: number; copy: SidePanelCopy }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!previewUrl || failedUrl === previewUrl) return typeof request === "object" || failedUrl === previewUrl
    ? <ImageUnavailable copy={copy} retryable={typeof request === "object" ? request.retryable : true} onRetry={() => { setFailedUrl(null); onRetry(); }} />
    : <ImageShimmer className="mx-auto" label={copy.loadingImage} />;
  return <div className={cn("shrink-0", zoom <= 100 && "mx-auto")} data-testid="conversation-image-canvas" data-zoom={zoom} style={{ width: `${zoom}%` }}>
    <img alt={alt} className="block h-auto w-full rounded-lg border object-contain shadow-sm" draggable={false} src={previewUrl} onError={() => setFailedUrl(previewUrl)} />
  </div>;
}
export function ImagePanel({ source, label, active, hydrated, copy, controls }: {
  source: ImageSource | GalleryImageSource | null; label?: string; active: boolean; hydrated: boolean; copy: SidePanelCopy;
  controls?(zoom: number, change: (zoom: number) => void): ReactNode;
}) {
  return <ImagePanelFrame label={label} active={active} available={Boolean(source)} copy={copy} controls={controls}>{(zoom, retry, onRetry) => <ImageViewport zoom={zoom}>
    {!hydrated ? <ImageShimmer className="mx-auto" label={copy.loadingImage} /> : !source ? <ImageUnavailable copy={copy} /> :
      "gallery" in source ? <GalleryMedia key={source.key} source={source} label={label} zoom={zoom} retry={retry} onRetry={onRetry} copy={copy} /> :
      <LeasedMedia source={source} label={label} zoom={zoom} retry={retry} onRetry={onRetry} copy={copy} download={!controls} />}
  </ImageViewport>}</ImagePanelFrame>;
}
type MediaProps = { label?: string; zoom: number; retry: number; onRetry(): void; copy: SidePanelCopy };
function GalleryMedia({ source, label, zoom, retry, onRetry, copy }: MediaProps & { source: GalleryImageSource }) {
  const current = useGalleryThumbnail({ ...source.gallery, retrySignal: retry });
  return <ImageMedia alt={label ?? copy.preview} copy={copy} zoom={zoom} onRetry={onRetry} previewUrl={current.preview?.dataUrl ?? ""} request={current.request} />;
}
function LeasedMedia({ source, label, zoom, retry, onRetry, copy, download }: MediaProps & { source: ImageSource; download: boolean }) {
  const current = useImageLease(source, retry), name = label ?? copy.preview;
  const media = <ImageMedia alt={name} copy={copy} zoom={zoom} onRetry={onRetry} previewUrl={current?.url ?? ""} request={current?.failed ? { error: "read-failed", retryable: true } : "loading"} />;
  if (!download) return media;
  return <div className="flex min-w-full flex-col gap-2">
    {current?.url && <Button asChild variant="ghost" className="min-h-11 self-end"><a href={current.url} download={name}>{copy.download}</a></Button>}{media}
  </div>;
}
function useImageLease(source: ImageSource | null, retry: number) {
  const key = `${source?.key}:${retry}`, [loaded, setLoaded] = useState<{ source: ImageSource | null; key: string; url: string; failed?: boolean }>({ source, key, url: "" });
  if (loaded.source !== source || loaded.key !== key) setLoaded({ source, key, url: "" });
  useEffect(() => {
    if (!source) return;
    const controller = new AbortController(); let release: (() => void) | undefined;
    void source.read(controller.signal).then(result => {
      if (controller.signal.aborted) { result.release(); return; }
      release = result.release; setLoaded({ source, key, url: result.url });
    }).catch(() => { if (!controller.signal.aborted) setLoaded({ source, key, url: "", failed: true }); });
    return () => { controller.abort(); release?.(); };
  }, [source, key]);
  return source && loaded.source === source && loaded.key === key ? loaded : null;
}
