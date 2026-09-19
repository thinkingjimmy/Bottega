/**
 * [INPUT]: Validated snapshot bytes, normalized import maps and non-executing CSS/JavaScript parsers.
 * [OUTPUT]: In-memory resource URLs, CSS dependencies and original-path module resolution including aliases and scopes.
 * [POS]: Offline snapshot filesystem; preparation never requests or executes artifact resources.
 */
import { parse as modules } from "es-module-lexer/js";
import { parse as css } from "postcss";
import values from "postcss-value-parser";
import { resolveArtifactModule, type ArtifactModuleMap } from "./modules";
export type ArtifactResource = { path: string; bytes: Uint8Array<ArrayBuffer>; mime: string };
export const VIRTUAL_ORIGIN = "https://artifact.invalid/";
export const artifactResourcePath = (path: string) => new URL(path.split("/").map(encodeURIComponent).join("/"), VIRTUAL_ORIGIN).href;
const decoder = new TextDecoder("utf-8", { fatal: true });
const cssString = (value: string) => value.replace(/\\([\da-f]{1,6})\s?|\\(.)/gi, (_, hex: string, character: string) => hex ? String.fromCodePoint(parseInt(hex, 16) || 0xfffd) : character);
export function dataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
export class ArtifactResources {
  private files = new Map<string, ArtifactResource>();
  private encoded = new Map<string, string>();
  private encoding = new Set<string>();
  private expandedBytes = 0;
  constructor(files: ArtifactResource[], private moduleMap: ArtifactModuleMap) {
    for (const file of files) this.files.set(artifactResourcePath(file.path), file);
  }
  resolve(value: string, base: string) {
    const url = new URL(value, base); url.search = ""; url.hash = "";
    return url.origin === new URL(VIRTUAL_ORIGIN).origin && this.files.has(url.href) ? url.href : null;
  }
  url(value: string, base: string) {
    if (value.startsWith("#")) return value;
    const key = this.resolve(value, base);
    if (!key) return value;
    const result = this.encode(key) + new URL(value, base).hash;
    this.expandedBytes += result.length;
    if (this.expandedBytes > 100_000_000) throw new Error("artifact-expanded-budget");
    return result;
  }
  script(source: string, base: string) {
    const edits: { start: number; end: number; value: string }[] = [];
    for (const specifier of modules(source)[0]) {
      if (specifier.d === -2) {
        edits.push({ start: specifier.s, end: specifier.e, value: `({url:${JSON.stringify(base)},resolve:s=>window.__artifactResolve(${JSON.stringify(base)},s)})` });
      } else if (specifier.d >= 0) {
        edits.push({ start: specifier.ss, end: specifier.d, value: `window.__artifactImport.bind(null,${JSON.stringify(base)})` });
      } else if (specifier.n !== undefined) {
        const resolved = resolveArtifactModule(this.moduleMap, specifier.n, base);
        const value = resolved === null ? "artifact-blocked:module" : resolved.startsWith(VIRTUAL_ORIGIN) ? this.resolve(resolved, base) ?? resolved : resolved;
        edits.push({ start: specifier.s - 1, end: specifier.e + 1, value: JSON.stringify(value) });
      }
    }
    for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
    return source;
  }
  css(source: string, base: string) {
    const tree = css(source);
    const rewrite = (value: string, imported = false) => {
      const parsed = values(value);
      parsed.walk(node => {
        if (node.type !== "function" || node.value.toLowerCase() !== "url") return;
        const reference = node.nodes.filter(item => item.type !== "space" && item.type !== "comment");
        if (reference.length === 1 && ["word", "string"].includes(reference[0]!.type)) {
          const url = this.url(cssString(reference[0]!.value), base);
          node.nodes = [{ type: "string", quote: '"', value: url, sourceIndex: 0, sourceEndIndex: url.length }];
        }
        return false;
      });
      const first = parsed.nodes.find(node => node.type !== "space" && node.type !== "comment");
      if (imported && first?.type === "string") first.value = this.url(cssString(first.value), base);
      return parsed.toString();
    };
    tree.walkDecls(declaration => { declaration.value = rewrite(declaration.value); });
    tree.walkAtRules(rule => { if (rule.name.toLowerCase() === "import") rule.params = rewrite(rule.params, true); });
    return tree.toString();
  }
  private encode(key: string): string {
    const cached = this.encoded.get(key); if (cached) return cached;
    const file = this.files.get(key)!;
    // CSS import cycles contribute no additional rules, as in the browser loader.
    if (this.encoding.has(key)) return "data:text/css,";
    this.encoding.add(key);
    let bytes = file.bytes;
    if (["text/javascript", "application/javascript"].includes(file.mime)) bytes = new TextEncoder().encode(this.script(decoder.decode(bytes), key));
    if (file.mime === "text/css") bytes = new TextEncoder().encode(this.css(decoder.decode(bytes), key));
    const url = dataUrl(bytes, file.mime);
    this.encoded.set(key, url); this.encoding.delete(key); return url;
  }
  entries() { return Object.fromEntries([...this.files.keys()].map(key => [key, this.encode(key)])); }
  importMap(entries: Record<string, string>) {
    const aliases = (mappings: ArtifactModuleMap["imports"]) => {
      const result: Record<string, string | null> = Object.create(null);
      for (const [key, address] of mappings) {
        // Snapshot specifiers are compiled; retain bare aliases for unmodified CDN modules.
        if (/^(?:\/|\.\.?\/|[a-z][a-z\d+.-]*:)/i.test(key)) continue;
        if (key.endsWith("/") && address?.startsWith(VIRTUAL_ORIGIN)) {
          result[key] = address;
          for (const [path, url] of Object.entries(entries)) if (path.startsWith(address)) result[key + path.slice(address.length)] = url;
        } else result[key] = address === null ? null : entries[this.resolve(address, VIRTUAL_ORIGIN) ?? address] ?? address;
      }
      return result;
    };
    return { imports: { ...aliases(this.moduleMap.imports), ...entries }, scopes: Object.fromEntries(this.moduleMap.scopes.map(([scope, mappings]) => [scope, aliases(mappings)])) };
  }
}
