/**
 * [INPUT]: Fixed Artifact scope, actual owner chrome measurements, guarded navigation/checkpoints, trusted mounted-view lifetime and explicit UI text-input intent.
 * [OUTPUT]: Canvas workspace with measured inspector bounds, transient text ownership, editor-owned zoom/fit, scoped disable acknowledgement and retained drafts/settings.
 * [POS]: Shared design workbench; main owns source mutations, history, custody and authorization.
 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, MessageSquare, MousePointer2, Palette } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@ai-chat/ui/components/ui/dialog";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { checkpointSchema, type DesignReference, type DesignAnchor, type DesignCheckpoint } from "@ai-chat/cloud-protocol/artifacts/design/review";
import { useArtifactHost, useArtifactPresentation } from "../context";
import { DesignPreview, type FrameEditorSession } from "./preview";
import { CanvasObjectProperties } from "./canvas/editor/stage/panels/object-properties";
import { DesignProperties } from "./canvas/editor/stage/panels/properties";
import { DesignExports } from "./exports";
import { ArtifactDirectory } from "./directory";
import { workspaceCopy } from "./copy";
import { canvasPages } from "@ai-chat/cloud-protocol/artifacts/design/canvas/view";
import type { CanvasOperation } from "@ai-chat/cloud-protocol/artifacts/design/canvas/commands";
import { CanvasEditor, type BoardNavigationRequest } from "./canvas/editor/stage/editor";
import { useCanvasTarget } from "./canvas/editor/stage/state/target";
import { useDesignEdits, type CanvasEdit } from "./canvas/edits";
import { BoardNavigation, BoardOverview } from "./canvas/navigation";
import { ContextAnnotation, FeedbackNotes, type AnnotationDraft } from "./canvas/notes";
import { WorkspaceToolbar, type Inspector, type CanvasTool } from "./canvas/toolbar";
import "./canvas/workspace.css";
const DesignSystem = lazy(() => import("./system/view").then(module => ({ default: module.DesignSystemView })));
type Camera = NonNullable<DesignCheckpoint["view"]>["cameras"][string];
export function ArtifactWorkspaceView({ fence }: { fence: ArtifactFence }) {
  const host = useArtifactHost()!, presentation = useArtifactPresentation(), copy = workspaceCopy(host.locale), [artifactId, setArtifactId] = useState(fence.id), [state, setState] = useState<WorkspaceRead | null>(null), [loadedId, setLoadedId] = useState(fence.id);
  const [boardId, setBoardId] = useState(fence.design!.launchBoard), [comparison, setComparison] = useState(""), [mode, setMode] = useState<"focus" | "overview">("focus"), [cameras, setCameras] = useState<Record<string, Camera>>({});
  const [tool, setTool] = useState<CanvasTool>("preview"), [selecting, setSelecting] = useState(false), [selectionMode, setSelectionMode] = useState<"element" | "region">("element"), [anchor, setAnchor] = useState<DesignAnchor | null>(null);
  const [panel, setPanel] = useState<Inspector | null>(null), [boardsOpen, setBoardsOpen] = useState(false), [notes, setNotes] = useState<DesignCheckpoint["notes"]>([]), [annotation, setAnnotation] = useState<AnnotationDraft | undefined>(), [annotationOpen, setAnnotationOpen] = useState(false), [locate, setLocate] = useState<string | null>(null);
  const [canvasDraft, setCanvasDraft] = useState<DesignCheckpoint["canvas"]>(), [reselect, setReselect] = useState<string | null>(null);
  const [textSession, setTextSession] = useState<FrameEditorSession>({ id: 0, focus: false });
  const beginTextSession = useCallback((focus: boolean) => setTextSession(current => ({ id: current.id + 1, focus })), []);
  const [boardNavigation, setBoardNavigation] = useState<BoardNavigationRequest | null>(null);
  const onBoardNavigated = useCallback((request: BoardNavigationRequest) => setBoardNavigation(current => current === request ? null : current), []);
  const [editDraft, setEditDraft] = useState<DesignCheckpoint["edit"]>(), [systemDraft, setSystemDraft] = useState<DesignCheckpoint["system"]>(), [error, setError] = useState(false), [confirm, setConfirm] = useState<"draft" | "send" | null>(null), [transferring, setTransferring] = useState(false), [annotationBusy, setAnnotationBusy] = useState(false), [inputBlocked, setInputBlocked] = useState(false);
  const root = useRef<HTMLElement>(null), canvas = useRef<HTMLDivElement>(null), [area, setArea] = useState({ width: 390, height: 600 });
  const canvasEdit = useRef(canvasDraft), uncheckpointed = useRef({ canvas: false, properties: false }), commitIntent = useRef<{ operations?: CanvasOperation[]; previous: WorkspaceRead | null } | null>(null);
  const onUncheckpointed = useCallback((value: boolean) => { uncheckpointed.current.canvas = value; setInputBlocked(value || uncheckpointed.current.properties); }, []);
  const onPropertyUncheckpointed = useCallback((value: boolean) => { uncheckpointed.current.properties = value; setInputBlocked(value || uncheckpointed.current.canvas); }, []);
  const hasUncheckpointed = useCallback(() => uncheckpointed.current.canvas || uncheckpointed.current.properties, []);
  const canLeaveWorkspace = useCallback(() => { if (!hasUncheckpointed()) return true; setError(true); return false; }, [hasUncheckpointed]);
  const edit = useRef(editDraft), system = useRef(systemDraft), annotationRef = useRef(annotation), view = useRef<DesignCheckpoint["view"]>({ mode, cameras }), handoff = useRef<DesignCheckpoint["handoff"]>(undefined), retarget = useRef<string | null>(null);
  const latest = useRef({ state, notes, boardId, artifactId: loadedId }), flight = useRef(Promise.resolve<unknown>(undefined)), lifetime = useRef(Promise.resolve<unknown>(undefined));
  const documentId = fence.design!.documentId;
  useLayoutEffect(() => { latest.current = { state, notes, boardId, artifactId: loadedId }; }, [state, notes, boardId, loadedId]);
  const save = useCallback((values: DesignCheckpoint["notes"], target = latest.current) => {
    if (!target.state) return Promise.resolve();
    const checkpoint = checkpointSchema.parse({ documentId: target.state.documentId, revision: target.state.revision, boardId: target.boardId, notes: values,
      handoff: handoff.current, edit: edit.current, system: system.current, canvas: canvasEdit.current, annotation: annotationRef.current, view: view.current });
    const pending = flight.current.catch(() => {}).then(() => host.workspace!({ action: "checkpoint", artifactId: target.artifactId, generation: target.state!.generation, checkpoint }));
    flight.current = pending; return pending;
  }, [host]);
  const registerClose = presentation?.beforeClose;
  useEffect(() => registerClose?.(() => { if (hasUncheckpointed()) return Promise.reject(new Error("Finish the uncheckpointed input before closing")); return save(latest.current.notes); }), [registerClose, save, hasUncheckpointed]);
  const changeEdit = useCallback((value: NonNullable<DesignCheckpoint["edit"]>) => { edit.current = value; setEditDraft(value); return save(latest.current.notes); }, [save]);
  const changeCanvas = useCallback((value: CanvasEdit) => { canvasEdit.current = value; setCanvasDraft(value); return save(latest.current.notes); }, [save]);
  const sourceTarget = useCanvasTarget(artifactId, loadedId === artifactId ? state : null, anchor);
  const changeSystem = useCallback((value: NonNullable<DesignCheckpoint["system"]>) => { system.current = value; setSystemDraft(value); return save(latest.current.notes); }, [save]);
  const refresh = useCallback(() => lifetime.current.then(() => host.workspace!({ action: "read", artifactId: latest.current.artifactId })).then(value => setState(value as WorkspaceRead)), [host]);
  const controls = useDesignEdits({ state: loadedId === artifactId ? state : null, anchor, draft: editDraft, canvasDraft, onDraft: changeEdit, onCanvasDraft: changeCanvas, canCommit: () => !hasUncheckpointed(), onConflict: () => { setPanel("properties"); return refresh(); }, onCommitted: (id, operations) => { commitIntent.current = { operations, previous: latest.current.state }; setReselect(anchor?.selector ?? null); setArtifactId(id); setAnchor(null); } });
  useEffect(() => {
    let current = true;
    const viewId = crypto.randomUUID();
    const unsubscribe = host.workspaceEvents?.(async event => {
      if (event.type === "before-disable") {
        if (!host.desktop || event.scope !== viewId) return;
        try {
          if (hasUncheckpointed()) throw new Error("Finish the uncheckpointed input before disabling");
          await save(latest.current.notes);
          await host.workspace!({ action: "ack-disable", nonce: event.nonce, documentId, viewId });
        } catch { if (current) setError(true); }
      } else if (host.remoteReader) {
        setState(value => value ? { ...value, enabled: event.enabled ? value.enabled : false, previewEnabled: event.enabled ?? false } : value);
        if (event.enabled) void refresh().catch(() => setError(true));
      } else setState(value => value ? { ...value, enabled: event.enabled ?? false, previewEnabled: event.enabled, generation: event.generation } : value);
    });
    const acquired = host.desktop ? host.workspaceEvents
      ? host.workspace!({ action: "acquire-view", artifactId: fence.id, documentId, viewId })
      : Promise.reject(new Error("Artifact checkpoint events are unavailable")) : Promise.resolve();
    lifetime.current = acquired;
    void acquired.catch(() => { if (current) setError(true); });
    return () => {
      current = false; unsubscribe?.();
      if (host.desktop) void acquired.then(() => host.workspace!({ action: "release-view", documentId, viewId })).catch(() => {});
    };
  }, [host, fence.id, documentId, save, refresh, hasUncheckpointed]);
  useEffect(() => {
    let current = true;
    void lifetime.current.then(() => current ? host.workspace!({ action: "read", artifactId }) : undefined).then(value => {
      if (!current) return; const read = value as WorkspaceRead; setBoardNavigation(null); setError(false); setState(read); setLoadedId(artifactId);
      const checkpoint = read.checkpoint, selected = read.manifest.boards.find(board => board.id === (checkpoint?.revision === read.revision ? checkpoint.boardId : latest.current.boardId)) ?? read.manifest.boards[0]!;
      setBoardId(selected.id); setNotes(checkpoint?.notes ?? []); handoff.current = checkpoint?.handoff; edit.current = checkpoint?.edit; setEditDraft(checkpoint?.edit); system.current = checkpoint?.system; setSystemDraft(checkpoint?.system); annotationRef.current = checkpoint?.annotation; setAnnotation(checkpoint?.annotation);
      const pages = read.canvas?.pages ?? canvasPages(read.manifest), intent = commitIntent.current, previous = intent?.previous, operations = intent?.operations ?? [];
      let restoredCanvas: CanvasEdit = checkpoint?.canvas ?? { pageId: read.canvas?.boards.find(board => board.id === selected.id)?.pageId ?? pages[0]!.id, selection: [], tool: "select", preview: false };
      if (!pages.some(page => page.id === restoredCanvas.pageId)) { const index = previous?.canvas?.pages.findIndex(page => page.id === restoredCanvas.pageId) ?? 0; restoredCanvas = { ...restoredCanvas, pageId: pages[Math.max(0, index - 1)]?.id ?? pages[0]!.id, selection: [], camera: undefined }; }
      if (operations.some(operation => operation.type === "page.create" || operation.type === "page.duplicate")) { const created = pages.find(page => !previous?.canvas?.pages.some(before => before.id === page.id)); if (created) restoredCanvas = { ...restoredCanvas, pageId: created.id, selection: [], camera: undefined }; }
      if (operations.some(operation => operation.type === "board.create" || operation.type === "board.duplicate")) { const created = read.canvas?.boards.find(board => !previous?.manifest.boards.some(before => before.id === board.id)); if (created) { setBoardId(created.id); restoredCanvas = { ...restoredCanvas, pageId: created.pageId, selection: [created.id], camera: undefined }; } }
      if (operations.some(operation => operation.type === "object.create" || operation.type === "object.duplicate")) { const created = read.canvas?.objects.filter(object => !previous?.canvas?.objects.some(before => before.id === object.id)); if (created?.length) restoredCanvas = { ...restoredCanvas, pageId: created[0]!.pageId, selection: created.map(object => object.id).slice(-32) }; }
      restoredCanvas = { ...restoredCanvas, selection: restoredCanvas.selection.filter(id => read.manifest.boards.some(board => board.id === id) || read.manifest.objects?.some(object => object.id === id)) };
      canvasEdit.current = restoredCanvas; setCanvasDraft(restoredCanvas); commitIntent.current = null;
      if (!intent && checkpoint?.edit?.anchor) setReselect(checkpoint.edit.anchor.selector);
      const restored = checkpoint?.view ?? { mode: "focus" as const, cameras: {} }; view.current = restored; setMode(restored.mode); setCameras(restored.cameras);
      if (checkpoint?.edit?.sourceConflict || checkpoint?.edit?.request || checkpoint?.canvas?.sourceConflict || checkpoint?.canvas?.request) setPanel("properties");
    }).catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [host, artifactId]);
  useLayoutEffect(() => {
    const node = canvas.current, body = node?.parentElement; if (!node || !body) return; let current = true;
    const chrome = [...node.querySelectorAll<HTMLElement>("[data-workspace-canvas-header], [data-canvas-toolbar]")];
    const observer = new ResizeObserver(entries => {
      if (!current) return;
      const entry = entries.find(entry => entry.target === node);
      if (entry) setArea({ width: entry.contentRect.width, height: entry.contentRect.height });
      const bounds = body.getBoundingClientRect(), bottom = Math.max(node.getBoundingClientRect().top, ...chrome.map(element => element.getBoundingClientRect().bottom));
      const top = Math.min(bounds.height, Math.max(0, bottom - bounds.top));
      body.style.setProperty("--artifact-inspector-top", `${top}px`);
      body.style.setProperty("--artifact-inspector-space", `${Math.max(0, bounds.height - top)}px`);
    });
    observer.observe(node); observer.observe(body); for (const element of chrome) observer.observe(element);
    return () => { current = false; observer.disconnect(); };
  }, [state, loadedId, artifactId, mode, comparison, boardsOpen]);
  const update = (values: DesignCheckpoint["notes"]) => { latest.current.notes = values; setNotes(values); handoff.current = undefined; void save(values).catch(() => setError(true)); };
  const changeAnnotation = (value: AnnotationDraft | undefined) => { annotationRef.current = value; setAnnotation(value); void save(latest.current.notes).catch(() => setError(true)); };
  const storeView = (nextMode = mode, nextCameras = cameras) => { view.current = { mode: nextMode, cameras: nextCameras }; setMode(nextMode); setCameras(nextCameras); void save(latest.current.notes).catch(() => setError(true)); };
  const chooseBoard = (id: string) => { if (!canLeaveWorkspace()) return false; setBoardNavigation(null); latest.current.boardId = id; setBoardId(id); setReselect(null); setMode("focus"); setAnchor(null); setSelecting(false); setAnnotationOpen(false); storeView("focus"); if (area.width < 900) setBoardsOpen(false); return true; };
  const requestBoard = (id: string) => { if (!chooseBoard(id)) return; setBoardNavigation({ artifactId: latest.current.artifactId, boardId: id, scope: host.scope }); };
  const showOverview = () => { if (!canLeaveWorkspace()) return; setBoardNavigation(null); storeView("overview"); setPanel(null); setAnnotationOpen(false); setSelecting(false); };
  const openVersion = (id: string) => { if (!canLeaveWorkspace()) return; void save(notes).then(() => { setArtifactId(id); setAnchor(null); }).catch(() => setError(true)); };
  const onTool = (next: CanvasTool) => { if (hasUncheckpointed()) { setError(true); return; }
    setMode("focus"); storeView("focus"); setTool(next); setAnnotationOpen(false);
    if (next === "preview") { setSelecting(false); setPanel(null); return; }
    if (next === "annotate" && annotationRef.current) { requestBoard(annotationRef.current.anchor.boardId); setAnnotationOpen(true); setSelecting(false); setPanel(null); return; }
    setSelecting(true); if (next === "annotate") setPanel(null);
  };
  const selected = (value: DesignAnchor) => {
    setAnchor(value); setReselect(null); setSelecting(tool !== "annotate");
    if (retarget.current) { const id = retarget.current; retarget.current = null; update(notes.map(note => note.id === id ? { ...note, anchor: value } : note)); setPanel("comments"); return; }
    if (tool === "annotate") { changeAnnotation({ id: crypto.randomUUID(), text: "", anchor: value }); setAnnotationOpen(true); setPanel(null); }

  };
  const locateNote = (id: string) => { const note = notes.find(note => note.id === id); if (!note?.anchor) return; requestBoard(note.anchor.boardId); setLocate(null); requestAnimationFrame(() => setLocate(id)); setPanel("comments"); };
  const focusTrigger = (label: string) => requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(`button[aria-label="${CSS.escape(label)}"]`)?.focus());
  if (!state || loadedId !== artifactId) return <div className="grid min-h-0 flex-1 place-content-center gap-3 p-6"><p role={error ? "alert" : "status"}>{error ? copy.failed : copy.loading}</p>{error && <Button onClick={() => void refresh().catch(() => setError(true))}>{copy.retry}</Button>}</div>;
  const board = state.manifest.boards.find(board => board.id === boardId) ?? state.manifest.boards[0]!, cameraKey = `${state.revision}:${board.id}`, camera = cameras[cameraKey] ?? { width: board.viewport.width, zoom: 1, fit: board.mode === "fixed" ? "board" as const : "width" as const };
  const width = camera.width, height = board.viewport.height;
  const zoom = camera.fit === "manual" ? camera.zoom : Math.max(.05, Math.min(1, (area.width - 32) / width, camera.fit === "board" ? (area.height - 72) / height : 3));
  const changeCamera = (next: Camera) => { const entries = Object.entries(cameras).filter(([key]) => key !== cameraKey).slice(-31); storeView(mode, Object.fromEntries([...entries, [cameraKey, next]])); };
  const counts = Object.fromEntries(state.manifest.boards.map(board => [board.id, notes.filter(note => note.anchor?.boardId === board.id).length])), titles = Object.fromEntries(state.manifest.boards.map(board => [board.id, board.title]));
  const compareBoard = comparison.startsWith("board:") ? state.manifest.boards.find(board => board.id === comparison.slice(6)) : board, compareVersion = comparison.startsWith("version:") ? state.versions.find(value => value.revision === Number(comparison.slice(8))) : null;
  const modelSelection = canvasDraft?.selection[0], selectedObject = state.canvas?.objects.find(object => object.id === modelSelection), selectedBoard = state.canvas?.boards.find(board => board.id === modelSelection);
  const displayPanel = panel;
  const panelTitle = displayPanel === "system" ? copy.system : displayPanel === "history" ? copy.history : displayPanel === "export" ? copy.export : displayPanel === "settings" ? copy.settings : displayPanel === "comments" ? copy.comments : copy.properties;
  const commitAnnotation = async () => { if (!annotationRef.current) return; const draft = annotationRef.current; setAnnotationBusy(true); setError(false);
    const values = [...notes.filter(note => note.id !== (draft.noteId ?? draft.id)), { id: draft.noteId ?? draft.id, text: draft.text, anchor: draft.anchor }];
    try { annotationRef.current = undefined; await save(values); latest.current.notes = values; setNotes(values); setAnnotation(undefined); setAnnotationOpen(false); setPanel("comments"); }
    catch { annotationRef.current = draft; setError(true); } finally { setAnnotationBusy(false); }
  };
  return <section ref={root} data-artifact-workspace={state.documentId} data-workspace-view={mode} aria-label={state.title} className="artifact-workspace" onKeyDown={event => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (annotationOpen) { event.preventDefault(); event.stopPropagation(); setAnnotationOpen(false); focusTrigger(copy.annotation); }
    else if (displayPanel) { event.preventDefault(); event.stopPropagation(); setPanel(null); focusTrigger(copy.more); }
    else if (boardsOpen) { event.preventDefault(); setBoardsOpen(false); focusTrigger(copy.boards); }
    else if (selecting) { event.preventDefault(); setSelecting(false); setTool("preview"); retarget.current = null; focusTrigger(copy.select); }
    else if (presentation?.full && presentation.canExpand) { presentation.setFull(false); focusTrigger(copy.full); }
  }}>
    <WorkspaceToolbar state={state} tool={tool} selecting={selecting} overview={mode === "overview"} controls={controls} commentCount={notes.length} onTool={onTool} onBoards={() => setBoardsOpen(value => !value)} onOverview={showOverview} onPanel={setPanel} onRefresh={() => { if (canLeaveWorkspace()) void refresh().catch(() => setError(true)); }} onCurrent={() => { const latest = state.versions.find(value => value.revision === state.latestRevision); if (latest) openVersion(latest.artifactId); }} />
    <div className="artifact-workspace-body">
      {boardsOpen && <div className="artifact-board-rail"><BoardNavigation artifactId={artifactId} manifest={state.manifest} boardId={boardId} overview={mode === "overview"} counts={counts} choose={requestBoard} showOverview={showOverview} close={() => setBoardsOpen(false)} /></div>}
      <div ref={canvas} data-workspace-canvas="" className="artifact-canvas">
        <div data-workspace-canvas-header="" className="flex min-h-[36px] shrink-0 items-center gap-2 border-b border-border/50 px-3 text-xs text-muted-foreground"><span className="min-w-0 flex-1 truncate">{mode === "overview" ? `${copy.overview} · ${state.manifest.boards.length}` : `${board.title} · ${width} × ${height}`}</span>{controls.edit.sourceConflict && <Button variant="ghost" className="min-h-[44px] text-xs" onClick={() => setPanel("properties")}>{copy.properties}</Button>}</div>
        {mode === "overview" ? <BoardOverview artifactId={artifactId} manifest={state.manifest} counts={counts} choose={requestBoard} /> : <div className={comparison ? "artifact-canvas-pair" : "flex min-h-0 flex-1 flex-col"}>
          <CanvasEditor artifactId={artifactId} state={state} checkpoint={canvasDraft ?? { pageId: canvasPages(state.manifest)[0]!.id, selection: [], tool: "select", preview: false }} controls={controls} boardId={board.id} anchor={anchor} source={sourceTarget} textSession={textSession} onTextSession={beginTextSession} forceTool={tool === "annotate" ? "annotate" : null} selecting={selecting} selectionMode={selectionMode} propertiesOpen={displayPanel === "properties"} viewportWidth={width} reselect={reselect} notes={notes} locate={locate} onAnchor={selected} onBoard={chooseBoard} boardNavigation={boardNavigation} onBoardNavigation={requestBoard} onBoardNavigated={onBoardNavigated} onPin={locateNote} onTool={() => onTool("select")} onProperties={() => setPanel(value => value === "properties" ? null : "properties")} onUncheckpointed={onUncheckpointed} hasUncheckpointed={hasUncheckpointed} inputBlocked={inputBlocked} onClearSource={() => { setAnchor(null); setReselect(null); }} onEscape={() => { setSelecting(false); setTool("preview"); retarget.current = null; focusTrigger(copy.select); }} annotation={(id, width, height, zoom, geometry) => annotationOpen && annotation && annotation.anchor.boardId === id ? <ContextAnnotation draft={annotation} boardTitle={titles[id] ?? id} width={width} height={height} zoom={zoom} bounds={geometry?.selected} busy={annotationBusy} change={text => changeAnnotation({ ...annotation, text })} save={() => void commitAnnotation()} close={() => { setAnnotationOpen(false); focusTrigger(copy.annotation); }} /> : null} />
          {comparison && compareBoard && <div className="flex min-h-0 flex-col border-l"><p className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">{compareBoard.title} · v{compareVersion?.revision ?? state.revision}</p><DesignPreview artifactId={compareVersion?.artifactId ?? artifactId} boardId={compareBoard.id} title={`${compareBoard.title} · v${compareVersion?.revision ?? state.revision}`} generation={state.generation} width={width} height={compareBoard.viewport.height} zoom={Math.min(zoom, (area.width / 2 - 32) / width)} enabled={state.previewEnabled ?? state.enabled} selecting={false} /></div>}
        </div>}
      </div>
      <aside data-workspace-inspector={displayPanel ?? "none"} className="artifact-inspector" hidden={!displayPanel} aria-label={panelTitle}>
        <header className="flex min-h-[44px] shrink-0 items-center gap-1 border-b px-3"><h3 className="min-w-0 flex-1 text-sm font-medium">{panelTitle}</h3><Button type="button" variant="ghost" size="icon" aria-label={copy.closePanel} className="min-h-[44px] min-w-[44px]" onClick={() => { setPanel(null); focusTrigger(copy.more); }}><X className="size-4" /></Button></header>
        <div className="flex shrink-0 gap-1 border-b px-2"><Button type="button" variant="ghost" size="icon" aria-label={copy.properties} className="min-h-[44px] min-w-[44px]" onClick={() => setPanel("properties")}><MousePointer2 className="size-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label={copy.comments} className="min-h-[44px] min-w-[44px]" onClick={() => setPanel("comments")}><MessageSquare className="size-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label={copy.system} className="min-h-[44px] min-w-[44px]" onClick={() => setPanel("system")}><Palette className="size-4" /></Button></div>
        <div hidden={displayPanel !== "properties"} className="min-h-0 flex-1 overflow-auto">{selectedObject || selectedBoard ? <CanvasObjectProperties key={modelSelection} artifactId={artifactId} controls={controls} object={selectedObject} board={selectedBoard} onUncheckpointed={onPropertyUncheckpointed} /> : <DesignProperties artifactId={artifactId} state={state} controls={controls} selected={Boolean(anchor)} boardId={board.id} target={sourceTarget.target} fonts={state.canvas?.fonts} onTextInput={() => beginTextSession(false)} />}</div>
        {displayPanel === "comments" && <FeedbackNotes notes={notes} titles={titles} update={update} locate={locateNote} retarget={id => { const note = notes.find(note => note.id === id); if (note?.anchor) requestBoard(note.anchor.boardId); retarget.current = id; setTool("annotate"); setSelecting(true); setPanel(null); }} handoff={setConfirm} enabled={state.enabled} busy={transferring} />}
        {displayPanel === "system" && <div className="min-h-0 flex-1 overflow-auto p-3"><Suspense fallback={<p>{copy.loading}</p>}><fieldset disabled={inputBlocked}><DesignSystem artifactId={artifactId} state={state} draft={systemDraft} onDraft={changeSystem} onConflict={refresh} onCommitted={id => { setArtifactId(id); setAnchor(null); }} /></fieldset></Suspense></div>}
        {displayPanel === "export" && <div className="space-y-4 p-4"><p className="text-xs text-muted-foreground">{state.title} · v{state.revision} · {board.title}</p><DesignExports artifactId={artifactId} state={state} boardId={board.id} pageId={canvasDraft?.pageId} /></div>}
        {displayPanel === "history" && <div className="space-y-4 overflow-auto p-4"><label className="flex flex-col gap-2 text-sm">{copy.version}<select aria-label={copy.version} value={state.revision} className="min-h-[44px] rounded-md border bg-background" onChange={event => { const version = state.versions.find(value => value.revision === Number(event.target.value)); if (version) openVersion(version.artifactId); }}>{state.versions.map(version => <option key={version.revision} value={version.revision}>v{version.revision}</option>)}</select></label><label className="flex flex-col gap-2 text-sm">{copy.compare}<select aria-label={copy.compare} value={comparison} className="min-h-[44px] rounded-md border bg-background" onChange={event => setComparison(event.target.value)}><option value="">{copy.none}</option>{state.manifest.boards.filter(value => value.id !== board.id).map(value => <option key={value.id} value={`board:${value.id}`}>{value.title} · v{state.revision}</option>)}{state.versions.filter(value => value.revision !== state.revision).map(value => <option key={value.revision} value={`version:${value.revision}`}>{board.title} · v{value.revision}</option>)}</select></label>{state.revision !== state.latestRevision && <Button disabled={!state.enabled || state.dirty} className="min-h-[44px]" onClick={() => void controls.restore(state.revision)}>{copy.restore}</Button>}</div>}
        {displayPanel === "settings" && <div className="space-y-4 overflow-auto p-4"><label className="flex flex-col gap-2 text-sm">{copy.responseWidth}<input aria-label={copy.width} type="number" min={40} max={8000} value={width} className="min-h-[44px] rounded-md border bg-background px-3" onChange={event => { const width = Number(event.target.value); if (width >= 40 && width <= 8000) changeCamera({ ...camera, width }); }} /></label><label className="flex flex-col gap-2 text-sm">{copy.select}<select aria-label={copy.select} value={selectionMode} className="min-h-[44px] rounded-md border bg-background" onChange={event => setSelectionMode(event.target.value as "element" | "region")}><option value="element">{copy.element}</option><option value="region">{copy.region}</option></select></label><Button className="min-h-[44px]" variant="outline" onClick={() => changeCamera({ ...camera, zoom: 1, fit: "manual" })}>{copy.actualSize}</Button></div>}
      </aside>
    </div>
    <footer className="flex min-h-[36px] shrink-0 items-center gap-2 border-t bg-background px-3 text-xs text-muted-foreground"><ArtifactDirectory fence={state.fence ?? fence} /><span className="flex-1" />{notes.length > 0 && <Button type="button" variant="ghost" className="min-h-[44px] text-xs" onClick={() => setPanel("comments")}>{notes.length} {copy.commentCount}</Button>}{annotation && !annotationOpen && <Button type="button" variant="ghost" className="min-h-[44px] text-xs" onClick={() => { requestBoard(annotation.anchor.boardId); setAnnotationOpen(true); }}>{copy.annotation}</Button>}</footer>
    {error && !confirm && <div role="alert" className="flex shrink-0 items-center gap-2 border-t bg-destructive/5 px-3 py-2 text-xs"><p className="flex-1">{copy.failed}</p><Button variant="ghost" className="min-h-[44px]" onClick={() => void save(notes).then(() => setError(false)).catch(() => {})}>{copy.retry}</Button></div>}
    <Dialog open={Boolean(confirm)} onOpenChange={open => { if (!open && !transferring) setConfirm(null); }}><DialogContent><DialogTitle>{confirm === "send" ? copy.confirmSend : copy.confirmDraft}</DialogTitle><DialogDescription>{state.title} · v{state.revision} · {notes.length} {copy.commentCount}</DialogDescription>{confirm && error && <p role="alert">{copy.failed}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={transferring} className="min-h-[44px]" onClick={() => setConfirm(null)}>{copy.cancel}</Button><Button disabled={transferring} className="min-h-[44px]" onClick={() => {
      const action = confirm!; handoff.current ??= { id: crypto.randomUUID(), createdAt: Date.now(), action, status: "pending" }; setTransferring(true); setError(false);
      const checkpoint = { documentId: state.documentId, revision: state.revision, boardId: board.id, notes, handoff: handoff.current, edit: edit.current, system: system.current, canvas: canvasEdit.current, view: view.current, annotation: annotationRef.current };
      void save(notes).then(() => host.workspace!({ action: "review", artifactId, generation: state.generation, checkpoint })).then(async raw => { const review = raw as { prompt: string; title: string; design: DesignReference };
        if (action === "send") await host.sendReview!({ ...review, requestId: handoff.current!.id, createdAt: handoff.current!.createdAt }); else await host.followUp!(review);
        handoff.current = { ...handoff.current!, status: "transferred" }; await save([]); latest.current.notes = []; setNotes([]); setConfirm(null);
      }).catch(() => setError(true)).finally(() => setTransferring(false));
    }}>{copy.confirm}</Button></div></DialogContent></Dialog>
  </section>;
}
