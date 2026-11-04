/**
 * [INPUT]: Immutable current-format source sets, parse5 source locations and closed History selections.
 * [OUTPUT]: File/element/JSON-unit differences and conflict-checked selective restoration preserving unrelated bytes.
 * [POS]: Pure History semantics; no script execution, file access, model invocation or publication.
 */
import { parse } from "parse5";
import { sourcePath } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { HistoryChange, HistorySelection } from "@ai-chat/cloud-protocol/artifacts/design/history/model";
import { designDigest } from "../documents/model";
type File = Readonly<{ path: string; data: Uint8Array }>;
type Unit = { value: string; start?: number; end?: number };
const decode = (data: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(data);
const same = (a: Uint8Array | undefined, b: Uint8Array | undefined) => a === undefined || b === undefined ? a === b : designDigest(a) === designDigest(b);
const pointer = (value: string) => value.replaceAll("~", "~0").replaceAll("/", "~1");
function arrayIdentity(file: string, path: string, value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (file === "tokens.json" && path === "/tokens" || file === "components.json" && path === "/components") return typeof item.name === "string" ? item.name : null;
  if (file === "tokens.json" && path === "/themes") return typeof item.id === "string" ? item.id : null;
  if (file === "aliases.json" && path === "/aliases") return typeof item.name === "string" && typeof item.theme === "string" ? item.name + ":" + item.theme : null;
  return null;
}
function stableArray(file: string, path: string) { return file === "tokens.json" && ["/tokens", "/themes"].includes(path) || file === "aliases.json" && path === "/aliases" || file === "components.json" && path === "/components"; }
function jsonUnits(value: unknown, file: string, path = "", output = new Map<string, Unit>(), depth = 0) {
  if (depth > 32 || output.size > 20000) throw new Error("Semantic source exceeds its unit budget");
  if (Array.isArray(value) && stableArray(file, path)) {
    const identities = new Set<string>();
    for (const item of value) {
      const id = arrayIdentity(file, path, item);
      if (id === null || identities.has(id)) throw new Error("Ambiguous duplicate semantic identity");
      identities.add(id); const child = path + "/@" + pointer(id);
      output.set("json:" + child, { value: JSON.stringify(item) }); jsonUnits(item, file, child, output, depth + 1);
    }
  } else if (/^db\/datasets\//.test(file) && path === "/source") output.set("json:" + path, { value: JSON.stringify(value) });
  else if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) {
    for (const [key, child] of Object.entries(value)) jsonUnits(child, file, path + "/" + pointer(key), output, depth + 1);
  } else output.set("json:" + path, { value: JSON.stringify(value) });
  return output;
}
function htmlUnits(text: string) {
  const result = new Map<string, Unit>(), duplicates = new Set<string>();
  type Node = { attrs?: { name: string; value: string }[]; sourceCodeLocation?: { startOffset: number; endOffset: number } | null; childNodes?: Node[]; content?: Node };
  const walk = (node: Node) => {
    const id = node.attrs?.find((attribute: { name: string; value: string }) => ["id", "data-dc-id"].includes(attribute.name))?.value;
    if (id && id.length <= 220 && node.sourceCodeLocation?.startOffset !== undefined && node.sourceCodeLocation?.endOffset !== undefined) {
      const key = "element:" + id, { startOffset: start, endOffset: end } = node.sourceCodeLocation;
      if (result.has(key)) duplicates.add(key);
      result.set(key, { value: text.slice(start, end), start, end });
    }
    for (const child of node.childNodes ?? []) walk(child);
    if (node.content) walk(node.content);
  };
  walk(parse(text, { sourceCodeLocationInfo: true }));
  for (const key of duplicates) result.set(key, { value: "", start: -1, end: -1 });
  return result;
}
function units(file: File | undefined) {
  if (!file) return new Map<string, Unit>();
  if (file.path.endsWith(".json")) return jsonUnits(JSON.parse(decode(file.data)), file.path);
  if (file.path.endsWith(".html")) return htmlUnits(decode(file.data));
  return new Map<string, Unit>();
}
const family = (path: string, unit?: string): HistoryChange["family"] => unit?.startsWith("element:") ? "element" :
  path.includes("datasets/") ? "dataset" : /tokens|aliases/.test(path) && unit ? "token" : /deck\.json/.test(path) && unit ? "page" : path.startsWith("db/") ? "document" : "file";
export function historyChanges(before: readonly File[], after: readonly File[]): HistoryChange[] {
  const a = new Map(before.map(file => [file.path, file])), b = new Map(after.map(file => [file.path, file]));
  const changes: HistoryChange[] = [];
  for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const left = a.get(path), right = b.get(path); if (same(left?.data, right?.data)) continue;
    changes.push({ path, family: family(path), kind: !left ? "added" : !right ? "removed" : "changed", before: left ? designDigest(left.data) : null, after: right ? designDigest(right.data) : null });
    const x = units(left), y = units(right);
    for (const unit of [...new Set([...x.keys(), ...y.keys()])].sort()) {
      const from = x.get(unit), to = y.get(unit); if (from?.value === to?.value || from?.start === -1 || to?.start === -1) continue;
      changes.push({ path, unit, family: family(path, unit), kind: !from ? "added" : !to ? "removed" : "changed", before: from ? designDigest(from.value) : null, after: to ? designDigest(to.value) : null });
    }
  }
  return changes;
}
export function historyUnitText(files: readonly File[], selection: HistorySelection): string | null {
  const file = files.find(file => file.path === selection.path); if (!file) return null;
  if (!selection.unit) { try { return decode(file.data); } catch { return `[Binary file: ${file.data.byteLength} bytes; ${designDigest(file.data)}]`; } }
  const value = units(file).get(selection.unit); if (value?.start === -1) throw new Error("Ambiguous duplicate element identity");
  return value?.value ?? null;
}
function jsonRestore(current: string, file: string, unit: string, desired: string | undefined) {
  const parts = unit.slice(5).split("/").slice(1).map(value => value.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (!parts.length || parts.some(value => ["__proto__", "prototype", "constructor"].includes(value))) throw new Error("Invalid JSON unit path");
  const root = JSON.parse(current); let parent = root, path = "";
  const index = (array: unknown[], part: string, at: string) => {
    if (!stableArray(file, at) || !part.startsWith("@")) throw new Error("Selected JSON array has no stable identity");
    const found = array.flatMap((item, i) => arrayIdentity(file, at, item) === part.slice(1) ? [i] : []);
    if (found.length > 1) throw new Error("Ambiguous duplicate semantic identity"); return found[0] ?? -1;
  };
  for (const part of parts.slice(0, -1)) {
    if (Array.isArray(parent)) { const i = index(parent, part, path); if (i < 0) throw new Error("Selected JSON parent is missing"); parent = parent[i]; }
    else { if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, part)) throw new Error("Selected JSON parent is missing"); parent = parent[part]; }
    path += "/" + pointer(part);
  }
  const key = parts.at(-1)!;
  if (Array.isArray(parent)) {
    const i = index(parent, key, path);
    if (desired === undefined) { if (i >= 0) parent.splice(i, 1); }
    else { const item = JSON.parse(desired); if (arrayIdentity(file, path, item) !== key.slice(1)) throw new Error("Restored array identity changed"); if (i < 0) parent.push(item); else parent[i] = item; }
  } else {
    if (!parent || typeof parent !== "object") throw new Error("Selected JSON parent is missing");
    if (desired === undefined) delete parent[key]; else parent[key] = JSON.parse(desired);
  }
  return JSON.stringify(root, null, 2) + "\n";
}
export function restoreHistorySelection(target: readonly File[], compared: readonly File[], current: readonly File[], selections: readonly HistorySelection[]) {
  if (!selections.length || selections.length > 32) throw new Error("Invalid History selection budget");
  for (const [index, selection] of selections.entries()) {
    sourcePath.parse(selection.path);
    if (selections.slice(index + 1).some(other => other.path === selection.path && (!selection.unit || !other.unit || selection.unit === other.unit || selection.unit.startsWith(other.unit + "/") || other.unit.startsWith(selection.unit + "/")))) throw new Error("Overlapping History selections");
  }
  const output = new Map(current.map(file => [file.path, { path: file.path, data: file.data.slice() }]));
  const selected: { path: string; unit?: string; start?: number; end?: number }[] = [];
  for (const selection of selections) {
    sourcePath.parse(selection.path);
    if (selected.some(value => value.path === selection.path && (!value.unit || !selection.unit || value.unit === selection.unit ||
      value.unit.startsWith(selection.unit + "/") || selection.unit.startsWith(value.unit + "/")))) throw new Error("Overlapping History selections");
    const desired = target.find(file => file.path === selection.path), base = compared.find(file => file.path === selection.path), live = current.find(file => file.path === selection.path);
    if (!selection.unit) {
      if (!same(base?.data, live?.data)) throw new Error("History conflict: selected file changed after comparison");
      if (!desired && !base) throw new Error("Selected History file is missing");
      if (desired) output.set(selection.path, { path: selection.path, data: desired.data.slice() }); else output.delete(selection.path);
      selected.push(selection); continue;
    }
    const left = units(desired).get(selection.unit), seen = units(base).get(selection.unit), right = units(live).get(selection.unit);
    if ([left, seen, right].some(value => value?.start === -1)) throw new Error("Ambiguous duplicate element identity");
    if (!left && !seen) throw new Error("Selected History unit is missing");
    if (seen?.value !== right?.value) throw new Error("History conflict: selected unit changed after comparison");
    const draft = output.get(selection.path); if (!draft || !live) throw new Error("Selected History source is missing");
    if (selection.unit.startsWith("json:")) draft.data = new TextEncoder().encode(jsonRestore(decode(draft.data), selection.path, selection.unit, left?.value));
    else if (selection.unit.startsWith("element:")) {
      if (!left || !right || right.start === undefined || right.end === undefined) throw new Error("Selected element is missing; restore its complete file");
      if (selected.some(value => value.path === selection.path && value.start !== undefined && value.start < right.end! && value.end! > right.start!)) throw new Error("Overlapping History elements");
      selected.push({ ...selection, start: right.start, end: right.end }); continue;
    } else throw new Error("Unsupported History semantic unit");
    selected.push(selection);
  }
  for (const path of new Set(selected.filter(value => value.start !== undefined).map(value => value.path))) {
    let text = decode(output.get(path)!.data);
    for (const item of selected.filter(value => value.path === path && value.start !== undefined).sort((a, b) => b.start! - a.start!)) {
      const desired = units(target.find(file => file.path === path)).get(item.unit!)!;
      text = text.slice(0, item.start) + desired.value + text.slice(item.end);
    }
    output.get(path)!.data = new TextEncoder().encode(text);
  }
  return [...output.values()].sort((a, b) => a.path.localeCompare(b.path));
}
