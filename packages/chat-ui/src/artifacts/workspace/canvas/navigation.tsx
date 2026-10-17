/**
 * [INPUT]: Fixed manifest boards, note counts, immutable thumbnail identities and workspace navigation layout.
 * [OUTPUT]: Keyboard-readable desktop rail/narrow strip and static overview with explicit current board.
 * [POS]: Canvas navigation; overview creates images and never interaction frames.
 */
import type { DesignManifest } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { LayoutGrid, X } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useArtifactHost } from "../../context";
import { workspaceCopy } from "../copy";
import { BoardThumbnail } from "./thumbnail";
export function BoardNavigation({ artifactId, manifest, boardId, overview, counts, choose, showOverview, close }: { artifactId: string; manifest: DesignManifest; boardId: string; overview: boolean;
  counts: Record<string, number>; choose(id: string): void; showOverview(): void; close(): void }) {
  const copy = workspaceCopy(useArtifactHost()!.locale);
  return <nav data-workspace-boards="" aria-label={copy.boards} className="flex h-full min-h-0 flex-col border-r bg-background">
    <header className="flex min-h-[44px] shrink-0 items-center px-3"><h3 className="min-w-0 flex-1 text-xs font-semibold">{copy.boards} · {manifest.boards.length}</h3><Button type="button" size="icon" variant="ghost" aria-label={copy.closePanel} className="min-h-[44px] min-w-[44px]" onClick={close}><X className="size-4" /></Button></header>
    <div className="artifact-board-list flex min-h-0 flex-1 flex-col gap-1 overflow-auto p-2">
      <Button type="button" variant={overview ? "secondary" : "ghost"} className="min-h-[44px] w-full shrink-0 justify-start text-xs" aria-pressed={overview} onClick={showOverview}><LayoutGrid className="size-4" />{copy.overview}</Button>
      {manifest.boards.map((board, index) => <button key={board.id} type="button" data-board-id={board.id} data-selected={!overview && board.id === boardId ? "true" : "false"} aria-label={`${copy.board} ${index + 1} · ${board.title} · ${board.viewport.width} × ${board.viewport.height}`} aria-current={!overview && board.id === boardId ? "true" : undefined} className={`block w-full shrink-0 rounded-md border p-2 text-left focus-visible:outline-2 focus-visible:outline-primary ${!overview && board.id === boardId ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"}`} onClick={() => choose(board.id)}>
        <BoardThumbnail artifactId={artifactId} boardId={board.id} title={board.title} className="h-20" retryButton={false} />
        <span className="mt-2 flex items-center gap-1"><span className="min-w-0 flex-1 truncate text-xs font-medium">{board.title}</span>{counts[board.id] > 0 && <span className="rounded bg-muted px-1.5 text-xs">{counts[board.id]}</span>}</span><span className="block text-[11px] text-muted-foreground">{board.viewport.width} × {board.viewport.height}</span>
      </button>)}
    </div>
  </nav>;
}
export function BoardOverview({ artifactId, manifest, counts, choose }: { artifactId: string; manifest: DesignManifest; counts: Record<string, number>; choose(id: string): void }) {
  return <div data-workspace-overview="" className="grid min-h-0 flex-1 auto-rows-max grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-5 overflow-auto p-6">
    {manifest.boards.map(board => <button key={board.id} type="button" data-board-id={board.id} className="min-h-[44px] min-w-0 rounded-md text-left focus-visible:outline-2 focus-visible:outline-primary" onClick={() => choose(board.id)}><BoardThumbnail artifactId={artifactId} boardId={board.id} title={board.title} className="h-40 border shadow-sm" retryButton={false} /><span className="mt-2 block truncate text-xs font-medium">{board.title}{counts[board.id] ? ` · ${counts[board.id]}` : ""}</span><span className="block text-[11px] text-muted-foreground">{board.viewport.width} × {board.viewport.height}</span></button>)}
  </div>;
}
