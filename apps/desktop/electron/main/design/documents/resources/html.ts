/**
 * [INPUT]: parse5 markup/source locations, entity-position mapping and CSS/JavaScript syntax scanners.
 * [OUTPUT]: Real HTML/SVG loading ranges and distinct local navigation ranges.
 * [POS]: Markup dependency analysis; comments/prose/script literals never become markup references.
 */
import { parse, parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { cssReferences } from "./css";
import { scriptReferences } from "./script";
import { decodedHtml, mappedReferences, type DesignReference } from "./types";
import { DesignDocumentError } from "../model";
const SOURCE_TAGS = new Set(["img", "script", "iframe", "audio", "video", "source", "track", "input", "embed"]);
function sourceSet(text: string): DesignReference[] {
  const result: DesignReference[] = []; let cursor = 0;
  while (cursor < text.length) {
    while (/[\s,]/.test(text[cursor] ?? "")) cursor++;
    const start = cursor, data = text.slice(cursor, cursor + 5).toLowerCase() === "data:";
    while (cursor < text.length && !/\s/.test(text[cursor]!) && (data || text[cursor] !== ",")) cursor++;
    if (cursor > start) result.push({ kind: "load", url: text.slice(start, cursor), start, end: cursor });
    while (cursor < text.length && text[cursor] !== ",") cursor++;
    if (text[cursor] === ",") cursor++;
  }
  return result;
}
const decode = (value: string) => {
  const element = parseFragment('<i data-value="' + value.replaceAll('"', "&quot;") + '"></i>').childNodes[0];
  return element && "attrs" in element ? element.attrs[0]!.value : value;
};
export function htmlReferences(text: string): DesignReference[] {
  const result: DesignReference[] = [], queue: DefaultTreeAdapterMap["node"][] = [parse(text, { sourceCodeLocationInfo: true })];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index]!;
    if ("childNodes" in node) queue.push(...node.childNodes);
    if ("content" in node) queue.push(node.content);
    if (!("tagName" in node)) continue;
    const name = node.tagName.toLowerCase();
    for (const attribute of node.attrs) {
      const key = attribute.prefix ? attribute.prefix + ":" + attribute.name : attribute.name;
      const location = node.sourceCodeLocation?.attrs?.[key]; if (!location) continue;
      const rawAttribute = text.slice(location.startOffset, location.endOffset), equal = rawAttribute.indexOf("=");
      if (equal < 0) continue;
      let start = location.startOffset + equal + 1;
      while (/\s/.test(text[start] ?? "")) start++;
      const quoted = text[start] === '"' || text[start] === "'";
      if (quoted) start++;
      const end = location.endOffset - (quoted ? 1 : 0), raw = text.slice(start, end);
      const mapped = (references: DesignReference[]) => {
        if (!references.length) return;
        const decoded = decodedHtml(raw, decode);
        if (decoded.value !== attribute.value) throw new DesignDocumentError("INVALID_DOCUMENT", "Inline resource entity positions could not be verified");
        result.push(...mappedReferences(references, decoded.offsets, start));
      };
      if (key === "style") mapped(cssReferences(attribute.value));
      else if (key.startsWith("on")) mapped(scriptReferences(attribute.value));
      else if (key === "srcset" && (name === "img" || name === "source")) mapped(sourceSet(attribute.value));
      else {
        const href = key === "href" || key === "xlink:href";
        const linkLoads = name === "link" && (node.attrs.find(value => value.name === "rel")?.value.toLowerCase().split(/\s+/) ?? [])
          .some(value => ["stylesheet", "icon", "preload", "modulepreload", "prefetch"].includes(value));
        const navigation = href && (["a", "area", "base"].includes(name) || name === "link" && !linkLoads);
        const load = key === "src" && SOURCE_TAGS.has(name) || key === "poster" && name === "video" ||
          key === "data" && name === "object" || href && (linkLoads || ["use", "image", "feimage"].includes(name));
        if (navigation || load) result.push({ kind: navigation ? "navigation" : "load", url: attribute.value, start, end });
      }
    }
    const location = node.sourceCodeLocation;
    if (!location?.startTag || !["script", "style"].includes(name)) continue;
    const start = location.startTag.endOffset, end = location.endTag?.startOffset ?? location.endOffset;
    const content = text.slice(start, end);
    if (name === "style") result.push(...cssReferences(content, start));
    if (name === "script") {
      const type = node.attrs.find(attribute => attribute.name === "type")?.value;
      if (!type || /^(?:module|(?:application|text)\/(?:javascript|ecmascript))$/i.test(type)) result.push(...scriptReferences(content, start));
    }
  }
  return result;
}
