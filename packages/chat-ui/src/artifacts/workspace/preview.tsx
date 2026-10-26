/**
 * [INPUT]: Fixed board/lease identity, mutable frame priority, trusted activation clicks, shared anchor schema, optional timing and the current UI edit-session owner.
 * [OUTPUT]: Stable lease-keyed board views with retained loading thumbnails, authenticated one-use deferred picking, readiness, expiry/quota release and reversible edit previews.
 * [POS]: Frame consumer for the Canvas stage; hints never grant source or host mutation authority.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { anchorSchema, type DesignAnchor, type DesignCheckpoint } from "@ai-chat/cloud-protocol/artifacts/design/review";
import type { ArtifactLease } from "../context";
import { useArtifactHost } from "../context";
import { canvasTiming, type CameraInput } from "./canvas/editor/motion/timing";
import { PreviewLifetime } from "../lifecycle/lease";
import { requestArtifactFrame } from "../quota";
import { workspaceCopy } from "./copy";
import { BoardThumbnail } from "./canvas/thumbnail";
import type { CanvasTool } from "./canvas/editor/tools";
import type { CanvasCameraController } from "./canvas/editor/motion/controller";
type Lease = ArtifactLease & { nonce: string; selectionNonce: string; generation: string; boardId: string; boardDigest: string; key: string };
const bounds = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict().refine(value => value.x + value.width <= 1.001 && value.y + value.height <= 1.001);
const rectSchema = z.object({ x: z.number().finite().min(-1000000).max(1000000), y: z.number().finite().min(-1000000).max(1000000), width: z.number().finite().nonnegative().max(8000), height: z.number().finite().nonnegative().max(8000) }).strict();
const geometrySchema = z.object({ boardId: z.string().max(64), boardDigest: z.string().max(80), selected: bounds.nullable(), selectedRect: rectSchema.nullable().optional(), targets: z.array(z.object({ id: z.string().max(128), bounds: bounds.nullable() }).strict()).max(32) }).strict();
const hintKeys = ["color", "background-color", "font-size", "padding", "gap", "width", "height", "font-family", "font-weight", "font-style", "text-decoration", "text-align", "line-height", "letter-spacing", "position", "left", "top", "border-radius", "box-sizing"] as const;
const hintsSchema = z.partialRecord(z.enum(hintKeys), z.string().max(128));
const gestureSchema = z.object({ seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), kind: z.enum(["pan", "zoom"]), phase: z.enum(["change", "end"]), x: z.number().min(0).max(1), y: z.number().min(0).max(1), dx: z.number().min(-10000).max(10000), dy: z.number().min(-10000).max(10000) }).strict();
const textSchema = z.object({ session: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), selector: z.string().min(1).max(500), value: z.string().max(4096), phase: z.enum(["input", "done", "cancel"]) }).strict();
const keySchema = z.object({ key: z.enum(["z", "d", "+", "=", "-", "0", "v", "h", "t", "a", "n", "p", "r", "o", "l", "delete", "backspace", "arrowleft", "arrowright", "arrowup", "arrowdown"]), shift: z.boolean(), meta: z.boolean(), ctrl: z.boolean(), alt: z.boolean(), repeat: z.boolean() }).strict();
export type DesignGeometry = z.infer<typeof geometrySchema>;
export type FrameHints = z.infer<typeof hintsSchema>;
export type FrameGesture = z.infer<typeof gestureSchema> & { timing?: CameraInput };
export type FrameKey = z.infer<typeof keySchema>;
export type FrameSelection = { hints: FrameHints; rect?: z.infer<typeof rectSchema>; extend: boolean; intent: "select" | "edit-text" };
export type FrameText = z.infer<typeof textSchema>;
export type FrameEditorSession = { id: number; focus: boolean };
export type FrameEditor = { anchor: DesignAnchor; value: string; readOnly: boolean; focus: boolean; label?: string; styles?: FrameDisplay["styles"] };
export type FrameDisplay = { anchor: DesignAnchor; hide?: boolean; text?: string; styles?: Partial<Record<typeof hintKeys[number], string>> };
export function DesignPreview({ artifactId, boardId, generation, title, width, height, zoom, enabled, selecting, selectionMode = "element", tool, onAnchor, onNavigate, onEscape, notes = [], selected = null, locate, onPin, onGeometry, onGesture, onKey, onHover, display, embedded = false, selectionChrome = true, hostPins = false, reselect, focusSelection = 0, editor, editorSession = 0, onText, children, priority = 2, onActivate, controller }: {
  artifactId: string; boardId: string; generation: string; title: string; width: number; height: number; zoom: number; enabled: boolean; selecting: boolean; selectionMode?: "element" | "region"; tool?: CanvasTool;
  onAnchor?(anchor: DesignAnchor, details?: FrameSelection): void; onNavigate?(boardId: string): void; onEscape?(): void; notes?: DesignCheckpoint["notes"]; selected?: DesignAnchor | null; locate?: string | null;
  onPin?(id: string): void; onGeometry?(value: DesignGeometry): void; onGesture?(value: FrameGesture): void; onKey?(value: FrameKey): void; onHover?(value: DesignAnchor["bounds"] | null): void; display?: FrameDisplay | null;
  priority?: number; onActivate?(): boolean | void; controller?: CanvasCameraController;
  embedded?: boolean; selectionChrome?: boolean; hostPins?: boolean; reselect?: string | null; focusSelection?: number; editor?: FrameEditor | null; editorSession?: number; onText?(value: FrameText): void; children?: ReactNode;
}) {
  const host = useArtifactHost()!, frame = useRef<HTMLIFrameElement>(null), [active, setActive] = useState<string | null>(null), [storedLease, setLease] = useState<Lease | null>(null), [failedKey, setFailed] = useState(""), [retry, setRetry] = useState(0), [storedGeometry, setGeometry] = useState<(DesignGeometry & { key: string }) | null>(null);
  const requestKey = JSON.stringify([host.scope, artifactId, boardId, generation, retry]);
  const lifetime = useRef<PreviewLifetime<Lease> | null>(null), admission = useRef<ReturnType<typeof requestArtifactFrame> | null>(null);
  const pickContext = JSON.stringify([requestKey, selecting, selectionMode, tool]);
  type Pick = { key: string; sequence: number; x: number; y: number; extend: boolean };
  const [readyKey, setReadyKey] = useState(""), [pickState, setPickState] = useState<{ context: string; value: Pick | null }>({ context: pickContext, value: null }), pickSequence = useRef(0);
  if (pickState.context !== pickContext) setPickState({ context: pickContext, value: null });
  const pick = pickState.context === pickContext ? pickState.value : null;
  const rank = pick?.key === requestKey ? 2 : priority, latestRank = useRef(rank);
  useLayoutEffect(() => { latestRank.current = rank; admission.current?.setPriority(rank); }, [rank]);
  const loadedFrames = useRef(new WeakSet<HTMLIFrameElement>()), retiredLease = useRef<string | null>(null), syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const key = JSON.stringify([requestKey, active]), lease = active && storedLease?.key === key ? storedLease : null, failed = failedKey === requestKey, copy = workspaceCopy(host.locale), geometry = storedGeometry?.key === key ? storedGeometry : null;
  const ready = Boolean(lease && readyKey === key && !failed), retained = embedded && Boolean(onActivate);
  const editorOwner = useRef<{ session: number; editor?: FrameEditor | null; onText?: (value: FrameText) => void } | null>(null), synchronize = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!enabled || failed) return;
    const release = requestArtifactFrame(() => setActive(crypto.randomUUID()), () => setActive(null), latestRank.current); admission.current = release;
    return () => { if (admission.current === release) admission.current = null; release(); };
  }, [enabled, failed, requestKey]);
  useEffect(() => {
    if (!active || !host.workspace || failed) return;
    const request = new PreviewLifetime<Lease>(value => host.release(value), () => setFailed(requestKey));
    const controller = new AbortController();
    lifetime.current = request; request.acquiring();
    void host.workspace({ action: "preview", artifactId, boardId, generation }, controller.signal).then(value => {
      const acquired = { ...value as Lease, key };
      if (request.accept(acquired)) { setLease(acquired); }
    }).catch(() => request.fail());
    return () => { controller.abort(); clearTimeout(syncTimer.current); request.dispose(); if (lifetime.current === request) lifetime.current = null; };
  }, [host, active, artifactId, boardId, generation, key, requestKey, failed]);
  useEffect(() => {
    if (!enabled || active || failed || rank < 2) return;
    const timer = setTimeout(() => setFailed(requestKey), 30_000);
    return () => clearTimeout(timer);
  }, [enabled, active, failed, requestKey, rank]);
  const callbacks = useRef({ selecting, notes, onAnchor, onNavigate, onEscape, onGeometry, onGesture, onKey, onHover, tool });
  useLayoutEffect(() => { callbacks.current = { selecting, notes, onAnchor, onNavigate, onEscape, onGeometry, onGesture, onKey, onHover, tool }; });
  useEffect(() => {
    if (!lease || !active) return; let lastAnchor = 0, lastGesture = 0;
    const receive = (event: MessageEvent) => {
      const probe = canvasTiming(), received = probe?.enabled ? performance.now() : 0;
      const data = event.data;
      const measuring = Boolean(probe?.enabled && data?.type === "bottega:design:gesture" && data.phase === "change");
      const timing = measuring ? probe?.receive(lease.id, data.seq, received, data.measurement) : undefined;
      const { selecting, notes, onAnchor, onNavigate, onEscape, onGeometry, onGesture, onKey, onHover, tool } = callbacks.current;
      if (retiredLease.current === lease.id || event.source !== frame.current?.contentWindow || event.origin !== (lease.sandbox.includes("allow-same-origin") ? lease.origin : "null") || data?.id !== lease.id || data?.nonce !== lease.nonce || data?.generation !== generation) { if (timing) probe?.reject(timing, "scope"); else if (measuring) probe?.unknown(); return; }
      if (data.type === "bottega:design:navigate" && typeof data.boardId === "string") { onNavigate?.(data.boardId); return; }
      if (data.boardId !== boardId || data.boardDigest !== lease.boardDigest) { if (timing) probe?.reject(timing, "board"); else if (measuring) probe?.unknown(); return; }
      if (data.type === "bottega:design:geometry") {
        const result = geometrySchema.safeParse({ boardId: data.boardId, boardDigest: data.boardDigest, selected: data.selected, selectedRect: rectSchema.nullable().safeParse(data.selectedRect ?? null).success ? data.selectedRect ?? null : null, targets: data.targets });
        if (!result.success || result.data.targets.some(target => !notes.some(note => note.id === target.id && note.anchor?.boardId === boardId))) return;
        lifetime.current?.ready(); setReadyKey(key);
        setGeometry({ ...result.data, key }); onGeometry?.(result.data); return;
      }
      if (data.type === "bottega:design:escape") { onEscape?.(); return; }
      if (data.type === "bottega:design:gesture") {
        const result = gestureSchema.safeParse({ seq: data.seq, kind: data.kind, phase: data.phase, x: data.x, y: data.y, dx: data.dx, dy: data.dy });
        if (result.success && result.data.seq > lastGesture) {
          lastGesture = result.data.seq; if (timing) probe?.admit(timing); onGesture?.({ ...result.data, ...(timing ? { timing } : {}) });
        } else if (timing) probe?.reject(timing, result.success ? "sequence" : "schema");
        return;
      }
      if (data.type === "bottega:design:key" && tool !== "preview") {
        const result = keySchema.safeParse({ key: data.key, shift: data.shift, meta: data.meta, ctrl: data.ctrl, alt: data.alt, repeat: data.repeat }); if (result.success) onKey?.(result.data); return;
      }
      if (data.type === "bottega:design:text") {
        const owner = editorOwner.current; if (!owner?.editor || data.session !== owner.session || data.selector !== owner.editor.anchor.selector) return;
        const result = textSchema.safeParse({ session: data.session, selector: data.selector, value: data.value, phase: data.phase }); if (result.success) owner.onText?.(result.data); return;
      }
      if (!selecting) return;
      if (data.type === "bottega:design:hover") { const result = bounds.nullable().safeParse(data.bounds); if (result.success) onHover?.(result.data); return; }
      if (data.type !== "bottega:design:anchor" || Date.now() - lastAnchor < 80 && data.intent !== "edit-text") return;
      const anchor = anchorSchema.safeParse(data.anchor), hints = hintsSchema.safeParse(data.hints ?? {}), rect = rectSchema.optional().safeParse(data.rect);
      if (!anchor.success || !hints.success || anchor.data.boardId !== boardId || anchor.data.boardDigest !== lease.boardDigest || data.intent !== undefined && data.intent !== "select" && data.intent !== "edit-text") return;
      lastAnchor = Date.now(); setPickState(current => ({ ...current, value: null })); onAnchor?.(anchor.data, { hints: hints.data, rect: rect.success ? rect.data : undefined, extend: data.extend === true, intent: data.intent === "edit-text" ? "edit-text" : "select" });
    };
    addEventListener("message", receive); return () => removeEventListener("message", receive);
  }, [lease, active, boardId, generation, key]);
  const post = useCallback((type: string, data: object) => { if (lease) frame.current?.contentWindow?.postMessage({ type, nonce: lease.selectionNonce, ...data }, "*"); }, [lease]);
  const mode = () => post(tool ? "bottega:design:tool" : "bottega:design:select", tool ? { tool: ["preview", "select", "annotate", "hand", "text"].includes(tool) ? tool : "select", mode: selectionMode } : { enabled: selecting, mode: selectionMode });
  const targets = () => post("bottega:design:targets", { targets: notes.filter(note => note.anchor?.boardId === boardId).map(note => ({ id: note.id, ...note.anchor })), selected, locate, reselect, focusSelection, ...(ready && pick?.key === requestKey ? { pick: { sequence: pick.sequence, x: pick.x, y: pick.y, extend: pick.extend } } : {}) });
  const show = () => post("bottega:design:display", display ? { target: display.anchor, text: display.text, hide: display.hide, styles: display.styles } : { clear: true });
  useEffect(mode, [post, selecting, selectionMode, tool]);
  useEffect(targets, [post, notes, selected, locate, boardId, reselect, focusSelection, ready, pick, requestKey]);
  const editText = () => post("bottega:design:editor", editor ? { session: editorSession, target: editor.anchor, value: editor.value, readOnly: editor.readOnly, focus: editor.focus, label: editor.label, styles: editor.styles } : { session: editorSession, clear: true });
  useEffect(show, [post, display]);
  useEffect(editText, [post, editor, editorSession]);
  useLayoutEffect(() => {
    editorOwner.current = { session: editorSession, editor, onText };
    synchronize.current = () => { mode(); targets(); show(); editText(); };
  });
  const selectedBounds = geometry?.selected ?? selected?.bounds ?? selected?.region;
  const boxStyle = (value: NonNullable<DesignAnchor["bounds"]>) => ({ left: value.x * width * zoom, top: value.y * height * zoom, width: value.width * width * zoom, height: value.height * height * zoom });
  return <div data-design-preview={boardId} data-preview-priority={priority} data-preview-ready={ready || undefined} className={embedded ? "relative h-full w-full" : "relative min-h-0 min-w-0 flex-1 overflow-auto p-4"}>
    {retained && enabled && !failed && <div className="absolute inset-0 bg-background shadow-sm ring-1 ring-border" style={{ visibility: ready ? "hidden" : undefined }}><BoardThumbnail controller={controller} artifactId={artifactId} boardId={boardId} title={title} className="h-full w-full" retryButton={false} /></div>}
    {!enabled ? <div className="grid h-full place-content-center gap-2"><BoardThumbnail artifactId={artifactId} boardId={boardId} title={title} className={embedded ? "h-full w-full" : "h-48 w-64"} /><p role="status" className="text-center text-xs text-muted-foreground">{copy.off}</p></div> : failed ? <div role="alert" className="grid h-full place-content-center gap-2 text-center"><p>{copy.failed}</p><button className="min-h-[44px] rounded border px-3" onClick={() => setRetry(value => value + 1)}>{copy.retry}</button></div> : !lease ? retained ? null : <p role="status" className="grid h-full place-content-center">{copy.loading}</p> :
      <div className={`relative shrink-0 bg-background shadow-sm ring-1 ring-border ${embedded ? "" : "mx-auto"}`} style={{ width: width * zoom, height: height * zoom, ...(retained && !ready ? { opacity: 0, pointerEvents: "none" } as const : {}) }} aria-hidden={retained && !ready || undefined}>
        <iframe key={lease.id} ref={frame} onError={() => lifetime.current?.fail()} title={title} src={lease.url} sandbox={lease.sandbox} referrerPolicy="no-referrer" onLoad={() => {
          const node = frame.current; if (!node) return;
          if (loadedFrames.current.has(node)) {
            retiredLease.current = lease.id; clearTimeout(syncTimer.current); lifetime.current?.dispose(); setLease(null); setRetry(value => value + 1); return;
          }
          loadedFrames.current.add(node); lease.mount?.(node.contentWindow!); synchronize.current?.(); syncTimer.current = setTimeout(() => synchronize.current?.(), 180);
        }}
          style={{ width, height, border: 0, transform: `scale(${zoom})`, transformOrigin: "top left", display: "block" }} />
        {selectionChrome && selectedBounds && <div aria-hidden="true" data-workspace-selection="" className="pointer-events-none absolute border-2 border-primary bg-primary/5" style={boxStyle(selectedBounds)} />}
        {!hostPins && notes.map((note, index) => {
          if (note.anchor?.boardId !== boardId) return null; const found = geometry?.targets.find(target => target.id === note.id), at = found ? found.bounds : note.anchor.bounds ?? note.anchor.region;
          return at && <button key={note.id} type="button" data-feedback-pin={note.id} aria-label={`${copy.locate} ${index + 1}`} className="absolute z-10 flex min-h-[44px] min-w-[44px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-background bg-primary px-2 font-semibold text-primary-foreground shadow-sm" style={{ left: at.x * width * zoom, top: at.y * height * zoom }} onClick={() => onPin?.(note.id)}>{index + 1}</button>;
        })}
        {children}
      </div>}
    {retained && enabled && !failed && !ready && <button type="button" aria-label={title} className="absolute inset-0 h-full w-full bg-transparent" onClick={event => {
      if (!event.nativeEvent.isTrusted || onActivate?.() === false) return;
      if (selecting && selectionMode === "element" && event.detail > 0) { const bounds = event.currentTarget.getBoundingClientRect(); if (bounds.width > 0 && bounds.height > 0) setPickState({ context: pickContext, value: { key: requestKey, sequence: ++pickSequence.current, x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)), extend: event.shiftKey } }); }
    }} />}
  </div>;
}
