/**
 * [INPUT]: Fixed saved board identity, real image load/error events and the existing host's static image/private-file port.
 * [OUTPUT]: Lazy static thumbnails with shared requests, owner-bound image failure/retry states and reference-counted URL release.
 * [POS]: Non-interactive overview/card image; never mounts or executes a board frame.
 */
import { useEffect, useRef, useState } from "react";
import { ImageIcon, RefreshCw } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useArtifactHost, type ArtifactHost } from "../../context";
import { workspaceCopy } from "../copy";
type Entry = { url: string; refs: number; promise?: Promise<string>; error?: boolean };
const owners = new WeakMap<ArtifactHost, Map<string, Entry>>();
export function BoardThumbnail({ artifactId, boardId, title, className = "", retryButton = true }: { artifactId: string; boardId: string; title: string; className?: string; retryButton?: boolean }) {
  const host = useArtifactHost()!, copy = workspaceCopy(host.locale), root = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(false), [result, setResult] = useState<{ key: string; url?: string; failed?: boolean }>({ key: "" }), [retry, setRetry] = useState(0);
  const renderKey = JSON.stringify([host.scope, artifactId, boardId, retry]), url = result.key === renderKey && !result.failed ? result.url ?? "" : "", failed = result.key === renderKey && result.failed;
  const imageFailure = useRef<{ host: ArtifactHost; key: string; fail(url: string): void } | null>(null);
  useEffect(() => { const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "120px" }); if (root.current) observer.observe(root.current); return () => observer.disconnect(); }, []);
  useEffect(() => {
    if (!visible || !host.workspace) return;
    let current = true; const key = JSON.stringify([artifactId, boardId]); let cache = owners.get(host); if (!cache) owners.set(host, cache = new Map());
    let entry = cache.get(key); if (!entry || entry.error && retry) { entry = { url: "", refs: 0 }; cache.set(key, entry); }
    entry.refs++; const held = entry;
    const handler = { host, key: renderKey, fail: (failedUrl: string) => {
      if (!current || !failedUrl || failedUrl !== held.url) return;
      held.error = true; setResult({ key: renderKey, failed: true });
    } };
    imageFailure.current = handler;
    const load = held.url ? Promise.resolve(held.url) : held.promise ??= host.workspace({ action: "thumbnail", artifactId, boardId, requestId: crypto.randomUUID() }).then(value => {
      const result = value as { blob?: Blob; data?: string; mime?: string };
      const blob = result.blob ?? (result.data ? new Blob([Uint8Array.from(atob(result.data), character => character.charCodeAt(0))], { type: result.mime ?? "image/jpeg" }) : null);
      if (!blob || !blob.type.startsWith("image/") || blob.size > 96 * 1024) throw new Error("Static thumbnail is unavailable");
      held.url = URL.createObjectURL(blob); if (!held.refs) { URL.revokeObjectURL(held.url); held.url = ""; } return held.url;
    }).catch(cause => { held.error = true; throw cause; });
    void load.then(url => { if (current) setResult(held.error ? { key: renderKey, failed: true } : { key: renderKey, url }); }).catch(() => { if (current) setResult({ key: renderKey, failed: true }); });
    return () => {
      current = false; if (imageFailure.current === handler) imageFailure.current = null;
      if (--held.refs === 0) { if (held.url) URL.revokeObjectURL(held.url); if (cache!.get(key) === held) cache!.delete(key); }
    };
  }, [host, visible, artifactId, boardId, retry, renderKey]);
  return <div ref={root} data-board-thumbnail={boardId} className={`relative flex min-h-16 items-center justify-center overflow-hidden rounded-md bg-muted ${className}`}>
    {url ? <img key={url} src={url} alt={title} className="h-full w-full object-contain" draggable={false} onError={event => {
      const handler = imageFailure.current; if (handler?.host === host && handler.key === renderKey) handler.fail(event.currentTarget.currentSrc || event.currentTarget.src);
    }} /> : <span className="flex flex-col items-center gap-1 p-2 text-xs text-muted-foreground"><ImageIcon className="size-5" aria-hidden /><span>{failed ? copy.noPreview : copy.loading}</span></span>}
    {failed && retryButton && <Button type="button" variant="ghost" size="icon" className="absolute right-1 bottom-1 min-h-[44px] min-w-[44px]" aria-label={copy.retry} onClick={event => { event.stopPropagation(); setRetry(value => value + 1); }}><RefreshCw className="size-4" /></Button>}
  </div>;
}
