/**
 * [INPUT]: parse5 markup/source locations, entity-position mapping and CSS/JavaScript syntax scanners.
 * [OUTPUT]: Exact fixed JavaScript/CSS data-resource inlining and real HTML/SVG/DC-import loading ranges (including multiple literal from/import targets) and distinct local navigation ranges.
 * [POS]: Markup dependency analysis; comments/prose/script literals never become markup references.
 */
import { parse, parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { cssReferences } from "./css";
import { scriptReferences } from "./script";
import { decodedHtml, mappedReferences, type DesignReference } from "./types";
import { DesignDocumentError } from "../model";
const SOURCE_TAGS = new Set(["img", "script", "iframe", "audio", "video", "source", "track", "input", "embed", "x-import"]);
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
      if (name === "x-import" && ["from", "src", "import"].includes(key))
        mapped([...attribute.value.matchAll(/\S+/g)].map(match => ({ kind: "load" as const, url: match[0], start: match.index!, end: match.index! + match[0].length })));
      else if (key === "style") mapped(cssReferences(attribute.value));
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

export function inlineDesignTextResources(html: string) {
  const queue: DefaultTreeAdapterMap["node"][] = [parse(html, { sourceCodeLocationInfo: true })];
  const replacements: { start: number; end: number; value: string }[] = [];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index]!; if ("childNodes" in node) queue.push(...node.childNodes); if ("content" in node) queue.push(node.content);
    if (!("tagName" in node) || !node.sourceCodeLocation) continue;
    const script = node.tagName === "script", style = node.tagName === "link" && node.attrs.some(attr => attr.name === "rel" && attr.value.toLowerCase() === "stylesheet");
    if (!script && !style) continue;
    const url = node.attrs.find(attr => attr.name === (script ? "src" : "href"))?.value;
    const match = url && /^data:(?:text\/javascript|application\/javascript|text\/css);base64,([A-Za-z0-9+/]*={0,2})$/.exec(url);
    if (!match) continue;
    const bytes = Buffer.from(match[1]!, "base64"); if (bytes.toString("base64") !== match[1] || bytes.length > 32 * 1024 * 1024) throw new Error("An inline resource exceeds its exact byte budget");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes), kind = script ? "script" : "style", type = script && node.attrs.some(attr => attr.name === "type" && attr.value === "module") ? ' type="module"' : "";
    replacements.push({ start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset, value: `<${kind}${type}>${text.replace(new RegExp("</" + kind, "gi"), "<\\/" + kind)}</${kind}>` });
  }
  let result = html; for (const replacement of replacements.sort((a, b) => b.start - a.start)) result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end);
  if (Buffer.byteLength(result) > 50_000_000) throw new Error("The prepared inline page exceeds its complete render budget"); return result;
}
