/**
 * [INPUT]: Fixed design fence, saved-board thumbnail service and existing host open/save actions.
 * [OUTPUT]: Headerless DesignArtifactCard with a large static preview, floating save and bottom Open Artifact actions.
 * [POS]: Chat presentation only; editable frames and source mutations remain in the expanded workspace.
 */
import { lazy, Suspense } from "react";
import { Download } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { useArtifactHost } from "../context";
import { artifactCopy } from "../copy";
import "./presentation.css";
const Thumbnail = lazy(() => import("../workspace/canvas/thumbnail").then(module => ({ default: module.BoardThumbnail })));
const Current = lazy(() => import("../workspace/directory").then(module => ({ default: module.CurrentVersionLink })));

export function DesignArtifactCard({ fence, busy, error, open, save }: { fence: ArtifactFence; busy: boolean; error: boolean; open(): void; save(): void }) {
  const host = useArtifactHost()!, copy = artifactCopy(host.locale), design = fence.design!;
  const board = design.boards.find(board => board.id === design.launchBoard);
  return <section aria-label={fence.title} data-artifact-id={fence.id} data-artifact-design-card="" className="artifact-design-card my-3 overflow-hidden rounded-lg border bg-card text-card-foreground">
    <div className="artifact-design-card-preview relative">
      <Button type="button" variant="ghost" size="icon" className="absolute right-2 top-2 z-10 min-h-[44px] min-w-[44px] bg-card/90 shadow-sm backdrop-blur-sm hover:bg-card" aria-label={copy.save} title={copy.save} disabled={busy} onClick={save}><Download className="size-4" /></Button>
      <Suspense fallback={<div aria-busy="true" className="h-full" />}><Thumbnail artifactId={fence.id} boardId={design.launchBoard} title={board?.title ?? fence.title} className="artifact-design-card-image" /></Suspense>
    </div>
    <footer className="relative flex min-h-[68px] flex-wrap items-center justify-end gap-2 px-4 pb-4 pt-2">
      {host.workspace && <div className="mr-auto min-w-0 text-xs"><Suspense fallback={null}><Current fence={fence} /></Suspense></div>}
      <Button type="button" className="min-h-[44px] shrink-0 px-5" data-action="open-version" onClick={open}>{openLabel(host.locale)}</Button>
    </footer>
    {error && <p role="alert" className="px-4 pb-3 text-sm">{copy.failed}</p>}
  </section>;
}

const openLabel = (locale: string) => locale.startsWith("zh") ? "打开 Artifact" : locale.startsWith("ja") ? "Artifact を開く" : locale.startsWith("fr") ? "Ouvrir l’Artifact" : locale.startsWith("es") ? "Abrir Artifact" : "Open Artifact";
