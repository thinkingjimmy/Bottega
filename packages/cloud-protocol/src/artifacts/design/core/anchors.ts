/**
 * [INPUT]: Complete original HTML and bounded version/element/region evidence.
 * [OUTPUT]: Unique source targets, current digest and real source lines; stale regions are refused.
 * [POS]: Shared inert anchor resolver; parsing never executes HTML or scripts.
 */
import { parse, type DefaultTreeAdapterTypes as Tree } from "parse5";
import { hashBytes } from "../../../blobs/transfer";
import type { DesignAnchor } from "../review";
type Element = Tree.Element;
const text = (node: Tree.Node): string => "value" in node ? node.value : "childNodes" in node ? node.childNodes.map(text).join("") : "";
const attribute = (node: Element, name: string) => node.attrs.find(value => value.name === name)?.value;
export function locateDesignElement(html: string, anchor: DesignAnchor) {
  if (anchor.region || !anchor.selector) throw new Error("Select an element target");
  const document = parse(html, { sourceCodeLocationInfo: true }), matches: Element[] = []; let nodes = 0;
  const steps = anchor.selector.startsWith("#") ? null : anchor.selector.split(">").map(step => {
    const match = /^([a-z][a-z0-9-]*)(?::nth-of-type\((\d{1,5})\))?$/i.exec(step.trim());
    if (!match) throw new Error("Unsupported selector. Select the target again.");
    return { tag: match[1]!.toLowerCase(), index: match[2] ? Number(match[2]) : null };
  });
  const id = anchor.selector.startsWith("#") ? anchor.selector.slice(1).replace(/\\([a-f0-9]{1,6}\s?|.)/gi, (_value, escape: string) => /^[a-f0-9]/i.test(escape) ? String.fromCodePoint(parseInt(escape.trim(), 16)) : escape) : null;
  const matchesPath = (element: Element) => {
    let current: Tree.Node | null = element;
    for (let index = steps!.length - 1; index >= 0; index--) {
      const step = steps![index]!;
      if (!current || !("tagName" in current) || current.tagName.toLowerCase() !== step.tag) return false;
      const parent: Tree.ParentNode | null = current.parentNode;
      if (step.index && (!parent || parent.childNodes.filter(node => "tagName" in node && node.tagName.toLowerCase() === step.tag).indexOf(current) + 1 !== step.index)) return false;
      current = parent;
    }
    return true;
  };
  const walk = (node: Tree.Node) => {
    if (++nodes > 50_000) throw new Error("Source tree exceeds the direct-edit budget");
    if ("tagName" in node && (id !== null ? attribute(node, "id") === id : matchesPath(node))) matches.push(node);
    if ("childNodes" in node) for (const child of node.childNodes) walk(child);
  };
  walk(document);
  if (matches.length !== 1) throw new Error("Anchor is missing or ambiguous. Select one target again.");
  const node = matches[0]!;
  if (!node.sourceCodeLocation?.startTag || text(node).trim().slice(0, 2048) !== anchor.currentText)
    throw new Error("Anchor text or source mapping changed. Your input is retained.");
  return node;
}
export function resolveDesignAnchor(html: string, anchor: DesignAnchor, allowRelocate = false) {
  if (anchor.boardDigest !== "sha256:" + hashBytes(new TextEncoder().encode(html)) && (!allowRelocate || anchor.region)) throw new Error("Anchor digest is stale. Select the target again.");
  if (anchor.region) { const { sourceLine: _sourceLine, ...region } = anchor; return { anchor: { ...region, currentText: "" }, sourceLine: null }; }
  const node = locateDesignElement(html, anchor);
  return { anchor: { ...anchor, boardDigest: "sha256:" + hashBytes(new TextEncoder().encode(html)), sourceLine: node.sourceCodeLocation!.startLine }, sourceLine: node.sourceCodeLocation!.startLine };
}
