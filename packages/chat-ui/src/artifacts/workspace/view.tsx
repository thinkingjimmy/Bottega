/**
 * [INPUT]: Fixed Artifact scope, actual owner chrome measurements, guarded navigation/checkpoints, trusted mounted-view lifetime, failed-save barriers, local input/navigation epochs, exact-revision same-page live-camera handoff and explicit UI text-input intent; catalog-owned labels use the shared formatCopy formatter.
 * [OUTPUT]: Canvas workspace with title-owned navigation, full-body Canvas behind floating history, measured inspector clearance, target comments confirmed into the original Chat draft and original-owner input/checkpoint guards and camera continuity for same-page object creation/duplication.
 * [POS]: Shared design workbench; main owns source mutations, history, custody and authorization.
 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, MessageSquare, MousePointer2, Palette } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { formatCopy } from "@ai-chat/ui/lib/workbench-copy/format";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@ai-chat/ui/components/ui/dialog";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { checkpointSchema, type DesignReference, type DesignAnchor, type DesignCheckpoint } from "@ai-chat/cloud-protocol/artifacts/design/review";
import { useArtifactHost, useArtifactPresentation } from "../context";
import { ArtifactHeader } from "../presentation/header";
import { DesignPreview, type FrameEditorSession } from "./preview";
import { CanvasObjectProperties } from "./canvas/editor/stage/panels/object-properties";
import { DesignProperties } from "./canvas/editor/stage/panels/properties";
import { DesignExports } from "./exports";
import { workspaceCopy } from "./copy";
import { canvasPages } from "@ai-chat/cloud-protocol/artifacts/design/canvas/view";
import type { CanvasOperation } from "@ai-chat/cloud-protocol/artifacts/design/canvas/commands";
import { cameraTrace } from "./canvas/editor/stage/state/diagnostics";
import { CanvasEditor, type BoardNavigationRequest } from "./canvas/editor/stage/editor";
import { useCanvasTarget } from "./canvas/editor/stage/state/target";
import { useDesignEdits, type CanvasEdit } from "./canvas/edits";
import { ContextAnnotation, FeedbackNotes, type AnnotationDraft } from "./canvas/notes";
import { WorkspaceHeader, WorkspaceActions, WorkspaceHistory, type Inspector, type CanvasTool } from "./canvas/toolbar";
import "./canvas/workspace.css";
const DesignSystem = lazy(() => import("./system/view").then(module => ({ default: module.DesignSystemView })));
import type { CanvasCameraPort } from "./canvas/editor/motion/controller";
type Camera = NonNullable<DesignCheckpoint["view"]>["cameras"][string];
export function ArtifactWorkspaceView({ fence }: { fence: ArtifactFence }) {
  const host = useArtifactHost()!, presentation = useArtifactPresentation(), copy = workspaceCopy(host.locale), [artifactId, setArtifactId] = useState(fence.id), [state, setState] = useState<WorkspaceRead | null>(null), [loadedId, setLoadedId] = useState(fence.id);
  const [boardId, setBoardId] = useState(fence.design!.launchBoard), [comparison, setComparison] = useState(""), [cameras, setCameras] = useState<Record<string, Camera>>({});
  const [tool, setTool] = useState<CanvasTool>("preview"), [selecting, setSelecting] = useState(false), [selectionMode, setSelectionMode] = useState<"element" | "region">("element"), [anchor, setAnchor] = useState<DesignAnchor | null>(null);
  const [panel, setPanel] = useState<Inspector | null>(null), [notes, setNotes] = useState<DesignCheckpoint["notes"]>([]), [annotation, setAnnotation] = useState<AnnotationDraft | undefined>(), [annotationOpen, setAnnotationOpen] = useState(false), [locate, setLocate] = useState<string | null>(null);
  const [canvasDraft, setCanvasDraft] = useState<DesignCheckpoint["canvas"]>(), [reselect, setReselect] = useState<string | null>(null);
  const [textSession, setTextSession] = useState<FrameEditorSession>({ id: 0, focus: false });
  const beginTextSession = useCallback((focus: boolean) => setTextSession(current => ({ id: current.id + 1, focus })), []);
  const [boardNavigation, setBoardNavigation] = useState<BoardNavigationRequest | null>(null);
  const onBoardNavigated = useCallback((request: BoardNavigationRequest) => setBoardNavigation(current => current === request ? null : current), []);
  const [editDraft, setEditDraft] = useState<DesignCheckpoint["edit"]>(), [systemDraft, setSystemDraft] = useState<DesignCheckpoint["system"]>(), [error, setError] = useState(false), [confirm, setConfirm] = useState<"draft" | "send" | null>(null), [transferring, setTransferring] = useState(false), [annotationBusy, setAnnotationBusy] = useState(false), [inputBlocked, setInputBlocked] = useState(false);
  const root = useRef<HTMLElement>(null), canvas = useRef<HTMLDivElement>(null), [area, setArea] = useState({ width: 390, height: 600 });
  const inputEpoch = useRef(0), navigationEpoch = useRef(0), historyEpoch = useRef(0), cameraPort = useRef<CanvasCameraPort | null>(null);
  const registerCamera = useCallback((port: CanvasCameraPort) => { cameraPort.current = port; return () => { if (cameraPort.current === port) cameraPort.current = null; }; }, []);
  const canvasEdit = useRef(canvasDraft), annotationFlight = useRef(false), uncheckpointed = useRef({ canvas: false, properties: false }), commitIntent = useRef<{ artifactId: string; operations?: CanvasOperation[]; previous: WorkspaceRead; source: { state: WorkspaceRead | null; notes: DesignCheckpoint["notes"]; boardId: string; artifactId: string }; scope: string; navigation: number; pageId?: string; camera?: CanvasEdit["camera"]; navigationCanvas?: Pick<CanvasEdit, "pageId" | "selection" | "tool" | "preview"> } | null>(null);
  const onUncheckpointed = useCallback((value: boolean) => { if (value) inputEpoch.current++; uncheckpointed.current.canvas = value; setInputBlocked(value || uncheckpointed.current.properties); }, []);
  const onPropertyUncheckpointed = useCallback((value: boolean) => { if (value) inputEpoch.current++; uncheckpointed.current.properties = value; setInputBlocked(value || uncheckpointed.current.canvas); }, []);
  const hasUncheckpointed = useCallback(() => annotationFlight.current || uncheckpointed.current.canvas || uncheckpointed.current.properties, []);
  const canLeaveWorkspace = useCallback(() => { if (!hasUncheckpointed()) return true; setError(true); return false; }, [hasUncheckpointed]);
  const edit = useRef(editDraft), system = useRef(systemDraft), annotationRef = useRef(annotation), view = useRef<DesignCheckpoint["view"]>({ mode: "focus", cameras }), handoff = useRef<DesignCheckpoint["handoff"]>(undefined), retarget = useRef<string | null>(null);
  const draftOwner = useRef({ viewId: crypto.randomUUID(), sequence: 0, version: 0 });
  const latest = useRef({ state, notes, boardId, artifactId: loadedId }), flight = useRef(Promise.resolve<unknown>(undefined)), lifetime = useRef(Promise.resolve<unknown>(undefined));
  const documentId = fence.design!.documentId;
  const systemSelection = useRef<{ artifactId: string; documentId: string; token: string; theme: string } | null>(null);
  useLayoutEffect(() => { latest.current = { state, notes, boardId, artifactId: loadedId }; }, [state, notes, boardId, loadedId]);
  const captureCamera = useCallback((target: typeof latest.current, scope: string, pageId = canvasEdit.current?.pageId) => {
    const owner = cameraPort.current, live = owner?.read();
    const expected = target.state && `${scope}:${target.artifactId}:${target.state.generation}:${target.state.documentId}:${target.state.revision}:${pageId}`;
    if (!live || live.scope !== expected || live.pageId !== pageId) return;
    owner!.flush();
    const final = owner!.read();
    if (final.scope !== expected || final.pageId !== pageId) return;
    cameraTrace("camera-captured", { scope: expected, pageId, camera: final.camera });
    return final.camera;
  }, []);
  const save = useCallback((values: DesignCheckpoint["notes"], target = latest.current) => {
    inputEpoch.current++;
    if (!target.state) return Promise.resolve();
    const camera = captureCamera(target, host.scope);
    if (camera && canvasEdit.current && canvasEdit.current.camera !== camera) {
      canvasEdit.current = { ...canvasEdit.current, camera }; setCanvasDraft(canvasEdit.current);
    }
    const checkpoint = checkpointSchema.parse({ documentId: target.state.documentId, revision: target.state.revision, boardId: target.boardId, notes: values,
      handoff: handoff.current, edit: edit.current, system: system.current, canvas: canvasEdit.current, annotation: annotationRef.current, view: view.current });
    cameraTrace("checkpoint-queued", { camera: checkpoint.canvas?.camera, revision: checkpoint.revision });
    const pending = flight.current.catch(() => {}).then(async () => {
      const owner = draftOwner.current;
      const saved = await host.workspace!({ action: "checkpoint", artifactId: target.artifactId, generation: target.state!.generation,
        checkpoint: { ...checkpoint, save: { viewId: owner.viewId, sequence: ++owner.sequence, version: owner.version } } }) as { checkpointVersion?: number };
      cameraTrace("checkpoint-confirmed", { camera: checkpoint.canvas?.camera, sequence: owner.sequence, version: saved.checkpointVersion });
      owner.version = saved.checkpointVersion ?? owner.version + 1;
      return saved;
    });
    flight.current = pending; return pending;
  }, [host, captureCamera]);
  const prepareReview = useCallback((checkpoint: DesignCheckpoint, target = latest.current) => {
    const pending = flight.current.then(async () => {
      if (!target.state) throw new Error("Workspace is not loaded");
      const owner = draftOwner.current;
      const review = await host.workspace!({ action: "review", artifactId: target.artifactId, generation: target.state.generation,
        checkpoint: { ...checkpoint, save: { viewId: owner.viewId, sequence: ++owner.sequence, version: owner.version } } }) as { prompt: string; title: string; design: DesignReference; checkpoint: DesignCheckpoint };
      const receipt = review.checkpoint?.save;
      if (!receipt || receipt.viewId !== owner.viewId || receipt.sequence !== owner.sequence || receipt.version !== owner.version + 1) throw new Error("Review checkpoint acknowledgement changed");
      owner.version = receipt.version;
      return review;
    });
    flight.current = pending;
    return pending;
  }, [host]);
  const registerClose = presentation?.beforeClose;
  useEffect(() => registerClose?.(() => { if (hasUncheckpointed()) return Promise.reject(new Error("Finish the uncheckpointed input before closing")); return save(latest.current.notes); }), [registerClose, save, hasUncheckpointed]);
  const changeEdit = useCallback((value: NonNullable<DesignCheckpoint["edit"]>) => { edit.current = value; setEditDraft(value); return save(latest.current.notes); }, [save]);
  const changeCanvas = useCallback((value: CanvasEdit) => { if (canvasEdit.current && value.pageId !== canvasEdit.current.pageId) { navigationEpoch.current++; commitIntent.current = null; } canvasEdit.current = value; setCanvasDraft(value); return save(latest.current.notes); }, [save]);
  const sourceTarget = useCanvasTarget(artifactId, loadedId === artifactId ? state : null, anchor);
  const changeSystem = useCallback((value: NonNullable<DesignCheckpoint["system"]>) => { system.current = value; setSystemDraft(value); return save(latest.current.notes); }, [save]);
  const loadEpoch = useRef(0), loadTarget = useRef({ host, artifactId });
  useLayoutEffect(() => { loadTarget.current = { host, artifactId }; loadEpoch.current++; }, [host, artifactId]);
  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current, target = loadTarget.current, readInputEpoch = inputEpoch.current;
    await lifetime.current;
    await flight.current;
    let read: WorkspaceRead;
    try { read = await target.host.workspace!({ action: "read", artifactId: target.artifactId }) as WorkspaceRead; }
    catch (cause) { if (readInputEpoch === inputEpoch.current && epoch === loadEpoch.current && target.host === loadTarget.current.host && target.artifactId === loadTarget.current.artifactId) throw cause; return; }
    if (readInputEpoch !== inputEpoch.current || epoch !== loadEpoch.current || target.host !== loadTarget.current.host || target.artifactId !== loadTarget.current.artifactId) return;
    const selectedSystem = systemSelection.current;
    const migratedSystem = selectedSystem?.artifactId === target.artifactId && selectedSystem.documentId === read.documentId
      ? (await import("./system/model")).committedSystemSelection(read.system, selectedSystem) : undefined;
    if (readInputEpoch !== inputEpoch.current || epoch !== loadEpoch.current || target.host !== loadTarget.current.host || target.artifactId !== loadTarget.current.artifactId) return;
    systemSelection.current = null;
    setBoardNavigation(null); setError(false); setState(read); setLoadedId(target.artifactId);
      const checkpoint = read.checkpoint?.revision === read.revision ? read.checkpoint : null;
      const pendingIntent = commitIntent.current;
      const intent = pendingIntent?.artifactId === target.artifactId && pendingIntent.scope === target.host.scope && pendingIntent.previous.documentId === read.documentId && pendingIntent.previous.generation === read.generation && pendingIntent.previous.revision < read.revision && pendingIntent.navigation === navigationEpoch.current ? pendingIntent : null;
      const restoredSystem = checkpoint?.system ?? migratedSystem;
      draftOwner.current.version = checkpoint?.save?.version ?? 0;
      const selected = read.manifest.boards.find(board => board.id === (intent?.navigationCanvas ? intent.source.boardId : checkpoint?.revision === read.revision ? checkpoint.boardId : latest.current.boardId)) ?? read.manifest.boards[0]!;
      setBoardId(selected.id); setNotes(checkpoint?.notes ?? []); handoff.current = checkpoint?.handoff; edit.current = checkpoint?.edit; setEditDraft(checkpoint?.edit); system.current = restoredSystem; setSystemDraft(restoredSystem); annotationRef.current = checkpoint?.annotation; setAnnotation(checkpoint?.annotation);
      const pages = read.canvas?.pages ?? canvasPages(read.manifest), previous = intent?.previous, operations = intent?.operations ?? [];
      let restoredCanvas: CanvasEdit = checkpoint?.canvas ?? { pageId: read.canvas?.boards.find(board => board.id === selected.id)?.pageId ?? pages[0]!.id, selection: [], tool: "select", preview: false };
      if (!pages.some(page => page.id === restoredCanvas.pageId)) { const index = previous?.canvas?.pages.findIndex(page => page.id === restoredCanvas.pageId) ?? 0; restoredCanvas = { ...restoredCanvas, pageId: pages[Math.max(0, index - 1)]?.id ?? pages[0]!.id, selection: [], camera: undefined }; }
      if (operations.some(operation => operation.type === "page.create" || operation.type === "page.duplicate")) { const created = pages.find(page => !previous?.canvas?.pages.some(before => before.id === page.id)); if (created) restoredCanvas = { ...restoredCanvas, pageId: created.id, selection: [], camera: undefined }; }
      if (operations.some(operation => operation.type === "board.create" || operation.type === "board.duplicate")) { const created = read.canvas?.boards.find(board => !previous?.manifest.boards.some(before => before.id === board.id)); if (created) { setBoardId(created.id); restoredCanvas = { ...restoredCanvas, pageId: created.pageId, selection: [created.id], camera: undefined }; } }
      if (operations.some(operation => operation.type === "object.create" || operation.type === "object.duplicate")) { const created = read.canvas?.objects.filter(object => !previous?.canvas?.objects.some(before => before.id === object.id)); if (created?.length) {
        restoredCanvas = { ...restoredCanvas, pageId: created[0]!.pageId, selection: created.map(object => object.id).slice(-32) };
        const sourceBoards = previous?.canvas?.boards.filter(board => board.pageId === intent?.pageId) ?? [], nextBoards = read.canvas?.boards.filter(board => board.pageId === intent?.pageId) ?? [];
        const samePage = intent && created.every(object => object.pageId === intent.pageId) && operations.every(operation => operation.type === "object.create" || operation.type === "object.duplicate") && selected.id === intent.source.boardId && sourceBoards.length === nextBoards.length && sourceBoards.every(board => nextBoards.some(next => next.id === board.id));
        if (samePage) restoredCanvas = { ...restoredCanvas, camera: captureCamera(intent.source, intent.scope, intent.pageId) ?? intent.camera };
      } }
      if (intent?.navigationCanvas && pages.some(page => page.id === intent.navigationCanvas!.pageId)) {
        const sourceBoards = intent.previous.canvas?.boards.filter(board => board.pageId === intent.pageId) ?? [], nextBoards = read.canvas?.boards.filter(board => board.pageId === intent.pageId) ?? [];
        const sameBoards = sourceBoards.length === nextBoards.length && sourceBoards.every(board => nextBoards.some(next => next.id === board.id));
        setBoardId(selected.id);
        restoredCanvas = { ...restoredCanvas, ...intent.navigationCanvas, camera: sameBoards ? captureCamera(intent.source, intent.scope, intent.pageId) ?? intent.camera : undefined };
      }
      restoredCanvas = { ...restoredCanvas, selection: restoredCanvas.selection.filter(id => read.manifest.boards.some(board => board.id === id) || read.manifest.objects?.some(object => object.id === id)) };
      canvasEdit.current = restoredCanvas; setCanvasDraft(restoredCanvas); if (commitIntent.current === pendingIntent) commitIntent.current = null;
      if (!intent && checkpoint?.edit?.anchor) setReselect(checkpoint.edit.anchor.selector);
      const restored = { mode: "focus" as const, cameras: checkpoint?.view?.cameras ?? {} }; view.current = restored; setCameras(restored.cameras);
      if (checkpoint?.edit?.sourceConflict || checkpoint?.edit?.request || checkpoint?.canvas?.sourceConflict || checkpoint?.canvas?.request) setPanel("properties");
  }, [captureCamera]);
  const refresh = load;
  const restoreConflict = (checkpoint: DesignCheckpoint) => {
    setNotes(checkpoint.notes); latest.current.notes = checkpoint.notes;
    edit.current = checkpoint.edit; setEditDraft(checkpoint.edit); system.current = checkpoint.system; setSystemDraft(checkpoint.system);
    annotationRef.current = checkpoint.annotation; setAnnotation(checkpoint.annotation); canvasEdit.current = checkpoint.canvas; setCanvasDraft(checkpoint.canvas);
    handoff.current = checkpoint.handoff; view.current = checkpoint.view ?? { mode: "focus", cameras: {} }; setCameras(view.current.cameras);
    void save(checkpoint.notes).catch(() => setError(true));
  };
  const editNavigation = navigationEpoch.current, editHistory = historyEpoch.current;
  const ownsEdit = useCallback(() => {
    const current = latest.current;
    return Boolean(state && loadTarget.current.host === host && loadTarget.current.artifactId === loadedId && current.artifactId === loadedId && current.state?.documentId === state.documentId && current.state.revision === state.revision && current.state.generation === state.generation);
  }, [host, loadedId, state]);
  const commitEditDraft = useCallback((value: NonNullable<DesignCheckpoint["edit"]>) => {
    if (!ownsEdit()) return Promise.resolve();
    if (navigationEpoch.current !== editNavigation) return edit.current?.request ? changeEdit(value) : Promise.resolve();
    return changeEdit(value);
  }, [ownsEdit, editNavigation, changeEdit]);
  const commitCanvasDraft = useCallback((value: CanvasEdit) => {
    if (!ownsEdit()) return Promise.resolve();
    const current = canvasEdit.current;
    const cleanup = current?.request && (value.request !== current.request || value.sourceConflict !== current.sourceConflict);
    // Direct UI updates retain their request; only late operation cleanup keeps the newer view.
    return changeCanvas(navigationEpoch.current !== editNavigation && current && cleanup ? { ...current, request: value.request, sourceConflict: value.sourceConflict, draft: value.draft } : value);
  }, [ownsEdit, editNavigation, changeCanvas]);
  const controls = useDesignEdits({ state: loadedId === artifactId ? state : null, anchor, draft: editDraft, canvasDraft, onDraft: commitEditDraft, onCanvasDraft: commitCanvasDraft, canCommit: () => !hasUncheckpointed(), onConflict: () => { if (!ownsEdit()) return Promise.resolve(); setPanel("properties"); return refresh(); }, onCommitted: (id, operations) => {
    if (!ownsEdit() || historyEpoch.current !== editHistory) return;
    const source = latest.current, currentCanvas = canvasEdit.current;
    const navigationCanvas = navigationEpoch.current !== editNavigation && currentCanvas ? { pageId: currentCanvas.pageId, selection: currentCanvas.selection, tool: currentCanvas.tool, preview: currentCanvas.preview } : undefined;
    void save(source.notes).catch(() => setError(true));
    const camera = captureCamera(source, host.scope);
    cameraTrace("camera-handoff", { artifactId: id, sourceArtifactId: source.artifactId, revision: source.state!.revision, pageId: currentCanvas?.pageId, camera });
    commitIntent.current = { artifactId: id, operations, previous: source.state!, source, scope: host.scope, navigation: navigationEpoch.current, pageId: currentCanvas?.pageId, camera, navigationCanvas };
    setReselect(anchor?.selector ?? null); setArtifactId(id); setAnchor(null);
  } });
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
    void load().catch(() => setError(true));
    const epoch = loadEpoch;
    return () => { epoch.current++; };
  }, [host, artifactId, load]);
  useLayoutEffect(() => {
    const node = canvas.current, body = node?.parentElement; if (!node || !body) return; let current = true;
    const chrome = [...node.querySelectorAll<HTMLElement>("[data-workspace-canvas-header], [data-canvas-tools-group]")];
    const history = body.querySelector<HTMLElement>("[data-workspace-history]");
    const observer = new ResizeObserver(entries => {
      if (!current) return;
      const entry = entries.find(entry => entry.target === node);
      if (entry) setArea({ width: entry.contentRect.width, height: entry.contentRect.height });
      const bounds = body.getBoundingClientRect(), bottom = Math.max(node.getBoundingClientRect().top, ...chrome.map(element => element.getBoundingClientRect().bottom));
      const top = Math.min(bounds.height, Math.max(0, bottom - bounds.top + 12));
      body.style.setProperty("--artifact-inspector-top", `${top}px`);
      const historyBounds = history?.getBoundingClientRect(), inset = historyBounds && historyBounds.height > 0 ? Math.max(12, bounds.bottom - historyBounds.top + 12) : 12;
      body.style.setProperty("--artifact-inspector-bottom", `${Math.min(bounds.height, inset)}px`);
    });
    observer.observe(node); observer.observe(body); if (history) observer.observe(history); for (const element of chrome) observer.observe(element);
    return () => { current = false; observer.disconnect(); };
  }, [state, loadedId, artifactId, comparison, controls.edit.sourceConflict]);
  const update = (values: DesignCheckpoint["notes"]) => { latest.current.notes = values; setNotes(values); handoff.current = undefined; void save(values).catch(() => setError(true)); };
  const changeAnnotation = (value: AnnotationDraft | undefined) => { annotationRef.current = value; setAnnotation(value); void save(latest.current.notes).catch(() => setError(true)); };
  const storeView = (nextCameras = cameras) => { view.current = { mode: "focus", cameras: nextCameras }; setCameras(nextCameras); void save(latest.current.notes).catch(() => setError(true)); };
  const chooseBoard = (id: string) => { if (!canLeaveWorkspace()) return false; navigationEpoch.current++; commitIntent.current = null; setBoardNavigation(null); latest.current.boardId = id; setBoardId(id); setReselect(null); setAnchor(null); setSelecting(tool === "annotate" && !annotationRef.current); setAnnotationOpen(false); storeView(); return true; };
  const requestBoard = (id: string) => { if (!chooseBoard(id)) return; setBoardNavigation({ artifactId: latest.current.artifactId, boardId: id, scope: host.scope }); };
  const openVersion = (id: string) => { if (!canLeaveWorkspace()) return; const navigation = ++navigationEpoch.current; historyEpoch.current++; commitIntent.current = null; void save(notes).then(() => { if (navigation !== navigationEpoch.current) return; setArtifactId(id); setAnchor(null); }).catch(() => setError(true)); };
  const onTool = (next: CanvasTool) => { if (hasUncheckpointed()) { setError(true); return; }
    storeView(); setTool(next); setAnnotationOpen(false);
    if (next === "preview") { setSelecting(false); setPanel(null); return; }
    if (next === "annotate" && annotationRef.current) { requestBoard(annotationRef.current.anchor.boardId); setAnchor(annotationRef.current.anchor); setAnnotationOpen(true); setSelecting(false); setPanel(null); return; }
    if (next === "annotate") { setAnchor(null); setReselect(null); }
    setSelecting(true); if (next === "annotate") setPanel(null);
  };
  const selected = (value: DesignAnchor) => {
    setAnchor(value); setReselect(null); setSelecting(tool !== "annotate");
    if (retarget.current) { const id = retarget.current; retarget.current = null; update(notes.map(note => note.id === id ? { ...note, anchor: value } : note)); setPanel("comments"); return; }
    if (tool === "annotate") { changeAnnotation({ id: crypto.randomUUID(), text: "", anchor: value }); setAnnotationOpen(true); setPanel(null); }

  };
  const locateNote = (id: string) => { const note = notes.find(note => note.id === id); if (!note?.anchor) return; requestBoard(note.anchor.boardId); setLocate(null); requestAnimationFrame(() => setLocate(id)); setPanel("comments"); };
  const focusTrigger = (label: string) => requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(`button[aria-label="${CSS.escape(label)}"]`)?.focus());
  if (!state || loadedId !== artifactId) return <section className="artifact-workspace"><ArtifactHeader title={fence.title} /><div className="grid min-h-0 flex-1 place-content-center gap-3 p-6"><p role={error ? "alert" : "status"}>{error ? copy.failed : copy.loading}</p>{error && <Button onClick={() => void refresh().catch(() => setError(true))}>{copy.retry}</Button>}</div></section>;
  const board = state.manifest.boards.find(board => board.id === boardId) ?? state.manifest.boards[0]!, cameraKey = `${state.revision}:${board.id}`, camera = cameras[cameraKey] ?? { width: board.viewport.width, zoom: 1, fit: board.mode === "fixed" ? "board" as const : "width" as const };
  const width = camera.width, height = board.viewport.height;
  const zoom = camera.fit === "manual" ? camera.zoom : Math.max(.05, Math.min(1, (area.width - 32) / width, camera.fit === "board" ? (area.height - 72) / height : 3));
  const changeCamera = (next: Camera) => { const entries = Object.entries(cameras).filter(([key]) => key !== cameraKey).slice(-31); storeView(Object.fromEntries([...entries, [cameraKey, next]])); };
  const titles = Object.fromEntries(state.manifest.boards.map(board => [board.id, board.title]));
  const compareBoard = comparison.startsWith("board:") ? state.manifest.boards.find(board => board.id === comparison.slice(6)) : board, compareVersion = comparison.startsWith("version:") ? state.versions.find(value => value.revision === Number(comparison.slice(8))) : null;
  const modelSelection = canvasDraft?.selection.at(-1), selectedObject = state.canvas?.objects.find(object => object.id === modelSelection), selectedBoard = state.canvas?.boards.find(board => board.id === modelSelection);
  const displayPanel = panel;
  const panelTitle = displayPanel === "system" ? copy.system : displayPanel === "history" ? copy.history : displayPanel === "export" ? copy.export : displayPanel === "settings" ? copy.settings : displayPanel === "comments" ? copy.comments : copy.properties;
  const commitAnnotation = async () => { if (!annotationRef.current?.text.trim() || annotationFlight.current || !host.followUp) return;
    const draft = annotationRef.current, note = { id: draft.noteId ?? draft.id, text: draft.text.trim(), anchor: draft.anchor };
    annotationFlight.current = true; setAnnotationBusy(true); setError(false);
    try {
      await save(latest.current.notes);
      const checkpoint = checkpointSchema.parse({ documentId: state.documentId, revision: state.revision, boardId: draft.anchor.boardId, notes: [note],
        edit: edit.current, system: system.current, canvas: canvasEdit.current, view: view.current, annotation: draft });
      const review = await prepareReview(checkpoint);
      await save(latest.current.notes);
      const targetTitle = draft.anchor.currentText.trim() || draft.anchor.selector || copy.region;
      await host.followUp({ ...review, title: `${titles[draft.anchor.boardId] ?? review.title} · ${targetTitle}`.slice(0, 250) });
      const values = [...latest.current.notes.filter(value => value.id !== note.id), note];
      annotationRef.current = undefined; await save(values); latest.current.notes = values; setNotes(values); setAnnotation(undefined); setAnnotationOpen(false); setSelecting(true); setAnchor(null); setPanel(null);
      if (presentation?.full && presentation.canExpand) presentation.setFull(false);
    } catch { annotationRef.current = draft; await save(latest.current.notes).catch(() => {}); setError(true); }
    finally { annotationFlight.current = false; setAnnotationBusy(false); }
  };
  return <section ref={root} data-artifact-workspace={state.documentId} data-workspace-view="focus" aria-label={state.title} className="artifact-workspace" onKeyDown={event => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (annotationFlight.current) { event.preventDefault(); event.stopPropagation(); return; }
    if (annotationOpen) { event.preventDefault(); event.stopPropagation(); setAnnotationOpen(false); focusTrigger(copy.annotation); }
    else if (displayPanel) { event.preventDefault(); event.stopPropagation(); setPanel(null); focusTrigger(copy.more); }
    else if (selecting) { event.preventDefault(); setSelecting(false); setTool("preview"); retarget.current = null; focusTrigger(copy.select); }
    else if (presentation?.full && presentation.canExpand) { presentation.setFull(false); focusTrigger(copy.full); }
  }}>
    {state?.checkpointConflicts?.map((checkpoint, index) => <Button key={index} variant="outline" onClick={() => restoreConflict(checkpoint)}>{copy.retry} · {index + 1}</Button>)}
    <WorkspaceHeader state={state} artifactId={artifactId} controls={controls} onVersion={openVersion} />
    <div className="artifact-workspace-body">
      <div ref={canvas} data-workspace-canvas="" className="artifact-canvas">
        {controls.edit.sourceConflict && <div data-workspace-canvas-header="" className="flex min-h-[36px] shrink-0 items-center gap-2 border-b border-border/50 px-3 text-xs text-muted-foreground"><span className="min-w-0 flex-1 truncate">{copy.sourceChanged}</span>{controls.edit.sourceConflict && <Button variant="ghost" className="min-h-[44px] text-xs" onClick={() => setPanel("properties")}>{copy.properties}</Button>}</div>}
        <div className={comparison ? "artifact-canvas-pair" : "flex min-h-0 flex-1 flex-col"}>
          <CanvasEditor registerCamera={registerCamera} wheelRoot={root} onRefresh={refresh} actions={<WorkspaceActions state={state} tool={tool} commentCount={notes.length} onTool={onTool} onPanel={setPanel} onRefresh={() => { if (canLeaveWorkspace()) void refresh().catch(() => setError(true)); }} />} artifactId={artifactId} state={state} checkpoint={canvasDraft ?? { pageId: canvasPages(state.manifest)[0]!.id, selection: [], tool: "select", preview: false }} controls={controls} boardId={board.id} anchor={anchor} source={sourceTarget} textSession={textSession} onTextSession={beginTextSession} forceTool={tool === "annotate" ? "annotate" : null} selecting={selecting} selectionMode={selectionMode} exportOpen={displayPanel === "export"} onExport={() => setPanel(value => value === "export" ? null : "export")} propertiesOpen={displayPanel === "properties"} viewportWidth={width} reselect={reselect} notes={notes} locate={locate} onAnchor={selected} onBoard={chooseBoard} boardNavigation={boardNavigation} onBoardNavigation={requestBoard} onBoardNavigated={onBoardNavigated} onPin={locateNote} onTool={() => onTool("select")} onProperties={() => setPanel(value => value === "properties" ? null : "properties")} onUncheckpointed={onUncheckpointed} hasUncheckpointed={hasUncheckpointed} inputBlocked={inputBlocked} onClearSource={() => { setAnchor(null); setReselect(null); }} onEscape={() => { setSelecting(false); setTool("preview"); retarget.current = null; focusTrigger(copy.select); }} annotation={annotationOpen && annotation ? (id, target, viewport) => annotation.anchor.boardId === id ? <ContextAnnotation draft={annotation} boardTitle={titles[id] ?? id} target={target} viewport={viewport} busy={annotationBusy} change={text => changeAnnotation({ ...annotation, text })} save={() => void commitAnnotation()} close={() => { setAnnotationOpen(false); focusTrigger(copy.annotation); }} /> : null : undefined} />
          {comparison && compareBoard && <div className="flex min-h-0 flex-col border-l"><p className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">{compareBoard.title} · {formatCopy(copy.revisionTag, { revision: compareVersion?.revision ?? state.revision })}</p><DesignPreview artifactId={compareVersion?.artifactId ?? artifactId} boardId={compareBoard.id} title={`${compareBoard.title} · ${formatCopy(copy.revisionTag, { revision: compareVersion?.revision ?? state.revision })}`} generation={state.generation} width={width} height={compareBoard.viewport.height} zoom={Math.min(zoom, (area.width / 2 - 32) / width)} enabled={state.previewEnabled ?? state.enabled} selecting={false} /></div>}
        </div>
      </div>
      <aside data-workspace-inspector={displayPanel ?? "none"} className="artifact-inspector" hidden={!displayPanel} aria-label={panelTitle}>
        <header className="flex min-h-[44px] shrink-0 items-center gap-1 border-b px-3"><h3 className="min-w-0 flex-1 text-sm font-medium">{panelTitle}</h3><Button type="button" variant="ghost" size="icon" aria-label={copy.closePanel} className="min-h-[44px] min-w-[44px]" onClick={() => { setPanel(null); focusTrigger(copy.more); }}><X className="size-4" /></Button></header>
        <div className="flex shrink-0 gap-1 border-b px-2"><Button type="button" variant="ghost" size="icon" aria-label={copy.properties} className="min-h-[44px] min-w-[44px]" onClick={() => setPanel("properties")}><MousePointer2 className="size-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label={copy.comments} className="min-h-[44px] min-w-[44px]" onClick={() => setPanel("comments")}><MessageSquare className="size-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label={copy.system} className="min-h-[44px] min-w-[44px]" onClick={() => setPanel("system")}><Palette className="size-4" /></Button></div>
        <div hidden={displayPanel !== "properties"} className="min-h-0 flex-1 overflow-auto">{selectedObject || selectedBoard ? <CanvasObjectProperties key={modelSelection} artifactId={artifactId} controls={controls} object={selectedObject} board={selectedBoard} onUncheckpointed={onPropertyUncheckpointed} /> : <DesignProperties artifactId={artifactId} state={state} controls={controls} selected={Boolean(anchor)} boardId={board.id} target={sourceTarget.target} fonts={state.canvas?.fonts} onTextInput={() => beginTextSession(false)} />}</div>
        {displayPanel === "comments" && <FeedbackNotes notes={notes} titles={titles} update={update} locate={locateNote} retarget={id => { const note = notes.find(note => note.id === id); if (note?.anchor) requestBoard(note.anchor.boardId); retarget.current = id; setTool("annotate"); setSelecting(true); setPanel(null); }} handoff={setConfirm} enabled={state.enabled} busy={transferring} />}
        {displayPanel === "system" && <div className="min-h-0 flex-1 overflow-auto p-3"><Suspense fallback={<p>{copy.loading}</p>}><fieldset disabled={inputBlocked}><DesignSystem artifactId={artifactId} state={state} draft={systemDraft} onDraft={changeSystem} onConflict={refresh} onCommitted={id => { const selected = system.current; if (selected) systemSelection.current = { artifactId: id, documentId, token: selected.token, theme: selected.theme }; setArtifactId(id); setAnchor(null); }} /></fieldset></Suspense></div>}
        {displayPanel === "export" && <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4"><p className="text-xs text-muted-foreground">{state.title} · {formatCopy(copy.revisionTag, { revision: state.revision })} · {board.title}</p><DesignExports artifactId={artifactId} state={state} boardId={board.id} pageId={canvasDraft?.pageId} /></div>}
        {displayPanel === "history" && <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4"><label className="flex flex-col gap-2 text-sm">{copy.version}<select aria-label={copy.version} value={state.revision} className="min-h-[44px] rounded-md border bg-background" onChange={event => { const version = state.versions.find(value => value.revision === Number(event.target.value)); if (version) openVersion(version.artifactId); }}>{state.versions.map(version => <option key={version.revision} value={version.revision}>{formatCopy(copy.revisionTag, { revision: version.revision })}</option>)}</select></label><label className="flex flex-col gap-2 text-sm">{copy.compare}<select aria-label={copy.compare} value={comparison} className="min-h-[44px] rounded-md border bg-background" onChange={event => setComparison(event.target.value)}><option value="">{copy.none}</option>{state.manifest.boards.filter(value => value.id !== board.id).map(value => <option key={value.id} value={`board:${value.id}`}>{value.title} · {formatCopy(copy.revisionTag, { revision: state.revision })}</option>)}{state.versions.filter(value => value.revision !== state.revision).map(value => <option key={value.revision} value={`version:${value.revision}`}>{board.title} · {formatCopy(copy.revisionTag, { revision: value.revision })}</option>)}</select></label>{state.revision !== state.latestRevision && <Button disabled={!state.enabled || state.dirty} className="min-h-[44px]" onClick={() => void controls.restore(state.revision)}>{copy.restore}</Button>}</div>}
        {displayPanel === "settings" && <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4"><label className="flex flex-col gap-2 text-sm">{copy.responseWidth}<input aria-label={copy.width} type="number" min={40} max={8000} value={width} className="min-h-[44px] rounded-md border bg-background px-3" onChange={event => { const width = Number(event.target.value); if (width >= 40 && width <= 8000) changeCamera({ ...camera, width }); }} /></label><label className="flex flex-col gap-2 text-sm">{copy.select}<select aria-label={copy.select} value={selectionMode} className="min-h-[44px] rounded-md border bg-background" onChange={event => setSelectionMode(event.target.value as "element" | "region")}><option value="element">{copy.element}</option><option value="region">{copy.region}</option></select></label><Button className="min-h-[44px]" variant="outline" onClick={() => changeCamera({ ...camera, zoom: 1, fit: "manual" })}>{copy.actualSize}</Button></div>}
      </aside>
      <footer data-workspace-footer="" className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-center justify-end p-3 text-xs"><div data-canvas-chrome="" className="pointer-events-auto"><WorkspaceHistory state={state} controls={controls} /></div></footer>
    </div>
    {error && !confirm && <div role="alert" className="flex shrink-0 items-center gap-2 border-t bg-destructive/5 px-3 py-2 text-xs"><p className="flex-1">{copy.failed}</p><Button variant="ghost" className="min-h-[44px]" onClick={() => void save(notes).then(() => setError(false)).catch(() => {})}>{copy.retry}</Button></div>}
    <Dialog open={Boolean(confirm)} onOpenChange={open => { if (!open && !transferring) setConfirm(null); }}><DialogContent><DialogTitle>{confirm === "send" ? copy.confirmSend : copy.confirmDraft}</DialogTitle><DialogDescription>{state.title} · {formatCopy(copy.revisionTag, { revision: state.revision })} · {notes.length} {copy.commentCount}</DialogDescription>{confirm && error && <p role="alert">{copy.failed}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={transferring} className="min-h-[44px]" onClick={() => setConfirm(null)}>{copy.cancel}</Button><Button disabled={transferring} className="min-h-[44px]" onClick={() => {
      const action = confirm!; handoff.current ??= { id: crypto.randomUUID(), createdAt: Date.now(), action, status: "pending" }; setTransferring(true); setError(false);
      const checkpoint = { documentId: state.documentId, revision: state.revision, boardId: board.id, notes, handoff: handoff.current, edit: edit.current, system: system.current, canvas: canvasEdit.current, view: view.current, annotation: annotationRef.current };
      void save(notes);
      const reviewed = prepareReview(checkpoint);
      void reviewed.then(async review => {
        if (action === "send") await host.sendReview!({ ...review, requestId: handoff.current!.id, createdAt: handoff.current!.createdAt }); else await host.followUp!(review);
        handoff.current = { ...handoff.current!, status: "transferred" }; await save([]); latest.current.notes = []; setNotes([]); setConfirm(null);
      }).catch(() => setError(true)).finally(() => setTransferring(false));
    }}>{copy.confirm}</Button></div></DialogContent></Dialog>
  </section>;
}
