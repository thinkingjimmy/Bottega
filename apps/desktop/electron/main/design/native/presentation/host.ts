/**
 * [INPUT]: Exact live source consumer, immutable Slides source and closed fixed-session controls.
 * [OUTPUT]: One main-owned desktop audience/notes pair, truthful fullscreen state, bounded inline fallback and source-page/focus recovery.
 * [POS]: Trusted presentation authority; authored frames never receive window creation, notes resources or host write rights.
 */
import { randomUUID } from "node:crypto";
import { BrowserWindow } from "electron";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { nativePresentationCommandSchema, type NativePresentationState, type NativePresentationRole } from "@ai-chat/cloud-protocol/artifacts/design/native/presentation/model";
import { artifactRuntime } from "../../../artifacts/core/runtime";
import { nativePresentationSource, type NativePresentationPage } from "./source";
import { nativePresentationWindow, enterNativePresentationFullscreen, destroyNativePresentationWindow, nativePresentationTask } from "./windows";
import { createNativeNotesWindow } from "./notes";
import type { NativeExportSnapshot } from "../exports/plan";
type Owner = { key: string; input: WorkspaceCommand; windowId: number; guard(): void; role?: NativePresentationRole };
type Show = { controller: AbortController; owner: Owner; source: string; state: NativePresentationState; pages: NativePresentationPage[]; ready: Promise<void>;
  audience?: BrowserWindow; notes?: Awaited<ReturnType<typeof createNativeNotesWindow>>; notesFlight?: Promise<void>; lease?: { id: string; nativeToken: string };
  closing?: Promise<void>; events: { type: string; at: number }[] };
const sourceWindowFor = (owner: Owner) => BrowserWindow.getAllWindows().find(window => window.webContents.id === owner.windowId);
let active: Show | undefined, lastClosed: Show | undefined;
const windows = new Set<BrowserWindow>();
const track = (window: BrowserWindow) => { windows.add(window); window.once("closed", () => windows.delete(window)); return window; };
const observe = (show: Show, type: string) => { if (show.events.length < 128) show.events.push({ type, at: Date.now() }); };
const state = (show: Show): NativePresentationState => ({ ...show.state, fullscreen: show.audience?.isDestroyed() === false && show.audience.isFullScreen(), notesOpen: show.notes?.window.isDestroyed() === false });
async function audienceControl(show: Show, action: "start" | "navigate", slideId: string) {
  if (!show.audience || show.audience.isDestroyed() || !show.lease || active !== show || show.closing) throw new Error("The presentation audience closed");
  await nativePresentationTask(show.audience.webContents.executeJavaScript("new Promise((resolve,reject)=>{const until=Date.now()+15000;const poll=()=>{if(typeof window.__bottegaNativePresentationControl==='function')resolve(window.__bottegaNativePresentationControl(" +
    JSON.stringify(show.lease.nativeToken) + "," + JSON.stringify({ action, sessionId: show.state.sessionId, slideId }) + "));else if(Date.now()>until)reject(new Error('The original presentation did not initialize'));else setTimeout(poll,40)};poll()})"), show.controller.signal, 20000);
}
async function navigate(show: Show, slideId: string) {
  show.owner.guard(); if (!show.pages.some(page => page.id === slideId) || active !== show || show.closing) throw new Error("This slide belongs to another presentation");
  await audienceControl(show, "navigate", slideId); show.owner.guard();
  show.state.slideId = slideId; await show.notes?.render(show.pages, slideId); observe(show, "navigate"); return state(show);
}
async function notes(show: Show) {
  if (show.notes && !show.notes.window.isDestroyed()) { show.notes.window.focus(); return; }
  if (show.notesFlight) return show.notesFlight;
  show.notesFlight = (async () => {
    const view = await createNativeNotesWindow((action, slideId) => action === "exit" ? finish(show) : navigate(show, slideId!), show.controller.signal, track);
    if (active !== show || show.closing) { if (!view.window.isDestroyed()) view.window.destroy(); throw new Error("The presentation closed before its notes opened"); }
    show.notes = view; view.window.once("closed", () => { if (show.notes === view) show.notes = undefined; observe(show, "notes-closed"); });
    await view.render(show.pages, show.state.slideId); show.owner.guard(); view.window.showInactive(); observe(show, "notes-opened");
  })().finally(() => { show.notesFlight = undefined; });
  return show.notesFlight;
}
async function finish(show: Show) {
  if (show.closing) return show.closing;
  show.closing = Promise.resolve().then(async () => {
    if (show.audience && !show.audience.isDestroyed() && show.lease) {
      try { const id = await nativePresentationTask(show.audience.webContents.executeJavaScript("window.__bottegaNativePresentationCurrent?.(" + JSON.stringify(show.lease.nativeToken) + "," + JSON.stringify(show.state.sessionId) + ")"), AbortSignal.timeout(1000), 1000);
        if (show.pages.some(page => page.id === id)) show.state.slideId = id; } catch { /* Closed audiences retain their last admitted page. */ }
    }
    show.state.closed = true; show.controller.abort(new Error("The presentation closed")); if (show.notes && !show.notes.window.isDestroyed()) show.notes.window.destroy();
    if (show.audience) await destroyNativePresentationWindow(show.audience);
    if (show.lease) artifactRuntime()?.gateway.release(show.lease.id, show.owner.windowId);
    if (active === show) active = undefined;
    observe(show, "closed"); lastClosed = show;
    const source = sourceWindowFor(show.owner); if (source && !source.isDestroyed()) { source.show(); source.focus(); source.webContents.focus(); }
  });
  return show.closing;
}
async function open(owner: Owner, snapshot: NativeExportSnapshot, slideId: string, withNotes: boolean) {
  owner.guard(); const source = nativePresentationSource(snapshot);
  if (!source.pages.some(page => page.id === slideId)) throw new Error("Choose a non-skipped slide from this exact source");
  if (active) {
    if (active.owner.key !== owner.key) throw new Error("Close the current presentation before opening another");
    const show = active; await show.ready; if (show.closing) throw new Error("The current presentation is closing");
    show.audience?.focus(); if (withNotes) await notes(show); return state(show);
  }
  const show: Show = { controller: new AbortController(), owner, source: snapshot.version.snapshotRef, pages: source.pages,
    state: { sessionId: randomUUID(), mode: "desktop", slideId, fullscreen: false, notesOpen: false, closed: false }, ready: Promise.resolve(), events: [] };
  active = show;
  show.ready = (async () => {
    try {
      const gateway = artifactRuntime()!.gateway;
      const lease = await gateway.issueNative(owner.input, owner.windowId, { ...source.audience, editable: false }, { presentation: { sessionId: show.state.sessionId, slideId } });
      show.lease = lease; owner.guard(); if (active !== show || show.closing) throw new Error("The presentation source closed");
      const audience = track(nativePresentationWindow(snapshot.version.manifest.title, lease.origin)); show.audience = audience;
      audience.on("enter-full-screen", () => observe(show, "enter-full-screen"));
      audience.on("leave-full-screen", () => { observe(show, "leave-full-screen"); if (!show.closing) void finish(show); });
      audience.on("closed", () => { if (!show.closing) void finish(show); });
      audience.webContents.on("before-input-event", (event, input) => { if (input.type === "keyDown" && input.key === "Escape") { event.preventDefault(); void finish(show); } });
      await nativePresentationTask(audience.loadURL(lease.url), show.controller.signal); owner.guard(); await audienceControl(show, "start", slideId);
      if (withNotes) await notes(show);
      await nativePresentationTask(enterNativePresentationFullscreen(audience), show.controller.signal); owner.guard(); audience.focus(); audience.webContents.focus(); observe(show, "ready");
    } catch (cause) { await finish(show); throw cause; }
  })();
  await show.ready; return state(show);
}
export class NativePresentationHost {
  private readonly starts = new Map<string, Promise<NativePresentationState>>();
  private inline?: NativePresentationState;
  private inlinePages: NativePresentationPage[] = [];
  constructor(private readonly owner: Owner) {}
  async handle(raw: unknown, requestId: string, snapshot: NativeExportSnapshot): Promise<NativePresentationState> {
    this.owner.guard(); const input = nativePresentationCommandSchema.parse(raw);
    if (input.action === "start") {
      if (this.owner.role) throw new Error("The read-only audience cannot open presentation windows");
      const previous = this.starts.get(requestId); if (previous) { const original = await previous; return this.handle({ action: "status", sessionId: original.sessionId }, requestId, snapshot); }
      if (this.starts.size >= 64) throw new Error("Reopen the editor before starting more presentations");
      const task = (async () => {
        if (this.owner.windowId < 1 || !sourceWindowFor(this.owner)) {
          if (this.inline && !this.inline.closed) return { ...this.inline };
          const { pages } = nativePresentationSource(snapshot); if (!pages.some(page => page.id === input.slideId)) throw new Error("Choose a non-skipped slide from this source");
          this.inlinePages = pages;
          this.inline = { sessionId: randomUUID(), mode: "inline", slideId: input.slideId, fullscreen: false, notesOpen: input.notes, closed: false,
            reason: "Use inline presentation and its notes panel in this browser. Fullscreen depends on your browser and user activation." };
          return { ...this.inline };
        }
        return open(this.owner, snapshot, input.slideId, input.notes);
      })(); this.starts.set(requestId, task); return task;
    }
    if (this.inline?.sessionId === input.sessionId) {
      if (this.inline.closed && input.action !== "status") throw new Error("The inline presentation closed");
      if (input.action === "navigate" || input.action === "changed") { if (!this.inlinePages.some(page => page.id === input.slideId)) throw new Error("The slide belongs to another inline presentation"); this.inline.slideId = input.slideId; }
      if (input.action === "notes") this.inline.notesOpen = true;
      if (input.action === "exit") this.inline.closed = true;
      return { ...this.inline };
    }
    const show = active?.state.sessionId === input.sessionId ? active : lastClosed?.state.sessionId === input.sessionId ? lastClosed : undefined;
    if (!show || (this.owner.role ? this.owner.role.sessionId !== input.sessionId : show.owner.key !== this.owner.key)) throw new Error("The presentation session expired");
    if (input.action === "status") return state(show);
    if (show.closing || active !== show) throw new Error("The presentation closed");
    if (this.owner.role && !["changed", "exit"].includes(input.action)) throw new Error("The read-only audience cannot manage other windows");
    if (input.action === "exit") { await finish(show); return state(show); }
    if (input.action === "changed") {
      if (!this.owner.role || !show.pages.some(page => page.id === input.slideId)) throw new Error("The audience page does not belong to this presentation");
      show.state.slideId = input.slideId; await show.notes?.render(show.pages, input.slideId); return state(show);
    }
    if (input.action === "navigate") return navigate(show, input.slideId);
    await notes(show); return state(show);
  }
  close() { if (this.inline) this.inline.closed = true; if (active?.owner.key === this.owner.key) void finish(active); }
}
export function nativePresentationFacts() {
  const show = active, source = show ?? lastClosed, sourceWindow = source ? sourceWindowFor(source.owner) : null;
  return { windows: [...windows].filter(window => !window.isDestroyed()).length, sourceFocused: sourceWindow?.isFocused() ?? false,
    active: show ? { sessionId: show.state.sessionId, sourceSnapshot: show.source, currentSlideId: show.state.slideId, fullscreen: show.audience && !show.audience.isDestroyed() ? show.audience.isFullScreen() : false,
      audienceWindowId: show.audience?.id, notesWindowId: show.notes?.window.id, notesFullscreen: show.notes && !show.notes.window.isDestroyed() ? show.notes.window.isFullScreen() : false, notesText: show.pages.find(page => page.id === show.state.slideId)?.notes, events: [...show.events] } : null,
    last: lastClosed ? { ...state(lastClosed), events: [...lastClosed.events] } : null };
}
