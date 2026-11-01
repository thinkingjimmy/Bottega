/**
 * [INPUT]: Immutable UTF-8 native slide section bytes and its indexed slide identifier.
 * [OUTPUT]: Inert single-section, notes and bounded opaque graphic-embed validation with a source title.
 * [POS]: Native Slides structural boundary; authored scripts are never evaluated during projection.
 */
import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";
type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const children = (node: Node): Node[] => "childNodes" in node ? node.childNodes : [];
const meaningful = (node: Node) => node.nodeName !== "#comment" && !(node.nodeName === "#text" && "value" in node && !node.value.trim());
const text = (node: Node): string => node.nodeName === "#text" && "value" in node ? node.value : children(node).map(text).join("");
export function validateSlideSection(data: Uint8Array, id: string): string {
  if (data.length > 8 * 1024 * 1024) throw new Error("Slide exceeds its 8 MiB HTML budget");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(data);
  const roots = parseFragment(source, { sourceCodeLocationInfo: true }).childNodes.filter(meaningful);
  const root = roots[0];
  if (roots.length !== 1 || !root || !("tagName" in root) || root.tagName !== "section" || root.attrs.find(attr => attr.name === "id")?.value !== id)
    throw new Error("Slide must contain exactly one section with its indexed slide ID");
  const location = root.sourceCodeLocation;
  const empty = (value: string) => !value.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!location?.endTag || !empty(source.slice(0, location.startOffset)) || !empty(source.slice(location.endOffset)))
    throw new Error("Slide must be a section fragment, without a document wrapper");
  let embedCount = 0, notesCount = 0, title = "";
  const direct = children(root).filter(meaningful);
  const visit = (node: Node, parent: Element, inEmbed: boolean) => {
    if (!("tagName" in node)) return;
    const embedded = inEmbed || node.tagName === "x-embed";
    if (node.tagName === "x-embed" && !inEmbed) {
      if (parent !== root || ++embedCount > 8 || new TextEncoder().encode(serialize(node)).length > 16 * 1024)
        throw new Error("Slide graphic embeds must be direct children, at most eight and 16 KiB each");
    }
    if (!embedded) {
      if (["script", "iframe", "object", "embed", "section"].includes(node.tagName) || node.attrs.some(attr => /^on/i.test(attr.name)))
        throw new Error("Active slide content must remain inside an opaque graphic embed");
      if (node.tagName === "aside") {
        if (parent !== root || ++notesCount > 1 || direct.at(-1) !== node || text(node).length > 4000)
          throw new Error("Speaker notes must be one final aside of at most 4000 characters");
      }
      if (!title && /^h[1-6]$/.test(node.tagName)) title = text(node).trim().slice(0, 250);
    }
    for (const child of children(node)) visit(child, node, embedded);
  };
  for (const node of children(root)) visit(node, root, false);
  return title || id;
}
