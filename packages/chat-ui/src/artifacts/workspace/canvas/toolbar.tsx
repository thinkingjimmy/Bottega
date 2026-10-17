/**
 * [INPUT]: Displayed immutable version, shared mutation controller and workspace navigation/review actions.
 * [OUTPUT]: WorkspaceHeader, inline WorkspaceActions and bottom WorkspaceHistory with original mutation guards.
 * [POS]: Shared workspace controls composed around CanvasEditor; input fields keep native text Undo.
 */
import { useState } from "react";
import { MousePointer2, MessageSquare, Undo2, Redo2, MoreHorizontal, History, Palette, Settings2, RefreshCw } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@ai-chat/ui/components/ui/popover";
import { useArtifactHost } from "../../context";
import { ArtifactHeader } from "../../presentation/header";
import { workspaceCopy } from "../copy";
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { DesignEditController } from "./edits";
export type Inspector = "properties" | "comments" | "system" | "history" | "export" | "settings";
export type CanvasTool = "preview" | "select" | "annotate";
export function WorkspaceHeader({ state, controls, onCurrent }: { state: WorkspaceRead; controls: DesignEditController; onCurrent(): void }) {
  const copy = workspaceCopy(useArtifactHost()!.locale);
  return <div className="z-20 shrink-0">
    <ArtifactHeader title={`${state.title} · v${state.revision}`} status={state.revision < state.latestRevision || state.editable === false ? copy.readonly : controls.pending ? copy.checking : controls.canvasDraft?.draft || state.dirty ? copy.dirty : copy.saved}>
      {state.revision < state.latestRevision && <Button type="button" variant="outline" className="min-h-[44px] shrink-0 px-2 text-xs" onClick={onCurrent}>{copy.current}</Button>}
    </ArtifactHeader>
  </div>;
}
export function WorkspaceActions({ state, tool, commentCount, onTool, onPanel, onRefresh }: {
  state: WorkspaceRead; tool: CanvasTool; commentCount: number;
  onTool(tool: CanvasTool): void; onPanel(panel: Inspector): void; onRefresh(): void;
}) {
  const copy = workspaceCopy(useArtifactHost()!.locale), [menuOpen, setMenuOpen] = useState(false);
  return <div data-workspace-toolbar="" className="ml-1 flex shrink-0 items-center border-l pl-1" role="group" aria-label={copy.tools}>
    <ToolbarButton label={copy.annotation} icon={MessageSquare} onClick={() => onTool("annotate")} active={tool === "annotate"} disabled={!state.previewEnabled && !state.enabled} />
    <Popover open={menuOpen} onOpenChange={setMenuOpen}><PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={copy.more} title={copy.more} className="min-h-[44px] min-w-[44px] shrink-0"><MoreHorizontal className="size-4" /></Button></PopoverTrigger><PopoverContent align="end" className="w-64 max-w-[calc(100vw-24px)] p-1" data-workspace-menu="" data-canvas-chrome="">
      {[[copy.history, History, "history"], [copy.system, Palette, "system"], [copy.comments + ` (${commentCount})`, MessageSquare, "comments"], [copy.properties, MousePointer2, "properties"], [copy.settings, Settings2, "settings"]].map(([label, Icon, panel]) => {
        const Glyph = Icon as typeof MessageSquare; return <Button key={String(panel)} type="button" variant="ghost" className="min-h-[44px] w-full justify-start" onClick={() => { setMenuOpen(false); onPanel(panel as Inspector); }}><Glyph className="size-4" />{String(label)}</Button>;
      })}
      <Button type="button" variant="ghost" className="min-h-[44px] w-full justify-start" onClick={() => { setMenuOpen(false); onRefresh(); }}><RefreshCw className="size-4" />{copy.refresh}</Button>
    </PopoverContent></Popover>
  </div>;
}
export function WorkspaceHistory({ state, controls }: { state: WorkspaceRead; controls: DesignEditController }) {
  const copy = workspaceCopy(useArtifactHost()!.locale);
  const blocked = !controls.current || controls.pending || controls.busy || Boolean(controls.canvasDraft?.draft);
  return <div data-workspace-history="" className="artifact-floating-toolbar flex shrink-0 items-center" role="toolbar" aria-label={copy.history}>
    <ToolbarButton label={copy.undo} icon={Undo2} disabled={blocked || !state.undoRevision} onClick={() => { if (state.undoRevision) void controls.restore(state.undoRevision, "undo"); }} />
    <ToolbarButton label={copy.redo} icon={Redo2} disabled={blocked || !state.redoRevision} onClick={() => { if (state.redoRevision) void controls.restore(state.redoRevision, "redo"); }} />
  </div>;
}
function ToolbarButton({ label, icon: Icon, onClick, active, disabled }: { label: string; icon: typeof MessageSquare; onClick(): void; active?: boolean; disabled?: boolean }) {
  return <Button type="button" variant={active ? "secondary" : "ghost"} size="icon" className="min-h-[44px] min-w-[44px] shrink-0" aria-label={label} title={label} aria-pressed={active || undefined} disabled={disabled} onClick={onClick}><Icon className="size-4" /></Button>;
}
