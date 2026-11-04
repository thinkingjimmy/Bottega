/**
 * [INPUT]: Immutable native source, parse5/PostCSS data parsers and original source-backed anchor identities.
 * [OUTPUT]: Independent target digests and confirmed per-target source effects without authored execution.
 * [POS]: Original Chat target evidence; unknown broad annotations cannot acquire an individual applied result.
 */
import { parse, type DefaultTreeAdapterMap } from "parse5";
import postcss from "postcss";
import { cssReferences } from "../documents/resources/css";
import { designDigest } from "../documents/model";
type Files = readonly { path: string; data: Uint8Array }[];
type Target = { file?: string; anchor: string };
type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const text = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const attr = (node: Element, name: string) => node.attrs.find(value => value.name === name)?.value;
const element = (node: Node): node is Element => "tagName" in node;
function nodes(root: Node) {
  const result: Element[] = [];
  const visit = (node: Node) => { if (result.length > 100_000) throw new Error("Native target exceeds its node budget"); if (element(node)) result.push(node); if ("childNodes" in node) for (const child of node.childNodes) visit(child); };
  visit(root); return result;
}
const parent = (node: Element) => node.parentNode && element(node.parentNode) ? node.parentNode : undefined;
function simple(node: Element, raw: string) {
  let value = raw.replace(/::?(?:before|after|hover|focus-visible|focus|active|visited|disabled|checked)\b/g, "");
  if (value === ":root") return node.tagName === "html";
  const nth = /:nth-of-type\(([1-9][0-9]{0,3})\)$/.exec(value); if (nth) {
    value = value.slice(0, nth.index); const siblings = node.parentNode && "childNodes" in node.parentNode ? node.parentNode.childNodes.filter((child): child is Element => element(child) && child.tagName === node.tagName) : [];
    if (siblings.indexOf(node) + 1 !== Number(nth[1])) return false;
  }
  const tag = /^(?:[a-z][a-z0-9-]*|\*)/i.exec(value)?.[0]; if (tag) { if (tag !== "*" && node.tagName !== tag.toLowerCase()) return false; value = value.slice(tag.length); }
  while (value) {
    const part = /^([.#])([A-Za-z_][A-Za-z0-9_-]*)/.exec(value); if (!part) return false;
    if (part[1] === "#" ? attr(node, "id") !== part[2] : !(attr(node, "class") ?? "").split(/\s+/).includes(part[2]!)) return false;
    value = value.slice(part[0].length);
  }
  return Boolean(tag || raw.startsWith("#") || raw.startsWith("."));
}
function matches(node: Element, selector: string) {
  const parts = selector.trim().split(/\s*(>)\s*|\s+/).filter(Boolean); let index = parts.length - 1, current: Element | undefined = node;
  if (!parts.length || parts.length > 24 || !simple(node, parts[index]!)) return false;
  while (index > 0) {
    index--; current = current && parent(current);
    if (parts[index] === ">") { index--; if (!current || index < 0 || !simple(current, parts[index]!)) return false; }
    else { while (current && !simple(current, parts[index]!)) current = parent(current); if (!current) return false; }
  }
  return true;
}
function htmlUnit(files: Files, file: string, raw: string, anchor: string): string | undefined {
  // Original Canvas suffixes encode runtime fingerprints, template IDs and pointer coordinates, not source elements.
  const path = anchor.split(" > "), virtual = path.findIndex(value => /^(?:dcf[0-9a-z]+|dct|dc[eancgbodpr][0-9a-z]*):nth-of-type\([1-9][0-9]{0,3}\)$/.test(value));
  const selector = (virtual < 0 ? path : path.slice(0, virtual)).join(" > "); if (!selector || selector === "document") return;
  const all = nodes(parse(raw, { sourceCodeLocationInfo: true })), found = all.filter(node => matches(node, selector));
  if (found.length > 1) throw new Error("Ambiguous duplicate native source target");
  const selected = found[0], location = selected?.sourceCodeLocation; if (!selected || !location || location.endOffset === undefined) return;
  const related = new Set(nodes(selected)); let ancestor = parent(selected);
  const ancestors: unknown[] = [];
  while (ancestor) { related.add(ancestor); ancestors.push([ancestor.tagName, ancestor.attrs]); ancestor = parent(ancestor); }
  const styles = all.filter(node => node.tagName === "style").map(node => node.childNodes.map(child => "value" in child ? child.value : "").join(""));
  const included = new Set<string>();
  const includeStyle = (value: string, from: string) => {
    const url = new URL(value, "https://project.invalid/" + from); if (url.origin !== "https://project.invalid") return;
    const path = decodeURIComponent(url.pathname.slice(1)); if (included.has(path)) return;
    const source = files.find(value => value.path === path); if (!source) return;
    included.add(path); const css = text(source.data); styles.push(css);
    for (const reference of cssReferences(css)) if (/\.css(?:[?#]|$)/i.test(reference.url)) includeStyle(reference.url, path);
  };
  for (const node of all) if (node.tagName === "link" && (attr(node, "rel") ?? "").split(/\s+/).includes("stylesheet")) { const href = attr(node, "href"); if (href) includeStyle(href, file); }
  for (const css of [...styles]) for (const reference of cssReferences(css)) if (/\.css(?:[?#]|$)/i.test(reference.url)) includeStyle(reference.url, file);
  const rules: string[] = [];
  for (const source of styles) postcss.parse(source).walkRules(rule => {
    if (rule.selector.split(",").some(value => [...related].some(node => matches(node, value)))) rules.push(rule.toString());
  });
  return JSON.stringify([file, raw.slice(location.startOffset, location.endOffset), ancestors, rules]);
}
// Exact maintained commentTargetId encoding, including sanitized and shortened original names.
function systemId(prefix: string, name: string) {
  const available = 63 - prefix.length, safe = name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (safe === name && name && name.length <= available) return prefix + "-" + name;
  let hash = 2166136261; for (let index = 0; index < name.length; index++) hash = Math.imul(hash ^ name.charCodeAt(index), 16777619) >>> 0;
  const first = safe.slice(0, available - 8).replace(/-+$/, ""); return prefix + "-" + (first ? first + "-" : "") + hash.toString(36).padStart(7, "0").slice(-7);
}
function systemUnit(files: Files, anchor: string): string | undefined {
  const id = decodeURIComponent(anchor.slice(7)), json = (path: string) => { const file = files.find(file => file.path === path); return file ? JSON.parse(text(file.data)) : undefined; };
  const tokens = json("tokens.json"), components = json("components.json"), aliases = json("aliases.json");
  const found: unknown[] = [];
  for (const token of tokens?.tokens ?? []) {
    const ids = ["token", "style"].map(prefix => systemId(prefix, token.name));
    for (const theme of tokens.themes ?? []) ids.push(systemId("cell", token.name + ":" + theme.id), systemId("picker", token.name + ":" + theme.id));
    if (ids.includes(id)) found.push([token, (aliases?.aliases ?? []).filter((value: { name: string; target: string }) => value.name === token.name || value.target === token.name)]);
  }
  for (const component of components?.components ?? []) if (["comp", "props"].some(prefix => systemId(prefix, component.name) === id)) {
    const paths = new Set([component.bundle, component.preview, component.dc?.bundle, component.dc?.preview].filter((value): value is string => typeof value === "string"));
    found.push([component, files.filter(value => paths.has(value.path)).map(value => [value.path, designDigest(value.data)])]);
  }
  if (found.length > 1) throw new Error("Ambiguous duplicate System target identity");
  return found.length ? JSON.stringify(found[0]) : undefined;
}
function targetUnit(files: Files, file?: string, anchor?: string) {
  if (!file || !anchor || anchor === "document") return;
  const source = files.find(value => value.path === file); if (!source) return;
  if (anchor.startsWith("system:")) return systemUnit(files, anchor);
  if (file.endsWith(".html")) return htmlUnit(files, file, text(source.data), anchor);
  if (/^db\/files\/.+\.html\.json$/.test(file)) { const value = JSON.parse(text(source.data)); if (typeof value.text === "string") return htmlUnit(files, file, value.text, anchor); }
}
export function nativeTargetDigest(files: Files, file?: string, anchor?: string) {
  const selected = files.filter(value => file ? value.path === file : value.path !== "comments.json");
  if (!selected.length) throw new Error("Native target source is missing");
  const unit = targetUnit(files, file, anchor);
  return designDigest(unit ?? JSON.stringify(selected.map(value => [value.path, designDigest(value.data)]).sort((a, b) => a[0]!.localeCompare(b[0]!))));
}
export function nativeTargetChanged(before: Files, after: Files, target: Target) {
  const original = targetUnit(before, target.file, target.anchor);
  return original !== undefined && original !== targetUnit(after, target.file, target.anchor);
}
