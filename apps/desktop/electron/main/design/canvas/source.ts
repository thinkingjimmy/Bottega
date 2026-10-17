/**
 * [INPUT]: Immutable original HTML, main-resolved anchors and closed literal source edits.
 * [OUTPUT]: Verified source capabilities and narrow text/style/link/list/position span changes.
 * [POS]: Inert Canvas source adapter; DOM hints and authored scripts never authorize source edits.
 */
import { parse, type DefaultTreeAdapterTypes as Tree } from "parse5";
import postcss from "postcss";
import { locateDesignElement, resolveDesignAnchor } from "@ai-chat/cloud-protocol/artifacts/design/anchors";
import type { DesignAnchor } from "@ai-chat/cloud-protocol/artifacts/design/review";
import { DESIGN_PROPERTIES, validDesignProperty } from "@ai-chat/cloud-protocol/artifacts/design/canvas/model";
import type { CanvasTarget, CanvasOperation } from "@ai-chat/cloud-protocol/artifacts/design/canvas/commands";
import { DesignDocumentError } from "../documents/model";
import { escapeCanvasText } from "@ai-chat/cloud-protocol/artifacts/design/canvas/markup";
type Element = Tree.Element;
const attribute = (node: Element, key: string) => node.attrs.find(value => value.name === key)?.value;
const textOf = (node: Tree.Node): string => "value" in node ? node.value : "childNodes" in node ? node.childNodes.map(textOf).join("") : "";
const direct = (node: Element) => node.childNodes.every(child => "value" in child);
const plainList = (node: Element) => ["ul", "ol"].includes(node.tagName) && node.childNodes.every(child =>
  "value" in child ? !child.value.trim() : "tagName" in child && child.tagName === "li" && !child.attrs.length && direct(child));
const textTags = new Set("p div h1 h2 h3 h4 h5 h6 span a li dt dd td th blockquote label button figcaption caption code pre em strong b i u small mark".split(" "));
const listTags = new Set("p div h1 h2 h3 h4 h5 h6 blockquote ul ol".split(" "));
function styleRule(node: Element) {
  const rule = postcss.parse("x{" + (attribute(node, "style") ?? "") + "}").first;
  if (!rule || rule.type !== "rule" || rule.nodes.some(value => value.type !== "decl" && value.type !== "comment")) throw new Error("Inline style cannot be edited safely");
  return rule;
}
function styles(node: Element) {
  const values: Record<string, string> = {};
  for (const value of styleRule(node).nodes) if (value.type === "decl") values[value.prop.toLowerCase()] = value.value;
  return values;
}
function sourceStatic(html: string, node: Element) {
  const root = parse(html); let scripted = false;
  const visit = (value: Tree.Node) => { if ("tagName" in value && (value.tagName === "script" && !["application/json", "application/ld+json"].includes(attribute(value, "type") ?? "") || value.attrs.some(value => value.name.startsWith("on")))) scripted = true;
    if ("childNodes" in value) for (const child of value.childNodes) visit(child); };
  visit(root);
  if (scripted) throw new Error("Script-controlled source cannot be proved static. Use the Agent for this target.");
  for (let current: Tree.Node | null = node; current; current = "parentNode" in current ? current.parentNode : null) if ("tagName" in current) {
    if (current.tagName.includes("-") || ["template", "script", "style", "iframe", "canvas", "svg"].includes(current.tagName) || current.attrs.some(value => !/^[a-z_][a-z\d_.:-]*$/i.test(value.name) || /^(?:data-(?:props|component|bottega-dynamic)|v-|x-|:|@)/.test(value.name) || /\{\{|\$\{/.test(value.value)))
      throw new Error("Component or dynamic source is not a literal editable target. Use the Agent.");
  }
  if (/\{\{|\$\{/.test(textOf(node))) throw new Error("Template text is not directly editable. Use the Agent.");
  if (attribute(node, "data-bottega-object")) throw new Error("Edit this Canvas object through its object command.");
}
function positioned(node: Element, html: string) {
  const values = styles(node);
  if (!["absolute", "fixed"].includes(values.position ?? "") || !["left", "top"].every(key => /^-?(?:\d+(?:\.\d+)?|\.\d+)px$/.test(values[key] ?? "")) || values.right || values.bottom) return false;
  const queue: Tree.Node[] = [parse(html)];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!;
    if ("tagName" in current) {
      if (current.tagName === "link" && (attribute(current, "rel") ?? "").toLowerCase().split(/\s+/).includes("stylesheet")) return false;
      if (current.tagName === "style") {
        let unsafe = false; const sheet = postcss.parse(textOf(current));
        sheet.walkAtRules(rule => { if (["media", "supports", "keyframes", "import"].includes(rule.name.toLowerCase())) unsafe = true; });
        sheet.walkDecls(value => { if (["transform", "rotate", "scale", "translate", "perspective"].includes(value.prop.toLowerCase()) || value.important && ["position", "left", "top", "right", "bottom", "width", "height"].includes(value.prop.toLowerCase())) unsafe = true; });
        if (unsafe) return false;
      }
    }
    if ("childNodes" in current) queue.push(...current.childNodes);
  }
  for (let current: Tree.Node | null = node; current; current = "parentNode" in current ? current.parentNode : null) if ("tagName" in current) {
    const value = styles(current);
    if (["transform", "rotate", "scale", "translate", "perspective"].some(key => value[key] && value[key] !== "none")) return false;
    // Stylesheet layout/transform cannot be inferred from a computed frame hint.
    if (attribute(current, "class")) return false;
  }
  return true;
}
export function inspectCanvasSource(html: string, anchor: DesignAnchor): CanvasTarget {
  const base: CanvasTarget = { anchor, editable: false, reason: null, properties: [], values: {}, text: false, typography: false, geometry: false, link: false, list: false };
  try {
    if (!anchor.selector || !/^#[A-Za-z_][A-Za-z0-9_-]*$/.test(anchor.selector)) throw new Error("Direct editing requires a unique stable source ID. Select a source target or use the Agent.");
    base.anchor = resolveDesignAnchor(html, anchor).anchor;
    const node = locateDesignElement(html, anchor); sourceStatic(html, node);
    const values = styles(node), leaf = direct(node), list = plainList(node);
    base.editable = true; base.text = leaf && textTags.has(node.tagName) || list;
    base.typography = base.text; base.geometry = positioned(node, html);
    base.link = leaf && textTags.has(node.tagName) && node.tagName !== "button" && node.tagName !== "li";
    base.list = listTags.has(node.tagName) && (leaf || list);
    base.listMode = list ? node.tagName === "ol" ? "ordered" : "unordered" : "none";
    base.href = node.tagName === "a" ? attribute(node, "href") ?? null : null;
    base.properties = DESIGN_PROPERTIES.filter(key => key === "text" ? base.text : ["left", "top"].includes(key) ? base.geometry :
      ["color", "background-color", "padding", "gap", "width", "height"].includes(key) || base.typography);
    base.values = Object.fromEntries(base.properties.map(key => [key, key === "text" ? list ? node.childNodes.filter(value => "tagName" in value).map(textOf).join("\n") : textOf(node) : values[key] ?? ""]));
    if (!base.geometry) base.reason = "Movement requires literal positioned pixel axes without stylesheet classes or transformed ancestors.";
    return base;
  } catch (cause) { return { ...base, editable: false, reason: cause instanceof Error ? cause.message.slice(0, 500) : "Select a static source target again" }; }
}
export type SourceOperation = Extract<CanvasOperation, { type: "source.update" }>;
export function patchCanvasSource(html: string, edit: SourceOperation) {
  const target = inspectCanvasSource(html, edit.anchor);
  if (!target.editable) throw new DesignDocumentError("INVALID_DOCUMENT", target.reason!);
  const node = locateDesignElement(html, edit.anchor), location = node.sourceCodeLocation!;
  const rule = styleRule(node), attrs = new Map(node.attrs.map(value => [value.name, value.value]));
  for (const [key, value] of Object.entries(edit.changes ?? {})) {
    if (value === undefined) continue;
    if (!target.properties.includes(key as typeof DESIGN_PROPERTIES[number]) || !validDesignProperty(key, value)) throw new DesignDocumentError("INVALID_DOCUMENT", "This property needs a supported literal source target and value: " + key);
    if (key === "text") continue;
    for (const declaration of [...rule.nodes]) if (declaration.type === "decl" && declaration.prop.toLowerCase() === key) declaration.remove();
    rule.append(postcss.decl({ prop: key, value, important: true }));
  }
  let tag = node.tagName, content = location.endTag ? html.slice(location.startTag!.endOffset, location.endTag.startOffset) : "";
  const value = edit.changes?.text ?? target.values.text ?? textOf(node);
  if (edit.list !== undefined) {
    if (!target.list || edit.href !== undefined) throw new DesignDocumentError("INVALID_DOCUMENT", "List editing requires a plain text block or simple text list; link and list changes are separate actions");
    if (edit.list === "none") { tag = attrs.get("data-bottega-list-origin") ?? (plainList(node) ? "p" : node.tagName); if (!listTags.has(tag) || ["ul", "ol"].includes(tag)) tag = "p"; attrs.delete("data-bottega-list-origin"); content = escapeCanvasText(value); }
    else { if (!plainList(node)) attrs.set("data-bottega-list-origin", node.tagName); tag = edit.list === "ordered" ? "ol" : "ul"; content = value.split("\n").map(value => `<li>${escapeCanvasText(value)}</li>`).join(""); }
  } else if (edit.changes?.text !== undefined) content = plainList(node) ? value.split("\n").map(value => `<li>${escapeCanvasText(value)}</li>`).join("") : escapeCanvasText(value);
  if (edit.href !== undefined) {
    if (!target.link || edit.list !== undefined) throw new DesignDocumentError("INVALID_DOCUMENT", "Links require compatible direct-text source");
    if (edit.href === null) { attrs.delete("href"); if (attrs.has("data-bottega-link-origin")) { const origin = attrs.get("data-bottega-link-origin")!; tag = textTags.has(origin) ? origin : "span"; attrs.delete("data-bottega-link-origin"); } }
    else { if (tag !== "a") attrs.set("data-bottega-link-origin", tag); tag = "a"; attrs.set("href", edit.href); }
  }
  const css = rule.toString().slice(2, -1); if (css) attrs.set("style", css);
  const attributes = [...attrs].map(([key, value]) => ` ${key}="${escapeCanvasText(value)}"`).join("");
  if (!location.endTag) {
    if (edit.changes?.text !== undefined || edit.href !== undefined || edit.list !== undefined) throw new DesignDocumentError("INVALID_DOCUMENT", "This source target has no editable text closing tag");
    return html.slice(0, location.startTag!.startOffset) + `<${tag}${attributes}>` + html.slice(location.startTag!.endOffset);
  }
  return html.slice(0, location.startOffset) + `<${tag}${attributes}>${content}</${tag}>` + html.slice(location.endOffset);
}
