/**
 * [INPUT]: Immutable board identity, shared preview pool, central interaction targets and actual viewport visibility.
 * [OUTPUT]: Layout-contained display-sized static thumbnails with bounded decoding, recoverable admission, shared URL custody and last-consumer capture cancellation.
 * [POS]: Non-interactive Chat/Canvas image; never allocates an interactive frame.
 */
import { useRef } from "react";
import { ImageIcon, RefreshCw } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useArtifactHost } from "../../context";
import { workspaceCopy } from "../copy";
import { usePreviewResource, workspaceImageBlob } from "./resources/preview";
import { INTERACTION_POLICY } from "./editor/motion/policy";
import type { CanvasCameraController } from "./editor/motion/controller";
export function BoardThumbnail({ artifactId, boardId, title, className = "", retryButton = true, controller }: { artifactId: string; boardId: string; title: string; className?: string; retryButton?: boolean; controller?: CanvasCameraController }) {
  const root = useRef<HTMLDivElement>(null), host = useArtifactHost()!, copy = workspaceCopy(host.locale);
  const preview = usePreviewResource(root, "thumbnail", JSON.stringify([host.scope, artifactId, boardId, "thumbnail-v4"]), async signal => {
    const requestId = crypto.randomUUID(), cancel = () => { void host.workspace!({ action: "cancel-thumbnail", artifactId, boardId, requestId }).catch(() => {}); };
    signal.throwIfAborted(); signal.addEventListener("abort", cancel, { once: true });
    try {
      const blob = await workspaceImageBlob(await host.workspace!({ action: "thumbnail", artifactId, boardId, requestId }, signal)); signal.throwIfAborted();
      if (blob.size > 96 * 1024) throw new Error("Static thumbnail exceeds its byte budget");
      return blob;
    } finally { signal.removeEventListener("abort", cancel); }
  }, controller);
  return <div ref={root} data-board-thumbnail={boardId} style={{ contain: "layout paint" }} className={`relative flex min-h-16 items-center justify-center overflow-hidden rounded-md bg-muted ${className}`}>
    {preview.url && !preview.failed ? <img key={preview.url} src={preview.url} alt={title} className="h-full w-full object-contain" draggable={false} onError={preview.fail} /> : <span className="flex flex-col items-center gap-1 p-2 text-xs text-muted-foreground"><ImageIcon className="size-5" aria-hidden /><span>{preview.failed ? copy.noPreview : copy.loading}</span></span>}
    {preview.failed && retryButton && <Button type="button" variant="ghost" size="icon" className="absolute right-1 bottom-1" style={{ minWidth: INTERACTION_POLICY.minTargetCssPx, minHeight: INTERACTION_POLICY.minTargetCssPx }} aria-label={copy.retry} onClick={event => { event.stopPropagation(); preview.retry(); }}><RefreshCw className="size-4" /></Button>}
  </div>;
}
