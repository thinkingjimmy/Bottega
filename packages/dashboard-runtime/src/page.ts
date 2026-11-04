/**
 * [INPUT]: Host-issued fixed table data and bounded messages from the exact parent page host.
 * [OUTPUT]: Read-only dash data/calculation/filter SDK, redraws, inert source citations and annotation facts.
 * [POS]: Opaque authored-page runtime; it has no native token, host database, file or network capability.
 */
type Table = { id: string; status: "ok"; columns: string[]; data: Record<string, string>[]; meta: { title: string } };
type Calc = { inputs: string[]; fn: (...rows: unknown[]) => unknown; title: string; description: string; formula: string };
const initial = JSON.parse(document.getElementById("bottega-dashboard-data")?.textContent ?? "{}");
const plainParam = (value: unknown): boolean => value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) || typeof value === "string" && value.length <= 4096 && !/[\r\n]/.test(value);
function validParams(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value).slice(0, 64).filter(([key, item]) => key.length > 0 && key.length <= 200 && !["__proto__", "constructor", "prototype"].includes(key) && (plainParam(item) || Array.isArray(item) && item.length <= 128 && item.every(plainParam)));
  const result = Object.fromEntries(entries); if (new TextEncoder().encode(JSON.stringify(result)).length > 8192) throw new Error("The page filters exceed their data budget"); return result;
}
let datasets: Record<string, Table> = initial.datasets ?? {}, defaults = validParams(initial.defaults), params: Record<string, unknown> = structuredClone(defaults), mode = false, sources = false;
let theme = "light", drawing = false, pending = false;
const calcs = new Map<string, Calc>(), results = new Map<string, Record<string, unknown>>(), handlers = new Set<() => void>();
const send = window.parent.postMessage.bind(window.parent), post = (value: unknown) => send(value, "*");
const clone = <T>(value: T): T => structuredClone(value);
const safe = (value: unknown, bytes = 256 * 1024) => { const text = JSON.stringify(value); if (typeof text !== "string" || new TextEncoder().encode(text).length > bytes) throw new Error("The page value exceeds its data budget"); return JSON.parse(text); };
function data(id: string): Record<string, unknown> {
  const table = datasets[id];
  if (table) return { status: "ok", data: clone(table.data), rows: clone(table.data), columns: [...table.columns], meta: [], refreshing: false };
  return clone(results.get(id) ?? { status: "missing", data: [], rows: [], message: "This source is missing", meta: [] });
}
function calculate(id: string, active: Set<string>): Record<string, unknown> {
  if (results.has(id)) return results.get(id)!;
  const calc = calcs.get(id);
  if (!calc || active.has(id)) return { status: "error", data: [], message: "A calculation input is missing or cyclic" };
  active.add(id);
  try {
    const inputs = calc.inputs.map(input => {
      const value = datasets[input] ? data(input) : calculate(input, active);
      if (value.status !== "ok") throw new Error("A calculation input did not load"); return clone(value.data);
    });
    const value = safe(calc.fn(...inputs));
    const result = { status: "ok", data: value, value, rows: Array.isArray(value) ? value : [], meta: [], refreshing: false };
    results.set(id, result); return result;
  } catch (cause) { const result = { status: "error", data: [], message: cause instanceof Error ? cause.message.slice(0, 500) : "Calculation failed" }; results.set(id, result); return result; }
  finally { active.delete(id); }
}
function marks() {
  for (const element of document.querySelectorAll<HTMLElement>("[data-source]")) {
    const ids = (element.dataset.source ?? "").split(/\s+/).filter(Boolean), states = ids.map(id => data(id));
    const state = states.some(value => value.status !== "ok") ? "error" : /^(?:|—|–|-)$/.test(element.textContent?.trim() ?? "") ? "empty" : "ok";
    if (state === "ok") delete element.dataset.dashSourceState; else element.dataset.dashSourceState = state;
  }
}
function redraw() {
  if (drawing) { pending = true; return; } drawing = true; results.clear();
  try {
    for (const id of calcs.keys()) calculate(id, new Set());
    for (const handler of handlers) { try { handler(); } catch (cause) { post({ type: "dashboard:page-error", message: cause instanceof Error ? cause.message.slice(0, 500) : "Page redraw failed" }); } }
    marks();
    post({ type: "dashboard:calculations", calculations: [...calcs].map(([id, calc]) => ({ id, inputs: calc.inputs, title: calc.title, description: calc.description, formula: calc.formula, ...results.get(id) })) });
  } finally { drawing = false; if (pending) { pending = false; requestAnimationFrame(redraw); } }
}
function setParams(value: Record<string, unknown>) {
  if (!value || Array.isArray(value) || typeof value !== "object" || Object.keys(value).length > 64 || Object.keys(value).some(key => ["__proto__", "constructor", "prototype"].includes(key))) throw new Error("Invalid page filters");
  params = safe({ ...params, ...validParams(value) }, 8192); redraw();
}
const api = Object.freeze({
  data, onData(handler: () => void) { if (typeof handler !== "function" || handlers.size >= 128) throw new Error("Invalid data listener"); handlers.add(handler); redraw(); return () => handlers.delete(handler); },
  calc(id: string, value: Omit<Calc, "formula">) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || datasets[id] || calcs.has(id) || calcs.size >= 128 || !Array.isArray(value.inputs) || value.inputs.length > 16 || value.inputs.some(input => !/^[A-Za-z0-9_-]{1,64}$/.test(input)) || typeof value.fn !== "function" || typeof value.title !== "string" || value.title.length > 200 || typeof value.description !== "string" || value.description.length > 4000) throw new Error("Invalid page calculation");
    const formula = Function.prototype.toString.call(value.fn); if (formula.length > 8192) throw new Error("The calculation formula exceeds its budget"); calcs.set(id, { ...value, formula }); results.clear();
  },
  params: () => clone(params), setParams, resetParams() { params = clone(defaults); redraw(); }, setLink(name: string) { setParams({ page: String(name).slice(0, 200) }); },
  get colors() { const style = getComputedStyle(document.documentElement); return [1, 2, 3, 4, 5].map(index => style.getPropertyValue("--chart-" + index).trim()); },
  refresh(id: string) { if (datasets[id] || calcs.has(id)) post({ type: "dashboard:refresh", id }); },
});
Object.defineProperty(window, "dash", { value: api });
const style = document.createElement("style"); style.textContent = '[data-dash-source-state="error"]{outline:1px dashed #c84444}[data-dashboard-mark-mode] [data-source]{outline:1px dashed #6094bb;cursor:help}html[data-dashboard-comment-mode]{cursor:crosshair}'; document.head.append(style);
function setMode(on: boolean) { mode = on; document.documentElement.toggleAttribute("data-dashboard-comment-mode", on); post({ type: "dashboard:mode", on }); }
function reveal(anchor: string) {
  try { const element = document.querySelector<HTMLElement>(anchor); element?.scrollIntoView({ block: "center", behavior: "smooth" }); if (element) { const before = element.style.outline; element.style.outline = "2px solid #3868f9"; setTimeout(() => { element.style.outline = before; }, 2000); } } catch { /* Invalid retained selectors stay inert. */ }
}
function selector(element: Element) {
  if (element.id) return "#" + CSS.escape(element.id);
  const steps = []; let current: Element | null = element;
  while (current && current.tagName !== "BODY" && steps.length < 8) {
    if (current.id) { steps.unshift("#" + CSS.escape(current.id)); break; }
    const name = current.tagName.toLowerCase(), siblings = current.parentElement ? [...current.parentElement.children].filter(child => child.tagName === current!.tagName) : [current];
    steps.unshift(name + (siblings.length > 1 ? ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")" : "")); current = current.parentElement;
  }
  return steps.join(" > ");
}
window.addEventListener("message", event => {
  if (!event.isTrusted || event.source !== window.parent) return;
  const message = event.data;
  if (message?.type === "dashboard:data" && message.datasets && typeof message.datasets === "object") {
    datasets = message.datasets; const next = validParams(message.defaults);
    for (const key of new Set([...Object.keys(defaults), ...Object.keys(next)])) if (JSON.stringify(params[key]) === JSON.stringify(defaults[key])) { if (Object.hasOwn(next, key)) params[key] = next[key]; else delete params[key]; }
    defaults = next; redraw();
  }
  if (message?.type === "dashboard:theme" && ["light", "dark"].includes(message.theme)) { theme = message.theme; if(["en","zh-CN","ja","es","fr"].includes(message.locale))document.documentElement.lang=message.locale; document.documentElement.dataset.mode = theme; document.documentElement.style.colorScheme = theme; redraw(); }
  if (message?.type === "dashboard:sources") { sources = message.on === true; document.documentElement.toggleAttribute("data-dashboard-mark-mode", sources); }
  if (message?.type === "dashboard:mode") setMode(message.on === true);
  if (message?.type === "dashboard:reveal" && typeof message.anchor === "string" && message.anchor.length <= 2048) reveal(message.anchor);
  if (message?.type === "dashboard:capture") {
    const controls = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input[id],textarea[id],select[id]")].slice(0, 128).filter(element => !["file", "password", "hidden"].includes(element.type)).map(element => ({ id: element.id.slice(0, 200), value: element.value.slice(0, 4096), checked: element instanceof HTMLInputElement ? element.checked : undefined }));
    post({ type: "dashboard:state", requestId: message.requestId, state: safe({ params, x: scrollX, y: scrollY, controls }, 256 * 1024) });
  }
  if (message?.type === "dashboard:restore" && message.state) {
    try { params = safe(message.state.params ?? {}, 8192); redraw();
      for (const control of (message.state.controls ?? []).slice(0, 128)) { const element = document.getElementById(control.id); if (element instanceof HTMLInputElement && !["file", "password", "hidden"].includes(element.type) || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) { element.value = String(control.value).slice(0, 4096); if (element instanceof HTMLInputElement && typeof control.checked === "boolean") element.checked = control.checked; } }
      scrollTo(Number(message.state.x) || 0, Number(message.state.y) || 0);
    } catch { post({ type: "dashboard:page-error", message: "The page input state could not be restored" }); }
  }
});
window.addEventListener("keydown", event => {
  if (event.key === "Escape") { setMode(false); return; }
  const target = event.target as HTMLElement;
  if (!target.isContentEditable && !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && event.key.toLowerCase() === "c" && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); setMode(!mode); }
}, true);
document.addEventListener("click", event => {
  if (!(event.target instanceof Element)) return;
  if (mode) {
    const target = event.target.closest("[id],[data-source],h1,h2,h3,article,section,table") ?? event.target;
    event.preventDefault(); event.stopImmediatePropagation(); const rect = target.getBoundingClientRect();
    post({ type: "dashboard:comment", anchor: selector(target), label: (target.textContent ?? target.tagName).trim().slice(0, 200), detail: target.outerHTML.slice(0, 1000), point: { x: event.clientX, y: event.clientY }, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }); return;
  }
  if (sources) {
    const target = event.target.closest<HTMLElement>("[data-source]"); if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const cell = event.target.closest<HTMLTableCellElement>("td"), table = cell?.closest<HTMLTableElement>("table[data-source][data-row-key]"), row = cell?.parentElement;
    if (table && row instanceof HTMLTableRowElement) {
      try {
        const keys = (table.dataset.rowKey ?? "").split(",").map(value => value.trim()), headers = [...(table.tHead?.rows[table.tHead.rows.length - 1]?.cells ?? [])];
        if (!keys.length || keys.length > 2 || new Set(keys).size !== keys.length || headers.some(value => value.colSpan !== 1) || cell.colSpan !== 1) throw new Error("The table citation has ambiguous columns");
        const values = row.dataset.key === undefined ? keys.map(key => { const positions = headers.flatMap((value, index) => value.dataset.field === key ? [index] : []); if (positions.length !== 1) throw new Error("The table key column is missing or ambiguous"); return row.cells[positions[0]!]?.textContent ?? ""; }) : keys.length === 1 ? [row.dataset.key] : row.dataset.key.split(",").map(value => decodeURIComponent(value));
        if (values.length !== keys.length) throw new Error("The table citation key is incomplete");
        const header = headers[cell.cellIndex], ids = (header?.dataset.source ?? table.dataset.source ?? "").split(/\s+/).filter(Boolean).slice(0, 16), where = new URLSearchParams(keys.map((key, index) => [key, values[index]!]));
        for (const id of ids) { const result = data(id), rows = result.data; if (result.status !== "ok" || !Array.isArray(rows) || rows.filter(value => value && keys.every((key, index) => String(value[key] ?? "") === values[index])).length !== 1) throw new Error("The table key must name exactly one fixed source row"); }
        if (!ids.length) throw new Error("The table citation has no source"); post({ type: "dashboard:citation", ids, field: header?.dataset.field, where: where.toString() });
      } catch (cause) { post({ type: "dashboard:page-error", message: cause instanceof Error ? cause.message : "The table citation could not be resolved" }); }
      return;
    }
    post({ type: "dashboard:citation", ids: (target.dataset.source ?? "").split(/\s+/).filter(Boolean).slice(0, 16), field: target.dataset.field, row: target.dataset.row, where: target.dataset.where });
  }
}, true);
window.addEventListener("error", event => post({ type: "dashboard:page-error", message: String(event.message).slice(0, 500) }));
window.addEventListener("unhandledrejection", event => post({ type: "dashboard:page-error", message: String(event.reason?.message ?? event.reason).slice(0, 500) }));
let resize = 0; window.addEventListener("resize", () => { cancelAnimationFrame(resize); resize = requestAnimationFrame(redraw); });
const ready = () => { post({ type: "dashboard:ready" }); redraw(); };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true }); else ready();
