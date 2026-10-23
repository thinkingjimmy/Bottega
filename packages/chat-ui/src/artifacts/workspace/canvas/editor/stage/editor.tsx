/**
 * [INPUT]: Central interaction target policy; Fixed owner checkpoint, workspace wheel root, read-only source refresh, inline workspace actions, export/property panel controls, scoped board requests, actual viewport/inspector measurements and explicit UI text sessions; catalog-owned labels use the shared formatCopy formatter.
 * [OUTPUT]: Full-height CanvasEditor with pointer-transparent floating tool gaps, measured chrome-safe editing bounds, action-time full-viewport Fit/zoom, visibility-bound camera, independent world/screen layers and guarded original-owner edits.
 * [POS]: Canvas editor composition; the parent owns custody/checkpoint, and CM owns every saved mutation.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Download, Play, MousePointer2, PanelRight } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { formatCopy } from "@ai-chat/ui/lib/workbench-copy/format";
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { DesignAnchor, DesignCheckpoint } from "@ai-chat/cloud-protocol/artifacts/design/review";
import { canvasOperationSchema, type CanvasOperation } from "@ai-chat/cloud-protocol/artifacts/design/canvas/commands";
import { CANVAS_SYSTEM_FONTS, type CanvasObject, type CanvasStyle } from "@ai-chat/cloud-protocol/artifacts/design/canvas/model";
import { readCanvas } from "@ai-chat/cloud-protocol/artifacts/design/canvas/view";
import { useArtifactHost } from "../../../../context";
import { DesignPreview, type DesignGeometry, type FrameSelection, type FrameHints, type FrameKey, type FrameDisplay, type FrameEditor, type FrameEditorSession } from "../../../preview";
import { BoardThumbnail } from "../../thumbnail";
import type { CanvasEdit, DesignEditController } from "../../edits";
import { canvasCopy } from "../copy";
import { CanvasPages, type PageAction } from "../pages";
import { CanvasTools, toolForKey, type CanvasTool, type ToolAvailability } from "../tools";
import { ProjectedCanvasZoom } from "../zoom";
import { CanvasCameraController, type CanvasCameraPort } from "../motion/controller";
import { fitCamera, panCamera, screenBox, unionBoxes, zoomAt, type CanvasBox } from "../motion/camera";
import { isTypingTarget } from "../motion/gestures";
import { cameraTrace } from "./state/diagnostics";
import { CanvasStage, type CanvasPlacement, type StageItem } from "./view";
import { INTERACTION_POLICY } from "../motion/policy";
import { CanvasObjectView, CanvasObjectHit } from "./objects";
import { CanvasSelection } from "./selection";
import { CanvasTypography, type TypographyValues } from "./panels/typography";
import { CanvasTextEditor } from "./panels/text";
import { CanvasInsert } from "./panels/insert";
import { CanvasObjectActions } from "./panels/actions";
import { transformOperations } from "./state/geometry";
import { useCanvasTarget } from "./state/target";
import { draftOperation, draftStyle, shownText, targetText, textOperation, type TextTarget, type TextExtras } from "./state/session";
export type BoardNavigationRequest = { artifactId: string; boardId: string; scope: string };
type Props = { artifactId: string; state: WorkspaceRead; checkpoint: CanvasEdit; controls: DesignEditController; boardId: string; anchor: DesignAnchor | null; wheelRoot: RefObject<HTMLElement | null>;
  registerCamera(port: CanvasCameraPort): () => void; actions?: ReactNode; exportOpen: boolean; onExport(): void; onRefresh(): Promise<unknown>;
  boardNavigation?: BoardNavigationRequest | null; onBoardNavigation?(id: string): void; onBoardNavigated?(request: BoardNavigationRequest): void;
  source: ReturnType<typeof useCanvasTarget>; textSession: FrameEditorSession; onTextSession(focus: boolean): void; onEscape(): void; forceTool?: "annotate" | null; selecting: boolean; selectionMode: "element" | "region"; propertiesOpen: boolean; viewportWidth?: number; reselect?: string | null;
  notes: DesignCheckpoint["notes"]; locate?: string | null; onAnchor(anchor: DesignAnchor): void; onBoard(id: string): void; onPin(id: string): void;
  onTool(): void; onProperties(): void; onClearSource(): void; onUncheckpointed(value: boolean): void; hasUncheckpointed?(): boolean; inputBlocked?: boolean; annotation?(boardId: string, target: CanvasBox | null, viewport: CanvasBox): ReactNode };
const anchorKey = (anchor: DesignAnchor | null) => anchor ? JSON.stringify([anchor.boardId, anchor.boardDigest, anchor.selector, anchor.currentText]) : "";
const targetStyle = { minWidth: INTERACTION_POLICY.minTargetCssPx, minHeight: INTERACTION_POLICY.minTargetCssPx };
export function CanvasEditor(props: Props) {
  const host = useArtifactHost()!, { registerCamera, artifactId, state, controls, anchor, boardId } = props, checkpoint = { ...props.checkpoint, selection: props.checkpoint.selection.slice(-1) }, copy = canvasCopy(host.locale), data = state.canvas ?? readCanvas(state.manifest, []);
  const page = data.pages.find(page => page.id === checkpoint.pageId) ?? data.pages[0]!, boards = data.boards.filter(board => board.pageId === page.id), objects = data.objects.filter(object => object.pageId === page.id);
  const activeBoard = boards.find(board => board.id === boardId) ?? boards[0], tool: CanvasTool = props.forceTool ?? (checkpoint.preview ? "preview" : checkpoint.tool), previewing = tool === "preview";
  const handledNavigation = useRef<BoardNavigationRequest | null>(null);
  const navigationHandler = useRef<((navigation: BoardNavigationRequest | null | undefined) => void) | null>(null);
  const viewport = useRef<HTMLDivElement>(null), [area, setArea] = useState({ width: 390, height: 500 }), [floatingArea, setFloatingArea] = useState<CanvasBox>({ x: 0, y: 0, width: 390, height: 500 });
  const cameraKey = `${host.scope}:${artifactId}:${state.generation}:${state.documentId}:${state.revision}:${page.id}`, [observed, setObserved] = useState<{ key: string; details: FrameSelection } | null>(null), [geometry, setGeometry] = useState<DesignGeometry | null>(null), [hover, setHover] = useState<DesignAnchor["bounds"] | null>(null), [focusSelection, setFocusSelection] = useState(0), fittingSource = useRef(false);
  const [inline, setInline] = useState(false), [autofocus, setAutofocus] = useState(false), [placement, setPlacement] = useState<CanvasPlacement | null>(null), [deleteOpen, setDeleteOpen] = useState(false), [inputError, setInputError] = useState(""), [invalidInput, setInvalidInput] = useState(false), [invalidTypography, setInvalidTypography] = useState(false), [serial, setSerial] = useState(0), [transform, setTransform] = useState<CanvasBox | null>(null);
  const [imageFailures, setImageFailures] = useState<Record<string, () => void>>({});
  const imageFailure = useCallback((id: string, retry: (() => void) | null) => setImageFailures(value => {
    if ((value[id] ?? null) === retry) return value;
    const next = { ...value }; if (retry) next[id] = retry; else delete next[id]; return next;
  }), []);
  const globalBox = (object: CanvasObject): CanvasBox => { const parent = object.boardId && data.boards.find(board => board.id === object.boardId); return { ...object.bounds, x: object.bounds.x + (parent ? parent.position.x : 0), y: object.bounds.y + (parent ? parent.position.y : 0) }; };
  const boardBox = (board: typeof data.boards[number]): CanvasBox => ({ ...board.position, width: board.id === boardId && board.mode === "responsive" && props.viewportWidth ? props.viewportWidth : board.viewport.width, height: board.viewport.height });
  const pageBox = unionBoxes([...boards.map(boardBox), ...objects.filter(object => !object.boardId).map(globalBox)]);
  const initial = checkpoint.camera ?? fitCamera(activeBoard ? boardBox(activeBoard) : pageBox, area, activeBoard?.mode === "responsive");
  // Controller identity follows the document/page scope; initial geometry is applied below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const controller = useMemo(() => new CanvasCameraController(initial, cameraKey), [cameraKey]);
  useLayoutEffect(() => { controller.initialize(initial); }, [controller, initial]);
  useLayoutEffect(() => {
    const port = { read: () => ({ scope: cameraKey, pageId: page.id, camera: controller.read() }), flush: () => { controller.flush(); } };
    const unregister = registerCamera(port), settle = () => controller.settle();
    const visibility = () => { if (document.hidden) controller.suspend(); else controller.resume(); };
    controller.resume(); visibility();
    window.addEventListener("blur", settle); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("blur", settle); document.removeEventListener("visibilitychange", visibility); unregister(); controller.dispose(); };
  }, [controller, registerCamera, cameraKey, page.id]);
  useLayoutEffect(() => {
    const node = viewport.current; if (!node) return; let current = true;
    const navigation = props.boardNavigation, body = node.closest(".artifact-workspace-body"), inspector = body?.querySelector<HTMLElement>("[data-workspace-inspector]"), history = body?.querySelector<HTMLElement>("[data-workspace-history]");
    const chrome = [...(node.parentElement?.querySelectorAll<HTMLElement>("[data-canvas-tools-group]") ?? [])];
    let resizeFrame: number | null = null;
    const measure = () => {
      if (!current) return;
      const bounds = node.getBoundingClientRect();
      const overlaps = (rect: DOMRect) => rect.width > 0 && rect.height > 0 && rect.left < bounds.right && rect.right > bounds.left && rect.top < bounds.bottom && rect.bottom > bounds.top;
      const top = Math.min(bounds.height, Math.max(0, ...chrome.map(element => element.getBoundingClientRect()).filter(overlaps).map(rect => rect.bottom - bounds.top + 12)));
      const historyBounds = history?.getBoundingClientRect(), bottom = historyBounds && overlaps(historyBounds) ? Math.max(0, historyBounds.top - bounds.top - 12) : bounds.height;
      let width = bounds.width, height = Math.max(0, bottom - top);
      if (inspector && !inspector.hidden) {
        const panel = inspector.getBoundingClientRect();
        if (overlaps(panel)) {
          const left = Math.max(0, Math.min(width, panel.left - bounds.left - 12)), above = Math.max(0, Math.min(height, panel.top - bounds.top - top - 12));
          if (left * height >= above * width) width = left; else height = above;
        }
      }
      setArea(value => value.width === bounds.width && value.height === bounds.height ? value : { width: bounds.width, height: bounds.height });
      if (bounds.width > 0 && bounds.height > 0) navigationHandler.current?.(navigation);
      setFloatingArea(value => value.y === top && value.width === width && value.height === height ? value : { x: 0, y: top, width, height });
    };
    const observer = new ResizeObserver(() => {
      if (resizeFrame === null) resizeFrame = requestAnimationFrame(() => { resizeFrame = null; measure(); });
    });
    observer.observe(node); if (inspector) observer.observe(inspector); if (history) observer.observe(history); for (const element of chrome) observer.observe(element);
    measure();
    return () => { current = false; observer.disconnect(); if (resizeFrame !== null) cancelAnimationFrame(resizeFrame); };
  }, [props.boardNavigation, artifactId, host.scope]);
  const activeAnchor = activeBoard && anchor?.boardId === activeBoard.id ? anchor : null, details = observed?.key === anchorKey(activeAnchor) ? observed.details : undefined, source = props.source;
  const selectedObjects = objects.filter(object => checkpoint.selection.includes(object.id)), selectedBoards = boards.filter(board => checkpoint.selection.includes(board.id)), object = selectedObjects.length === 1 ? selectedObjects[0] : undefined;
  const textTarget: TextTarget | null = object && (object.kind === "text" || object.kind === "note") ? { kind: "object", object } : !checkpoint.selection.length && source.target ? { kind: "source", target: source.target } : null;
  const operation = textTarget ? draftOperation(checkpoint, textTarget) : undefined, style = operation ? draftStyle(operation) : {}, hints: FrameHints = details?.hints ?? {};
  const values: TypographyValues = { ...(textTarget?.kind === "object" ? textTarget.object.style : textTarget?.kind === "source" ? textTarget.target.values : {}), ...hints, ...style };
  const editing = inline || Boolean(operation && (operation.type === "object.update" && operation.changes.text !== undefined || operation.type === "source.update" && operation.changes?.text !== undefined));
  const text = textTarget ? shownText(textTarget, operation, controls.edit, editing) : "", textEditable = textTarget?.kind === "object" || textTarget?.kind === "source" && textTarget.target.editable && textTarget.target.text;
  const canTransformSource = Boolean(source.target?.geometry && ["left", "top"].every(key => /^-?[\d.]+px$/.test(source.target?.values[key as "left"] ?? "")));
  const ready = controls.current && Boolean(state.canvas) && state.manifest.format === "bottega-design", busy = controls.busy || controls.pending, writeable = ready && !busy, reason = !state.enabled ? copy.off : state.revision !== state.latestRevision || state.editable === false ? copy.readonly : state.dirty ? copy.sourceChanged : !state.canvas ? copy.unavailable : controls.pending ? copy.checking : source.reason;
  const blockedInput = invalidInput || invalidTypography || props.inputBlocked === true;
  const rawRect = geometry && activeBoard && geometry.boardId === activeBoard.id ? geometry.selectedRect : undefined, sourceRect = rawRect ?? details?.rect ?? (activeAnchor?.bounds && activeBoard ? { x: activeAnchor.bounds.x * boardBox(activeBoard).width, y: activeAnchor.bounds.y * activeBoard.viewport.height, width: activeAnchor.bounds.width * boardBox(activeBoard).width, height: activeAnchor.bounds.height * activeBoard.viewport.height } : null);
  const sourceBox = activeBoard && sourceRect ? { ...sourceRect, x: sourceRect.x + activeBoard.position.x, y: sourceRect.y + activeBoard.position.y } : null;
  const selectedBox = selectedObjects.length ? unionBoxes(selectedObjects.map(value => value.id === object?.id && activeAnchor?.selector === `#${value.id}` && sourceBox ? sourceBox : globalBox(value))) : selectedBoards.length ? unionBoxes(selectedBoards.map(boardBox)) : sourceBox;
  const dirty = Boolean(checkpoint.draft?.length);
  const onUncheckpointed = props.onUncheckpointed;
  useEffect(() => { onUncheckpointed(invalidInput || invalidTypography); return () => onUncheckpointed(false); }, [invalidInput, invalidTypography, onUncheckpointed]);
  const update = (next: CanvasEdit) => {
    if (next.pageId === page.id) {
      if (next.camera && next.camera !== checkpoint.camera && next.camera !== controller.read()) controller.change(next.camera);
      next = { ...next, camera: controller.read() };
    }
    void controls.changeCanvas(next);
  };
  const cameraChange = controller.change;
  const cameraSettle = controller.end;
  useLayoutEffect(() => { controller.setCheckpoint(next => update({ ...props.checkpoint, camera: next })); });
  const canLeaveInput = () => { if (!invalidInput && !invalidTypography && !props.hasUncheckpointed?.()) return true; setInputError(copy.unsupported); return false; };
  const pickTool = (next: CanvasTool) => { if (!canLeaveInput()) return; props.onTool(); setPlacement(null); setHover(null); update({ ...checkpoint, preview: next === "preview", tool: next === "preview" || next === "annotate" ? checkpoint.tool : next, camera: controller.read() }); };
  const draftObject = (id: string) => checkpoint.draft?.some(operation => operation.type === "object.update" && operation.objectId === id);
  const draftSource = (value: DesignAnchor) => checkpoint.draft?.some(operation => operation.type === "source.update" && operation.anchor.boardId === value.boardId && operation.anchor.boardDigest === value.boardDigest && operation.anchor.selector === value.selector);
  const selectObject = (id: string, edit = false) => {
    if (tool === "hand" || previewing || !canLeaveInput()) return;
    if (dirty && !checkpoint.selection.includes(id) && !draftObject(id)) { setInputError(copy.finishEdit); return; }
    update({ ...checkpoint, selection: [id] }); const selected = data.objects.find(object => object.id === id); if ((edit || tool === "text") && selected && "text" in selected) { props.onTextSession(true); controls.change({ ...controls.edit, property: "text", value: selected.text, anchor: null }); } setInline(edit || tool === "text"); setAutofocus(edit || tool === "text"); setInputError("");
  };
  const acceptAnchor = (value: DesignAnchor, selection?: FrameSelection) => {
    if (!canLeaveInput()) return;
    if (props.forceTool) { setGeometry(null); setHover(null); props.onAnchor(value); return; }
    const model = data.objects.find(object => object.boardId === value.boardId && value.selector === `#${object.id}`);
    if (dirty && (model ? !checkpoint.selection.includes(model.id) && !draftObject(model.id) : activeAnchor?.selector !== value.selector && !draftSource(value))) { setInputError(copy.finishEdit); return; }
    props.onAnchor(value); setObserved({ key: anchorKey(value), details: selection ?? { hints: {}, extend: false, intent: "select" } }); setGeometry(null); setInputError("");
    if (model) selectObject(model.id, selection?.intent === "edit-text");
    else { update({ ...checkpoint, selection: [] }); if (selection?.intent === "edit-text") { props.onTextSession(true); controls.change({ ...controls.edit, property: "text", value: value.currentText, anchor: value }); } setInline(selection?.intent === "edit-text"); setAutofocus(selection?.intent === "edit-text"); }
  };
  const stageDraft = (target: TextTarget, patch: { text?: string; style?: CanvasStyle; extras?: TextExtras }) => {
    if (patch.text !== undefined) controls.change({ ...controls.edit, property: "text", value: patch.text, anchor: target.kind === "source" ? target.target.anchor : null });
    try {
      const next = textOperation(target, draftOperation(checkpoint, target), patch); update({ ...checkpoint, draft: [next], sourceConflict: undefined }); setInputError(""); setInvalidInput(false);
      if (patch.text !== undefined) controls.change({ ...controls.edit, property: "text", value: patch.text, anchor: target.kind === "source" ? target.target.anchor : null });
    } catch { setInputError(copy.budget); setInvalidInput(true); }
  };
  const startText = () => { if (!textTarget || !textEditable || !writeable) return; props.onTextSession(true); setInline(true); setAutofocus(true); stageDraft(textTarget, { text: targetText(textTarget) }); };
  const cancelDraft = (dismiss = false) => { if (busy) return; update({ ...checkpoint, draft: undefined, ...(dismiss ? { selection: [] } : {}) }); controls.change({ ...controls.edit, value: "", anchor: null }); setInline(false); setInputError(""); setInvalidInput(false); setInvalidTypography(false); setSerial(value => value + 1); props.onTextSession(false); if (dismiss) { props.onClearSource(); setGeometry(null); setHover(null); } };
  const done = async (value?: string) => {
    if (!writeable || inputError) return;
    let draft = checkpoint.draft;
    if (value !== undefined && textTarget) {
      try { draft = [textOperation(textTarget, draftOperation(checkpoint, textTarget), { text: value })]; }
      catch { setInputError(copy.budget); setInvalidInput(true); return; }
    }
    if (!draft?.length) { cancelDraft(true); return; }
    if (await controls.canvas(artifactId, draft)) { setInline(false); setInputError(""); props.onTextSession(false); }
  };
  const managePage = async (action: PageAction, pageId: string, title: string) => {
    if (!canLeaveInput()) return false;
    if (dirty) { setInputError(copy.finishEdit); return false; }
    return controls.canvas(artifactId, [canvasOperationSchema.parse(action === "create" ? { type: "page.create", title } : action === "rename" ? { type: "page.rename", pageId, title } : action === "duplicate" ? { type: "page.duplicate", pageId, title } : { type: "page.delete", pageId, confirmed: true })]);
  };
  const choosePage = (id: string) => { if (!canLeaveInput()) return; const board = data.boards.find(board => board.pageId === id); update({ ...checkpoint, pageId: id, selection: [], camera: undefined }); setInline(false); setGeometry(null); if (board) props.onBoard(board.id); };
  const measureViewport = () => {
    const bounds = viewport.current?.getBoundingClientRect();
    return bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null;
  };
  const chooseBoard = (id: string, notify = true) => {
    if (!canLeaveInput()) return false; const board = data.boards.find(board => board.id === id); if (!board) return false;
    const bounds = measureViewport(); if (!bounds) return null;
    const next = fitCamera(boardBox(board), bounds, board.mode === "responsive");
    // A prior live pan/zoom must not mask the new navigation checkpoint.
    if (board.pageId === page.id) cameraChange(next);
    update({ ...checkpoint, pageId: board.pageId, selection: [], camera: next });
    if (notify) props.onBoard(id); setGeometry(null); setHover(null); return true;
  };
  const requestBoard = (id: string) => { if (!canLeaveInput()) return; if (props.onBoardNavigation) props.onBoardNavigation(id); else chooseBoard(id); };
  useLayoutEffect(() => {
    navigationHandler.current = navigation => {
      if (!navigation || navigation !== props.boardNavigation || handledNavigation.current === navigation) return;
      if (navigation.artifactId !== artifactId || navigation.scope !== host.scope) { handledNavigation.current = navigation; props.onBoardNavigated?.(navigation); return; }
      if (chooseBoard(navigation.boardId, false) === null) return;
      handledNavigation.current = navigation; props.onBoardNavigated?.(navigation);
    };
  });
  const draftTarget = checkpoint.draft?.find(operation => ["object.update", "board.update", "source.update"].includes(operation.type));
  const draftSelected = draftTarget?.type === "object.update" ? checkpoint.selection.includes(draftTarget.objectId) : draftTarget?.type === "board.update" ? checkpoint.selection.includes(draftTarget.boardId) : draftTarget?.type === "source.update" ? activeAnchor?.boardId === draftTarget.anchor.boardId && activeAnchor?.boardDigest === draftTarget.anchor.boardDigest && activeAnchor?.selector === draftTarget.anchor.selector : true;
  const resumeDraft = () => {
    if (!canLeaveInput() || !draftTarget) return; props.onTool(); setInputError(""); setPlacement(null);
    if (draftTarget.type === "object.update") {
      const object = data.objects.find(object => object.id === draftTarget.objectId); if (!object) return;
      update({ ...checkpoint, pageId: object.pageId, selection: [object.id], preview: false, tool: "select", camera: fitCamera(globalBox(object), area) }); if (object.boardId) props.onBoard(object.boardId);
    } else if (draftTarget.type === "board.update" || draftTarget.type === "source.update") {
      const id = draftTarget.type === "board.update" ? draftTarget.boardId : draftTarget.anchor.boardId, board = data.boards.find(board => board.id === id); if (!board) return;
      update({ ...checkpoint, pageId: board.pageId, selection: draftTarget.type === "board.update" ? [id] : [], preview: false, tool: "select", camera: fitCamera(boardBox(board), area) }); props.onBoard(id); if (draftTarget.type === "source.update") props.onAnchor(draftTarget.anchor);
    }
    props.onTextSession(true);
  };
  const navigate = (href: string) => { const board = data.boards.find(board => board.file === href.split("#")[0]); if (board) requestBoard(board.id); };
  const submit = (operations: CanvasOperation[]) => { if (!canLeaveInput()) return Promise.resolve(false); if (dirty) { setInputError(copy.finishEdit); return Promise.resolve(false); } return controls.canvas(artifactId, operations); };
  const duplicate = () => { void submit([...selectedObjects.map(object => canvasOperationSchema.parse({ type: "object.duplicate", objectId: object.id, offset: { x: 24, y: 24 } })), ...selectedBoards.map(board => canvasOperationSchema.parse({ type: "board.duplicate", boardId: board.id, position: { x: Math.min(8000, board.position.x + 48), y: Math.min(8000, board.position.y + 48) } }))]); };
  const remove = () => submit([...selectedObjects.map(object => canvasOperationSchema.parse({ type: "object.delete", objectId: object.id, confirmed: true })), ...selectedBoards.map(board => canvasOperationSchema.parse({ type: "board.delete", boardId: board.id, confirmed: true }))]);
  // A discrete action can precede the ResizeObserver's deferred area update.
  const fit = (box: CanvasBox) => { const bounds = measureViewport(); if (!bounds) return; const next = fitCamera(box, bounds); cameraChange(next); controller.settle(); };
  const changeZoom = (zoom: number) => { const bounds = measureViewport(); if (!bounds) return; const next = zoomAt(controller.read(), { x: bounds.width / 2, y: bounds.height / 2 }, zoom); cameraChange(next); controller.settle(); };
  const settleTransform = (next: CanvasBox) => {
    const camera = controller.read(), screen = selectedBox ? screenBox(selectedBox, camera) : null;
    if (!selectedBox || !screen || !writeable) return;
    try { const operations = transformOperations({ objects: selectedObjects, boards: selectedBoards, allBoards: data.boards, world: selectedBox, screen, next, zoom: camera.zoom, source: canTransformSource ? source.target : undefined, hints }); if (operations.length) void submit(operations); }
    catch { setInputError(copy.budget); } finally { setTransform(null); }
  };
  const place = (value: CanvasPlacement) => {
    if (!writeable || !canLeaveInput()) return;
    if (["text", "note", "artboard", "image"].includes(value.tool)) { setPlacement(value); return; }
    const click = value.box.width < 8 && value.box.height < 8, bounds = { ...value.box, width: click ? 160 : value.box.width, height: click ? 120 : value.box.height }, kind = value.tool === "draw" ? "drawing" : value.tool;
    try { void submit([canvasOperationSchema.parse({ type: "object.create", pageId: page.id, object: { kind, bounds, fill: kind === "drawing" || kind === "line" || kind === "arrow" ? "transparent" : "#cbd5e1", stroke: "#2563eb", strokeWidth: 2, ...(["drawing", "line", "arrow"].includes(kind) ? { points: kind === "drawing" ? value.points : [value.points[0], value.points.at(-1)] } : {}) } })]); } catch { setInputError(copy.budget); }
  };
  const key = (value: FrameKey) => {
    const camera = controller.read(), screen = selectedBox ? screenBox(selectedBox, camera) : null;
    if (value.repeat || busy || value.alt) return; const command = value.meta || value.ctrl;
    if (command && value.key === "z") { if (dirty) { setInputError(copy.finishEdit); return; } const revision = value.shift ? state.redoRevision : state.undoRevision; if (revision) void controls.restore(revision, value.shift ? "redo" : "undo"); }
    else if (command && value.key === "d") duplicate();
    else if (command && ["+", "="].includes(value.key)) changeZoom(controller.read().zoom * 1.25);
    else if (command && value.key === "-") changeZoom(controller.read().zoom / 1.25);
    else if (command && value.key === "0") changeZoom(1);
    else if (!command && ["delete", "backspace"].includes(value.key) && (selectedObjects.length || selectedBoards.length)) { if (writeable && !dirty) setDeleteOpen(true); }
    else if (!command && value.key.startsWith("arrow") && selectedBox && screen && writeable && !dirty && (selectedObjects.length || selectedBoards.length || canTransformSource)) { const step = (value.shift ? 10 : 1) * camera.zoom; settleTransform({ ...screen, x: screen.x + (value.key === "arrowleft" ? -step : value.key === "arrowright" ? step : 0), y: screen.y + (value.key === "arrowup" ? -step : value.key === "arrowdown" ? step : 0) }); }
    else if (!command) { const next = toolForKey(value.key, value.shift); if (next && availability[next]?.available) pickTool(next); }
  };
  const availability: ToolAvailability = Object.fromEntries((["select", "hand", "text", "artboard", "note", "draw", "rectangle", "ellipse", "line", "arrow", "image"] as const).map(value => [value, { available: !blockedInput && (value === "hand" || value === "select" ? Boolean(state.previewEnabled ?? state.enabled) : writeable && (value === "artboard" ? data.boards.length < 16 : data.objects.length < 256) && (value !== "image" || Boolean(data.images.length))), reason: blockedInput ? copy.finishEdit : value === "image" && !data.images.length ? copy.imageMissing : value === "artboard" && data.boards.length >= 16 ? copy.boardLimit : data.objects.length >= 256 ? copy.objectLimit : reason }]));
  const editedObject = (object: CanvasObject) => { const operation = checkpoint.draft?.find(operation => operation.type === "object.update" && operation.objectId === object.id); return operation?.type === "object.update" ? { ...object, ...operation.changes, style: { ...object.style, ...operation.changes.style } } as CanvasObject : object; };
  const display: FrameDisplay | null = activeAnchor && textTarget && (textTarget.kind === "source" || textTarget.object.boardId) && (operation || editing) ? { anchor: activeAnchor, text: operation?.type === "source.update" ? operation.changes?.text : operation?.type === "object.update" ? operation.changes.text : undefined, styles: style, hide: editing && !previewing } : null;
  const frameEditor: FrameEditor | null = activeAnchor && editing && textTarget && textEditable && !previewing && (textTarget.kind === "source" || textTarget.object.boardId) ? { anchor: activeAnchor, value: text, readOnly: !writeable, focus: autofocus && props.textSession.focus, label: copy.editText, styles: style } : null;
  const items: StageItem[] = boards.map(board => {
    const box = boardBox(board), focused = board.id === activeBoard?.id;
    return { id: board.id, box, pinned: focused || checkpoint.selection.includes(board.id), label: <button type="button" data-canvas-chrome="" style={{ ...targetStyle, top: -INTERACTION_POLICY.minTargetCssPx }} className="absolute left-0 z-10 flex max-w-full items-center gap-2 truncate text-xs text-muted-foreground" onClick={() => { if (tool === "hand" || !canLeaveInput()) return; props.onBoard(board.id); update({ ...checkpoint, selection: [board.id] }); }}>{board.title} · {box.width} × {box.height}</button>, node: <>{focused ? <DesignPreview artifactId={artifactId} boardId={board.id} generation={state.generation} title={`${board.title} · ${formatCopy(copy.revisionTag, { revision: state.revision })}`} width={box.width} height={box.height} zoom={1} enabled={state.previewEnabled ?? state.enabled} selecting={props.forceTool ? props.selecting : !previewing && tool !== "hand"} tool={tool} selectionMode={props.selectionMode} onAnchor={acceptAnchor} onNavigate={requestBoard} onEscape={() => { if (props.forceTool) { props.onEscape(); return; } if (editing) cancelDraft(); else { update({ ...checkpoint, selection: [], preview: false, tool: "select" }); props.onClearSource(); setInline(false); } }} notes={previewing ? [] : props.notes} selected={activeAnchor} locate={props.locate} reselect={props.reselect ?? (object?.boardId === board.id ? `#${object.id}` : null)} onPin={props.onPin} focusSelection={focusSelection} onGeometry={value => { setGeometry(value); if (fittingSource.current && value.selectedRect) { fittingSource.current = false; fit({ ...value.selectedRect, x: value.selectedRect.x + board.position.x, y: value.selectedRect.y + board.position.y }); } }} onHover={setHover} display={display} editor={frameEditor} editorSession={props.textSession.id} onText={value => { if (!textTarget) return; if (value.phase === "cancel") cancelDraft(); else if (value.phase === "done") void done(value.value); else stageDraft(textTarget, { text: value.value }); }} embedded selectionChrome={false} hostPins onKey={key} onGesture={value => {
        cameraTrace("frame-input", { ...value, inputPhase: value.phase, before: controller.read() }); if (value.phase === "end") { cameraSettle(); return; } const current = controller.read(), rendered = controller.snapshot(), projected = screenBox(box, rendered);
        cameraChange(value.kind === "pan" ? panCamera(current, value.dx, value.dy) : zoomAt(current, { x: projected.x + value.x * box.width * rendered.zoom, y: projected.y + value.y * box.height * rendered.zoom }, current.zoom * Math.max(.8, Math.min(1.25, Math.exp(-value.dy * .01)))), value.timing);
      }} /> : <button type="button" className="h-full w-full rounded-none bg-background shadow-sm ring-1 ring-border" aria-label={board.title} onClick={() => requestBoard(board.id)}><BoardThumbnail controller={controller} artifactId={artifactId} boardId={board.id} title={board.title} className="h-full w-full" retryButton={false} /></button>}</> };
  });
  for (const value of objects.filter(object => !object.boardId)) { const object = editedObject(value); items.push({ id: object.id, box: globalBox(object), pinned: checkpoint.selection.includes(object.id), hit: !previewing && (tool === "select" || tool === "text") ? <CanvasObjectHit retry={imageFailures[object.id]} object={object} selected={checkpoint.selection.includes(object.id)} choose={() => selectObject(object.id)} edit={() => selectObject(object.id, true)} /> : null, node: <CanvasObjectView onFailure={imageFailure} object={object} controller={controller} artifactId={artifactId} snapshotRef={state.snapshotRef} image={object.kind === "image" ? data.images.find(image => image.path === object.asset.path && image.digest === object.asset.digest) : undefined} selected={checkpoint.selection.includes(object.id)} preview={previewing} navigate={navigate} /> }); }
  const noticePosition = { left: floatingArea.x + 12, width: Math.max(0, floatingArea.width - 24), bottom: Math.max(12, area.height - floatingArea.y - floatingArea.height + 12), maxHeight: Math.max(0, floatingArea.height - 24), overflow: "auto" as const };
  return <div data-canvas-wheel-surface="" className="relative flex min-h-0 min-w-0 flex-1 flex-col" onKeyDown={event => { if (event.defaultPrevented || !event.nativeEvent.isTrusted || isTypingTarget(event.target)) return; const value = event.key.toLowerCase(); if (["z", "d", "+", "=", "-", "0", "v", "h", "t", "a", "n", "p", "r", "o", "l", "delete", "backspace", "arrowleft", "arrowright", "arrowup", "arrowdown"].includes(value)) { key({ key: value as FrameKey["key"], shift: event.shiftKey, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, repeat: event.repeat }); if (event.ctrlKey || event.metaKey || toolForKey(value, event.shiftKey)) event.preventDefault(); } }}>
    <div data-canvas-toolbar="" className="artifact-canvas-tools pointer-events-none absolute inset-x-0 top-0 z-30 p-3">
      <div data-canvas-tools-group="draw" data-canvas-chrome="" className="artifact-floating-toolbar pointer-events-auto flex min-w-0 items-center"><CanvasPages pages={data.pages.map(page => ({ ...page, boardCount: data.boards.filter(board => board.pageId === page.id).length, objectCount: data.objects.filter(object => object.pageId === page.id).length }))} pageId={page.id} canEdit={writeable && !blockedInput} canNavigate={!blockedInput} busy={busy} reason={blockedInput ? copy.finishEdit : reason} choose={choosePage} manage={managePage} /><CanvasTools tool={tool} availability={availability} onTool={pickTool} />{props.actions}</div>
      <div data-canvas-tools-group="view" data-canvas-chrome="" className="artifact-floating-toolbar pointer-events-auto ml-auto flex shrink-0 items-center">
        <Button type="button" variant={props.exportOpen ? "secondary" : "ghost"} size="icon" style={targetStyle} aria-label={copy.export} title={copy.export} aria-pressed={props.exportOpen} onClick={props.onExport}><Download className="size-4" /></Button>
        <Button type="button" variant={previewing ? "secondary" : "ghost"} size="icon" style={targetStyle} aria-label={copy.preview} aria-pressed={previewing} onClick={() => pickTool(previewing ? checkpoint.tool : "preview")}>{previewing ? <MousePointer2 className="size-4" /> : <Play className="size-4" />}</Button>
        <Button type="button" variant={props.propertiesOpen ? "secondary" : "ghost"} size="icon" style={targetStyle} aria-label={copy.properties} aria-pressed={props.propertiesOpen} onClick={props.onProperties}><PanelRight className="size-4" /></Button>
        <ProjectedCanvasZoom controller={controller} onZoom={changeZoom} onFitPage={() => fit(pageBox)} onFitBoard={() => activeBoard && fit(boardBox(activeBoard))} onFitSelection={() => { if (activeAnchor && !selectedObjects.length && !selectedBoards.length) { fittingSource.current = true; setFocusSelection(value => value + 1); } else if (selectedBox) fit(selectedBox); }} selectionAvailable={Boolean(selectedBox)} />
      </div>
    </div>
    <div ref={viewport} className="absolute inset-0 flex min-h-0 min-w-0"><CanvasStage size={area} controller={controller} wheelRoot={props.wheelRoot} tool={tool} items={items} canPlace={writeable && !blockedInput && !props.forceTool} empty={!boards.length && !objects.length} getCamera={controller.read} changeCamera={cameraChange} settleCamera={cameraSettle} onPlace={place} onClear={() => { if (!dirty && canLeaveInput()) { update({ ...checkpoint, selection: [] }); props.onClearSource(); } }}>
      {selectedBox || transform || props.notes.length > 0 || hover || props.forceTool || props.annotation || dirty || inputError || controls.error || controls.pending || checkpoint.sourceConflict ? camera => {
        const screen = selectedBox ? screenBox(selectedBox, camera) : null;
        const annotationBounds = (geometry?.boardId === activeBoard?.id ? geometry?.selected : null) ?? activeAnchor?.bounds ?? activeAnchor?.region;
        const annotationTarget = activeBoard && activeAnchor && annotationBounds ? screenBox({ x: activeBoard.position.x + annotationBounds.x * boardBox(activeBoard).width,
          y: activeBoard.position.y + annotationBounds.y * activeBoard.viewport.height, width: annotationBounds.width * boardBox(activeBoard).width, height: annotationBounds.height * activeBoard.viewport.height }, camera) : null;
        const floatingWidth = Math.min(360, Math.max(0, floatingArea.width - 16)), floatingBottom = floatingArea.y + floatingArea.height - 8;
        const floatingTop = screen ? Math.max(floatingArea.y + 8, Math.min(floatingBottom - 152, screen.y > floatingArea.y + 160 ? screen.y - 150 : screen.y + screen.height + 8)) : floatingArea.y + 8;
        const floating = screen ? { left: Math.max(floatingArea.x + 8, Math.min(floatingArea.x + floatingArea.width - floatingWidth - 8, screen.x)), top: floatingTop, width: floatingWidth, maxHeight: Math.max(0, floatingBottom - floatingTop) } : null;
        return <>
      <div data-canvas-layer="markers" className="pointer-events-none absolute inset-0 z-[100]">
      {!previewing && activeBoard && props.notes.map((note, index) => {
        if (note.anchor?.boardId !== activeBoard.id) return null;
        const target = geometry?.boardId === activeBoard.id ? geometry.targets.find(target => target.id === note.id) : undefined;
        const at = target ? target.bounds : note.anchor.bounds ?? note.anchor.region;
        const box = boardBox(activeBoard);
        return at && <button key={note.id} type="button" data-feedback-pin={note.id} aria-label={`${copy.select} ${index + 1}`} className="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground" style={{ ...targetStyle, left: (box.x + at.x * box.width - camera.x) * camera.zoom, top: (box.y + at.y * box.height - camera.y) * camera.zoom }} onClick={() => props.onPin(note.id)}>{index + 1}</button>;
      })}
      {!previewing && hover && activeBoard && (!screen || props.forceTool && props.selecting) && <div aria-hidden="true" className="pointer-events-none absolute border border-primary/60" style={{ left: (activeBoard.position.x - camera.x + hover.x * boardBox(activeBoard).width) * camera.zoom, top: (activeBoard.position.y - camera.y + hover.y * activeBoard.viewport.height) * camera.zoom, width: hover.width * boardBox(activeBoard).width * camera.zoom, height: hover.height * activeBoard.viewport.height * camera.zoom }} />}
      {props.forceTool && !props.selecting && annotationTarget && <div aria-hidden="true" data-canvas-comment-target="" className="pointer-events-none absolute border-2 border-primary bg-primary/5" style={{ left: annotationTarget.x, top: annotationTarget.y, width: annotationTarget.width, height: annotationTarget.height }} />}
      </div><div data-canvas-layer="controls" className="pointer-events-none absolute inset-0 z-[200]">
      {!previewing && !props.forceTool && tool === "select" && screen && <CanvasSelection box={screen} zoom={camera.zoom} movable={writeable && !dirty && Boolean(selectedObjects.length || selectedBoards.length || canTransformSource)} resizable={writeable && !dirty && Boolean(selectedObjects.length || selectedBoards.length || canTransformSource)} busy={busy} reason={reason} preview={setTransform} settle={settleTransform} />}
      {transform && <div className="pointer-events-none absolute z-30 border border-primary bg-primary/5" style={{ left: transform.x, top: transform.y, width: transform.width, height: transform.height }} />}
      </div><div data-canvas-layer="editing" className="pointer-events-none absolute inset-0 z-[300] [&>*]:pointer-events-auto">
      {!previewing && !props.forceTool && floating && textTarget && <div className="absolute z-40 max-w-[calc(100%-16px)] overflow-auto" style={floating}><CanvasTypography key={`${anchorKey(activeAnchor)}:${object?.id}:${serial}`} visible={floatingWidth >= 160} values={values} fonts={textTarget.kind === "object" && !textTarget.object.boardId ? data.fonts.filter(font => (CANVAS_SYSTEM_FONTS as readonly string[]).includes(font)) : data.fonts} editable={writeable && (textTarget.kind === "object" || textTarget.target.editable && textTarget.target.typography)} textEditable={Boolean(textEditable)} linkEditable={textTarget.kind === "object" ? textTarget.object.kind === "text" : textTarget.target.link} listEditable={textTarget.kind === "object" ? textTarget.object.kind === "text" : textTarget.target.list} reason={reason} href={operation?.type === "source.update" ? operation.href ?? source.target?.href ?? "" : operation?.type === "object.update" ? operation.changes.href ?? (object?.kind === "text" ? object.href ?? "" : "") : textTarget.kind === "source" ? textTarget.target.href ?? "" : textTarget.object.kind === "text" ? textTarget.object.href ?? "" : ""} list={operation?.type === "source.update" ? operation.list ?? source.target?.listMode ?? "none" : operation?.type === "object.update" ? operation.changes.list ?? (object?.kind === "text" ? object.list ?? "none" : "none") : textTarget.kind === "source" ? textTarget.target.listMode ?? "none" : textTarget.object.kind === "text" ? textTarget.object.list ?? "none" : "none"} dirty={dirty} busy={busy} onUncheckpointed={value => { setInvalidTypography(value); if (!value) setInputError(""); }} change={(style, extras) => stageDraft(textTarget, { style, extras })} editText={startText} done={() => void done()} close={() => cancelDraft(true)} refresh={props.onRefresh} /></div>}
      {!previewing && !props.forceTool && editing && textTarget?.kind === "object" && !textTarget.object.boardId && screen && textEditable && <CanvasTextEditor value={text} box={screen} zoom={camera.zoom} style={values} editable={writeable} busy={busy} autofocus={autofocus} change={text => stageDraft(textTarget, { text })} done={() => void done()} cancel={() => cancelDraft()} />}
      {!previewing && !props.forceTool && screen && !textTarget && (selectedObjects.length || selectedBoards.length) > 0 && <CanvasObjectActions box={transform ?? screen} viewport={area} safeArea={floatingArea} editable={writeable} busy={busy} dirty={dirty} confirm={deleteOpen} onConfirm={setDeleteOpen} duplicateAvailable={data.objects.length + selectedObjects.length <= 256 && data.boards.length + selectedBoards.length <= 16} duplicate={duplicate} remove={remove} />}
      {dirty && !draftSelected && !controls.pending && !checkpoint.sourceConflict && <div data-canvas-resume-draft="" data-canvas-chrome="" style={noticePosition} className="absolute z-40 flex items-center gap-2 rounded-lg border bg-background p-2 text-sm shadow-lg"><p className="min-w-0 flex-1">{copy.unsavedInput}</p><Button type="button" style={targetStyle} onClick={resumeDraft}>{copy.continueEdit}</Button></div>}
      {(inputError || controls.error || controls.pending || checkpoint.sourceConflict) && <div style={noticePosition} className="absolute z-50 rounded-lg border bg-background p-3 text-sm shadow-lg" role="alert"><p>{inputError || controls.error || (checkpoint.sourceConflict?.needsResolution ? copy.partialSourceChanged : checkpoint.sourceConflict ? copy.sourceChanged : copy.checking)}</p>{(checkpoint.request || controls.edit.request) && <Button type="button" variant="outline" className="mt-2" style={targetStyle} disabled={controls.busy} onClick={() => void controls.recover(Boolean(checkpoint.sourceConflict?.needsResolution))}>{checkpoint.sourceConflict?.needsResolution ? copy.keepCurrentSource : copy.retry}</Button>}</div>}
      {activeBoard && props.annotation?.(activeBoard.id, annotationTarget, floatingArea)}
      </div></>;
      } : undefined}
    </CanvasStage></div>
    {placement && <CanvasInsert key={JSON.stringify(placement.box)} placement={placement} pageId={page.id} pageTitle={page.title} board={activeBoard} images={data.images} busy={busy} create={operation => submit([operation])} close={() => { setPlacement(null); pickTool("select"); }} />}
  </div>;
}
