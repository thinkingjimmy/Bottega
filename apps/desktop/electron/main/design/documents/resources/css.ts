/**
 * [INPUT]: postcss-value-parser syntax nodes and source-position literal decoding.
 * [OUTPUT]: Loading spans for CSS url/import nodes outside comments and ordinary strings.
 * [POS]: Stylesheet/inline-style dependency scanner; preserves unrelated source bytes.
 */
import parse from "postcss-value-parser";
import { quoted, type DesignReference } from "./types";
export function cssReferences(text: string, base = 0): DesignReference[] {
  const result: DesignReference[] = [];
  const add = (node: parse.Node) => {
    if (node.type !== "string" && node.type !== "word") return;
    const start = node.sourceIndex + (node.type === "string" ? 1 : 0);
    const end = node.sourceEndIndex - (node.type === "string" && !node.unclosed ? 1 : 0);
    const value = node.type === "string" ? quoted(text, node.sourceIndex, true).value :
      quoted('"' + node.value.replaceAll('"', '\\"') + '"', 0, true).value;
    if (value) result.push({ kind: "load", url: value, start: base + start, end: base + end });
  };
  parse(text).walk((node, index, nodes) => {
    if (node.type === "function" && node.value.toLowerCase() === "url") {
      const value = node.nodes.filter(child => child.type !== "space" && child.type !== "comment");
      if (value.length === 1) add(value[0]!);
      return false;
    }
    if (node.type === "word" && node.value.toLowerCase() === "@import") {
      const next = nodes.slice(index + 1).find(child => child.type !== "space" && child.type !== "comment");
      if (next?.type === "string") add(next);
    }
  });
  return result;
}
