/**
 * [INPUT]: Displayed immutable version, shared mutation controller and workspace navigation/review actions.
 * [OUTPUT]: Saved-history, annotation, board navigation and scoped advanced workspace actions.
 * [POS]: Workspace chrome above CanvasEditor, which owns actual zoom/fit; input fields keep native text Undo.
 */
import { useState } from "react";
import { Eye, MousePointer2, MessageSquare, Undo2, Redo2, PanelsTopLeft, Expand, Minimize2, MoreHorizontal, History, Download, Palette, Settings2, RefreshCw, LayoutGrid } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@ai-chat/ui/components/ui/popover";
import { useArtifactHost, useArtifactPresentation } from "../../context";
import { workspaceCopy } from "../copy";
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { DesignEditController } from "./edits";
export type Inspector = "properties" | "comments" | "system" | "history" | "export" | "settings";
export type CanvasTool = "preview" | "select" | "annotate";
export function WorkspaceToolbar({ state, tool, overview, controls, commentCount, onTool, onBoards, onOverview, onPanel, onRefresh, onCurrent }: {
  state: WorkspaceRead; tool: CanvasTool; selecting: boolean; overview: boolean; controls: DesignEditController; commentCount: number;
  onTool(tool: CanvasTool): void; onBoards(): void; onOverview(): void; onPanel(panel: Inspector): void; onRefresh(): void; onCurrent(): void;
}) {
  const host = useArtifactHost()!, copy = workspaceCopy(host.locale), presentation = useArtifactPresentation(), [menuOpen, setMenuOpen] = useState(false);
  const action = (label: string, Icon: typeof Eye, click: () => void, active = false, disabled = false) => <Button type="button" variant={active ? "secondary" : "ghost"} size="icon" className="min-h-[44px] min-w-[44px] shrink-0" aria-label={label} title={label} aria-pressed={active || undefined} disabled={disabled} onClick={click}><Icon className="size-4" /></Button>;
  return <header data-workspace-toolbar="" className="z-20 shrink-0 border-b bg-background">
    <div className="flex min-h-[52px] min-w-0 items-center gap-2 px-3"><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold" title={`${state.title} · v${state.revision}`}>{state.title} · v{state.revision}</h2><p role="status" className="truncate text-xs text-muted-foreground">{state.revision < state.latestRevision || state.editable === false ? copy.readonly : controls.pending ? copy.checking : controls.canvasDraft?.draft ? copy.dirty : state.dirty ? copy.dirty : copy.saved}</p></div>
      {state.revision < state.latestRevision && <Button type="button" variant="outline" className="min-h-[44px] shrink-0 px-2 text-xs" onClick={onCurrent}>{copy.current}</Button>}
      {presentation?.canExpand && action(presentation.full ? copy.backToChat : copy.full, presentation.full ? Minimize2 : Expand, () => presentation.setFull(!presentation.full))}
    </div>
    <div className="flex min-h-[48px] items-center gap-0.5 overflow-x-auto px-2 [scrollbar-width:none]" role="toolbar" aria-label={copy.tools}>
      {action(copy.boards, PanelsTopLeft, onBoards)}
      {action(copy.overview, LayoutGrid, onOverview, overview)}
      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
      {action(copy.annotation, MessageSquare, () => onTool("annotate"), tool === "annotate", overview || !state.previewEnabled && !state.enabled)}
      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
      {action(copy.undo, Undo2, () => { if (state.undoRevision) void controls.restore(state.undoRevision, "undo"); }, false, !controls.current || !state.undoRevision || controls.pending || controls.busy || Boolean(controls.canvasDraft?.draft))}
      {action(copy.redo, Redo2, () => { if (state.redoRevision) void controls.restore(state.redoRevision, "redo"); }, false, !controls.current || !state.redoRevision || controls.pending || controls.busy || Boolean(controls.canvasDraft?.draft))}
      <Popover open={menuOpen} onOpenChange={setMenuOpen}><PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={copy.more} title={copy.more} className="min-h-[44px] min-w-[44px] shrink-0"><MoreHorizontal className="size-4" /></Button></PopoverTrigger><PopoverContent align="end" className="w-64 p-1">
        {[[copy.history, History, "history"], [copy.export, Download, "export"], [copy.system, Palette, "system"], [copy.comments + ` (${commentCount})`, MessageSquare, "comments"], [copy.properties, MousePointer2, "properties"], [copy.settings, Settings2, "settings"]].map(([label, Icon, panel]) => {
          const Glyph = Icon as typeof Eye; return <Button key={String(panel)} type="button" variant="ghost" className="min-h-[44px] w-full justify-start" onClick={() => { setMenuOpen(false); onPanel(panel as Inspector); }}><Glyph className="size-4" />{String(label)}</Button>;
        })}
        <Button type="button" variant="ghost" className="min-h-[44px] w-full justify-start" onClick={() => { setMenuOpen(false); onRefresh(); }}><RefreshCw className="size-4" />{copy.refresh}</Button>
      </PopoverContent></Popover>
    </div>
  </header>;
}
