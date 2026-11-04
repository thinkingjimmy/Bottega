/**
 * [INPUT]: Exact native lease, fixed Dashboard projection, main-owned atomic writes and existing native comment saves.
 * [OUTPUT]: Dedicated Dashboard editor with opaque data redraw, real Sources, preserved page drafts and original Chat annotations.
 * [POS]: Trusted Dashboard host; all authored scripts stay in its sandboxed child and receive no native capabilities.
 */
import { dashboardCopy as copy, dashboardLocale } from "./copy";
import { dashboardIcon } from "./icons";
import { nativeHistoryLabel, openNativeHistory } from "../../canvas-runtime/adapters/export-runtime";
import { installProjectExport } from "../../canvas-runtime/build/projects/ui";
import { nativeDownloads } from "../../canvas-runtime/build/downloads";
import { nativeBase, nativeFetch } from "../../canvas-runtime/build/transport";
import { installNativeComments } from "../../canvas-runtime/build/comments";
import { element, button, createSources, type Material, type Calculation } from "./sources";
document.documentElement.lang = dashboardLocale();
const token = document.querySelector<HTMLMetaElement>('meta[name="bottega-native-token"]')?.content;
if (!token) throw new Error("The Dashboard requires its exact native lease");
const base = nativeBase(), root = document.getElementById("root")!, parentPost = (value: unknown) => window.parent.postMessage(value, "*");
const error = element("p", "", "dash-error"), status = element("span", copy().loading, "dash-status"), title = element("h1", copy().title), toolbar = element("header", undefined, "dash-toolbar"), actions = element("div", undefined, "dash-row");
const canvas = element("main", undefined, "dash-canvas"), frame = element("iframe"), sourceRoot = element("aside", undefined, "dash-source"), pageEditor = element("section", undefined, "dash-page-editor");
error.setAttribute("role", "alert"); frame.title = "Dashboard page"; frame.sandbox.add("allow-scripts"); frame.referrerPolicy = "no-referrer"; sourceRoot.hidden = true; pageEditor.hidden = true; canvas.append(frame); title.hidden = true; toolbar.append(status, title, actions); root.append(toolbar, error, canvas, sourceRoot, pageEditor);
let material: Material, generation = 0, mode = false, dirty = false, editingBaseline = "", finalFlushNonce: string | undefined, failed = false;
let publishing: Promise<unknown> = Promise.resolve(), loaded = false, restoring: unknown, theme = new URL(location.href).searchParams.get("theme") === "dark" ? "dark" : "light";
let calculations = new Map<string, Calculation>(), threads: { id: string; anchor: string; n: number }[] = [];
const requests = new Map<string, string>(), stateReads = new Map<string, { resolve(value: unknown): void; timer: ReturnType<typeof setTimeout> }>();
const sendPage = (value: unknown) => frame.contentWindow?.postMessage(value, "*");
const showError = (message: string) => { error.textContent = message.slice(0, 1000); failed = true; status.textContent = copy().notSaved; };
const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
const base64 = (bytes: Uint8Array) => { let text = ""; for (let offset = 0; offset < bytes.length; offset += 32768) text += String.fromCharCode(...bytes.subarray(offset, offset + 32768)); return btoa(text); };
async function request(path: string, value: unknown, originalId?: string) {
  const body = JSON.stringify(value), key = path + await digest(new TextEncoder().encode(body));
  const read = path === "__deck/dashboard", id = originalId ? "native-" + originalId : requests.get(key) ?? "native-" + crypto.randomUUID();
  if (!read) { if (!requests.has(key) && requests.size >= 8) throw new Error("A previous save needs its original result. Keep this draft and retry the original save."); requests.set(key, id); }
  const response = await nativeFetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", "X-Bottega-Native": token!, "X-Bottega-Request": id, ...(finalFlushNonce ? { "X-Bottega-Final-Flush": finalFlushNonce } : {}) }, body });
  const result = await response.json();
  if (!response.ok) { if (response.status === 400 && result.code === "invalid_content") requests.delete(key); throw new Error(result.message ?? "The saved source changed. Keep your draft and compare the current version."); }
  if (!read) { requests.delete(key); if (path !== "__deck/adopt") parentPost({ type: "bottega:native:saved", token, result }); }
  return result;
}
async function captureState() {
  if (!loaded) return undefined; const requestId = crypto.randomUUID();
  return new Promise<unknown>(resolve => { const timer = setTimeout(() => { stateReads.delete(requestId); resolve(undefined); }, 1500); stateReads.set(requestId, { resolve, timer }); sendPage({ type: "dashboard:capture", requestId }); });
}
async function refresh() {
  const next = await request("__deck/dashboard", {}) as Material;
  if (!next || !next.datasets || !next.documents || typeof next.html !== "string" || typeof next.pageDigest !== "string") throw new Error("The fixed Dashboard projection is invalid");
  const samePage = material?.pageDigest === next.pageDigest; const state = samePage ? undefined : await captureState();
  material = next; title.textContent = next.title;
  if (samePage) sendPage({ type: "dashboard:data", datasets: next.datasets, defaults: next.documents["dash/params"] ?? {} });
  else { restoring = state; loaded = false; calculations.clear(); generation++; frame.dataset.pageGeneration = String(generation); frame.srcdoc = next.html; }
  if (!sourceRoot.hidden) sources.render(); status.textContent = dirty ? copy().unsaved : copy().saved; return next;
}
function queue<T>(run: () => Promise<T>): Promise<T> {
  const next = publishing.catch(() => {}).then(run); publishing = next; return next;
}
async function write(value: unknown) {
  status.textContent = copy().saving; const result = await request("__deck/dashboard-write", value); await refresh(); failed = false; error.textContent = ""; return result;
}
async function publish(batch: Record<string, { content?: string | Blob; contentType?: string; ifMatch?: string | null; delete?: boolean } | null>, requestId?: string) {
  return queue(async () => {
    const files: Record<string, unknown> = {};
    for (const [path, entry] of Object.entries(batch)) files[path] = !entry || entry.delete ? entry : { base64: base64(entry.content instanceof Blob ? new Uint8Array(await entry.content.arrayBuffer()) : new TextEncoder().encode(entry.content ?? "")), contentType: entry.contentType ?? "application/octet-stream", ...(entry.ifMatch !== undefined ? { ifMatch: entry.ifMatch } : {}) };
    const result = await request("__deck/publish", { files }, requestId); await refresh(); return result;
  });
}
installNativeComments({ base, token, publish });
installProjectExport(nativeDownloads(base, token, async () => { await publishing; if (dirty || failed) throw new Error("Save the current page before exporting"); }), token);
const sources = createSources(sourceRoot, {
  material: () => material, calculations: () => calculations, close() { sourceRoot.hidden = true; sendPage({ type: "dashboard:sources", on: false }); }, error: showError,
  add(file) {
    return queue(async () => {
      if (file.size < 1 || file.size > 8 * 1024 * 1024 || !/\.(csv|tsv|json)$/i.test(file.name)) throw new Error(copy().invalidData);
      const bytes = new Uint8Array(await file.arrayBuffer()), assetId = (await digest(bytes)).slice(0, 32), id = "source-" + crypto.randomUUID();
      await write({ writes: [{ op: "set", path: "datasets/" + id, data: { title: file.name.replace(/\.[^.]+$/, ""), description: "", source: { kind: "file", url: "/_blob/" + assetId, name: file.name, format: /\.(csv|tsv|json)$/i.exec(file.name)![1]!.toLowerCase() }, updated: { at: new Date().toISOString(), by: "You" }, fixed: true } }], attachments: [{ name: file.name, contentType: file.type || "application/octet-stream", base64: base64(bytes) }] }); return id;
    });
  },
  attach(file) { return queue(async () => {
    if (file.size < 1 || file.size > 8 * 1024 * 1024 || !/\.(?:csv|tsv|json|png|jpe?g|webp|gif|svg|woff2?|ttf|otf|txt|md)$/i.test(file.name)) throw new Error(copy().invalidFile);
    await write({ writes: [], attachments: [{ name: file.name, contentType: file.type || "application/octet-stream", base64: base64(new Uint8Array(await file.arrayBuffer())) }] });
  }); },
  deleteFile(id) { return queue(async () => { await write({ writes: [], deleteAssets: [id] }); }); },
  replace(id, file) {
    return queue(async () => {
      if (file.size < 1 || file.size > 8 * 1024 * 1024 || !/\.(csv|tsv|json)$/i.test(file.name)) throw new Error(copy().invalidData);
      const bytes = new Uint8Array(await file.arrayBuffer()), assetId = (await digest(bytes)).slice(0, 32);
      await write({ writes: [{ op: "update", path: "datasets/" + id, data: { source: { url: "/_blob/" + assetId, name: file.name, format: /\.(csv|tsv|json)$/i.exec(file.name)![1]!.toLowerCase() }, updated: { at: new Date().toISOString(), by: "You" } } }], attachments: [{ name: file.name, contentType: file.type || "application/octet-stream", base64: base64(bytes) }] });
    });
  },
  remove(id) { return queue(async () => { await write({ writes: [{ op: "delete", path: "datasets/" + id }] }); }); },
});
const sourceButton = button(copy().sources, () => { sourceRoot.hidden = !sourceRoot.hidden; sourceButton.setAttribute("aria-pressed", String(!sourceRoot.hidden)); if (!sourceRoot.hidden) sources.render(); sendPage({ type: "dashboard:sources", on: !sourceRoot.hidden }); });
const text = element("textarea"); text.setAttribute("aria-label", copy().html); text.spellcheck = false; text.maxLength = 256 * 1024;
text.oninput = () => { dirty = text.value !== editingBaseline; status.textContent = dirty ? copy().unsaved : copy().saved; };
const editButton = button(copy().edit, () => { if (!material) return; if (!dirty) { editingBaseline = String(material.documents["files/index.html"]?.text ?? ""); text.value = editingBaseline; } pageEditor.hidden = false; text.focus(); });
const savePage = button(copy().save, () => { void queue(async () => {
  savePage.disabled = true; const draft = text.value;
  try { await write({ writes: [{ op: "set", path: "files/index.html", data: { text: draft } }] }); editingBaseline = draft; dirty = text.value !== draft; if (!dirty) pageEditor.hidden = true; status.textContent = dirty ? copy().unsaved : copy().saved; }
  catch (cause) { showError(cause instanceof Error ? cause.message : "The page could not be saved. Your draft is retained."); }
  finally { savePage.disabled = false; }
}); });
const discardPage = button(copy().discard, () => { text.value = editingBaseline; dirty = false; failed = false; error.textContent = ""; pageEditor.hidden = true; status.textContent = copy().saved; });
const closePage = button(copy().closeEditor, () => { pageEditor.hidden = true; });
pageEditor.append(element("h2", copy().edit), text); const editControls = element("div", undefined, "dash-row"); editControls.append(closePage, discardPage, savePage); pageEditor.append(editControls);
const historyButton = button(nativeHistoryLabel(), openNativeHistory); historyButton.replaceChildren(dashboardIcon("history")); historyButton.classList.add("dash-icon"); historyButton.setAttribute("aria-label", nativeHistoryLabel()); historyButton.title = nativeHistoryLabel();
const exportButton = button(copy().export, () => (window as Window & { __bottegaNativeProjectExport(): void }).__bottegaNativeProjectExport());
const selectButton = button(copy().select, () => setMode(false));
for (const [control, kind, label] of [[exportButton, "export", copy().export], [selectButton, "select", copy().select], [editButton, "edit", copy().edit], [sourceButton, "sources", copy().sources]] as const) { control.replaceChildren(dashboardIcon(kind)); control.classList.add("dash-icon"); control.setAttribute("aria-label", label); control.title = label; }
const editingTools = element("div", undefined, "dash-tools"); editingTools.append(selectButton, editButton); actions.append(historyButton, exportButton, editingTools, sourceButton);
function localize(locale: unknown) {
  if (typeof locale !== "string" || !["en","zh-CN","ja","es","fr"].includes(locale)) return;
  const previous=copy(),saving=status.textContent===previous.saving; document.documentElement.lang=locale; const next=copy();
  for(const [control,label] of [[exportButton,next.export],[selectButton,next.select],[editButton,next.edit],[sourceButton,next.sources],[historyButton,nativeHistoryLabel()]] as const){control.setAttribute("aria-label",label);control.title=label}
  text.setAttribute("aria-label",next.html);savePage.textContent=next.save;discardPage.textContent=next.discard;closePage.textContent=next.closeEditor;pageEditor.querySelector("h2")!.textContent=next.edit;
  status.textContent=failed?next.notSaved:dirty?next.unsaved:saving?next.saving:material?next.saved:next.loading;
  if(!sourceRoot.hidden)sources.render();paintPins();
}
function setMode(on: boolean) { mode = on; selectButton.setAttribute("aria-pressed", String(!on)); sourceRoot.hidden = true; sendPage({ type: "dashboard:mode", on }); parentPost({ type: "editor:mode", on }); }
function paintPins() {
  document.querySelectorAll("[data-dashboard-pin]").forEach(pin => pin.remove());
  if (!threads.length) return;
  const group = element("div", undefined, "dash-row"); group.dataset.dashboardPin = ""; group.setAttribute("aria-label", copy().comments);
  for (const thread of threads) { const pin = button(String(thread.n), () => { sendPage({ type: "dashboard:reveal", anchor: thread.anchor }); parentPost({ type: "editor:open-thread", id: thread.id }); }, copy().comment + " " + thread.n); pin.dataset.nativeCommentPin = thread.id; group.append(pin); }
  toolbar.append(group);
}
function validateCalculations(raw: unknown) {
  if (!Array.isArray(raw) || raw.length > 128 || new TextEncoder().encode(JSON.stringify(raw)).length > 1024 * 1024) return;
  const next = new Map<string, Calculation>();
  for (const value of raw) {
    if (!value || !/^[A-Za-z0-9_-]{1,64}$/.test(value.id) || material.datasets[value.id] || next.has(value.id) || !Array.isArray(value.inputs) || value.inputs.length > 16 || value.inputs.some((id: unknown) => typeof id !== "string" || !material.datasets[id] && !next.has(id)) || typeof value.formula !== "string" || value.formula.length > 8192 || typeof value.title !== "string" || value.title.length > 200 || typeof value.description !== "string" || value.description.length > 4000 || !["ok", "error"].includes(value.status)) return;
    next.set(value.id, value);
  }
  calculations = next; if (!sourceRoot.hidden) sources.render();
}
window.addEventListener("message", event => {
  if (!event.isTrusted) return; const message = event.data;
  if (event.source === frame.contentWindow && event.origin === "null" && message && typeof message === "object" && material) {
    if (message.type === "dashboard:ready") { loaded = true; sendPage({ type: "dashboard:theme", theme, locale: dashboardLocale() }); sendPage({ type: "dashboard:mode", on: mode }); if (restoring) { sendPage({ type: "dashboard:restore", state: restoring }); restoring = undefined; } parentPost({ type: "bottega:native:content-ready", token, file: "db/files/index.html.json", generation }); return; }
    if (message.type === "dashboard:calculations") { validateCalculations(message.calculations); return; }
    if (message.type === "dashboard:state" && typeof message.requestId === "string") { const pending = stateReads.get(message.requestId); if (pending && new TextEncoder().encode(JSON.stringify(message.state)).length <= 256 * 1024) { clearTimeout(pending.timer); stateReads.delete(message.requestId); pending.resolve(message.state); } return; }
    if (message.type === "dashboard:mode" && typeof message.on === "boolean") { mode = message.on; parentPost({ type: "editor:mode", on: mode }); return; }
    if (message.type === "dashboard:citation" && Array.isArray(message.ids) && message.ids.length <= 16 && message.ids.every((id: unknown) => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id))) {
      const hint: { row?: string; field?: string; where?: string } = {};
      if (typeof message.row === "string" && /^\d{1,6}$/.test(message.row)) hint.row = message.row;
      if (typeof message.field === "string" && message.field.length <= 200) hint.field = message.field;
      if (typeof message.where === "string" && message.where.length <= 2048) hint.where = message.where;
      sourceRoot.hidden = false; sources.select(message.ids, hint); return;
    }
    if (message.type === "dashboard:comment" && mode && typeof message.anchor === "string" && message.anchor.length > 0 && message.anchor.length <= 2048 && typeof message.label === "string" && message.label.length <= 1000 && Number.isFinite(message.point?.x) && Number.isFinite(message.point?.y)) {
      const rect = frame.getBoundingClientRect(); parentPost({ type: "editor:compose", requestId: crypto.randomUUID(), anchor: message.anchor, label: message.label || "Dashboard page", file: "db/files/index.html.json", detail: ("db/files/index.html.json: " + String(message.detail ?? "")).slice(0, 4000), point: { x: rect.x + Math.max(0, Math.min(rect.width, message.point.x)), y: rect.y + Math.max(0, Math.min(rect.height, message.point.y)) } }); return;
    }
    if (message.type === "dashboard:page-error" && typeof message.message === "string") { error.textContent = "Page: " + message.message.slice(0, 500); return; }
    if (message.type === "dashboard:refresh" && typeof message.id === "string" && material.datasets[message.id]) { sourceRoot.hidden = false; sources.select([message.id]); }
    return;
  }
  if (event.source !== window.parent || message?.token !== token) return;
  if (message.type === "editor:set-mode") setMode(message.on === true);
  if (message.type === "editor:threads" && Array.isArray(message.threads) && message.threads.length <= 200) { threads = message.threads; paintPins(); }
  if (message.type === "editor:reveal") { const thread = threads.find(thread => thread.id === message.id); if (thread) sendPage({ type: "dashboard:reveal", anchor: thread.anchor }); }
  if (message.type === "editor:reveal-anchor") sendPage({ type: "dashboard:reveal", anchor: message.anchor });
  if (message.type === "bottega:native:theme" && ["light", "dark"].includes(message.theme)) { theme = message.theme; localize(message.locale); document.documentElement.dataset.theme = theme; sendPage({ type: "dashboard:theme", theme, locale: dashboardLocale() }); }
  if (message.type === "bottega:native:get-content-ready" && loaded) parentPost({ type: "bottega:native:content-ready", token, file: "db/files/index.html.json", generation });
  if (message.type === "bottega:native:adopt-chat") {
    publishing = queue(async () => { if (message.revision <= material.revision) return; if (dirty || failed) throw new Error("Compare the new source before replacing the current draft"); const result = await request("__deck/adopt", { revision: message.revision, snapshotRef: message.snapshotRef }); await refresh(); parentPost({ type: "bottega:native:adopted-chat", token, result }); }).catch(() => parentPost({ type: "bottega:native:adoption-deferred", token }));
  }
  if (message.type === "editor:flush" && typeof message.requestId === "string") {
    finalFlushNonce = typeof message.nonce === "string" ? message.nonce : undefined;
    void publishing.then(() => parentPost({ type: "editor:flushed", requestId: message.requestId, saved: !dirty && !failed }), () => parentPost({ type: "editor:flushed", requestId: message.requestId, saved: false })).finally(() => { finalFlushNonce = undefined; });
  }
});
window.addEventListener("beforeunload", event => { if (dirty || failed) { event.preventDefault(); event.returnValue = ""; } });
window.addEventListener("keydown", event => { if (event.key === "Escape") { setMode(false); sourceRoot.hidden = true; if (!dirty) pageEditor.hidden = true; } });
document.documentElement.dataset.theme = theme;
void refresh().then(async () => { const permission = await nativeFetch(base + "__deck/session"); const editable = permission.ok && (await permission.json()).canEdit === true; editButton.disabled = !editable; parentPost({ type: "editor:ready", canEdit: editable }); }).catch(cause => { showError(cause.message); parentPost({ type: "bottega:native:error", token }); });
