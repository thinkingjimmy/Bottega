/**
 * [INPUT]: Deterministic fixed native system mappings and existing native index/section source bytes.
 * [OUTPUT]: Original native palette/face declarations and source-position explicit property/token and image updates without document wrappers.
 * [POS]: Native consumer projection; Canvas retains real CSS while Slides receives only permitted literal styles/resources.
 */
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import postcss from "postcss";
import { DesignDocumentError, designDigest } from "../../documents/model";
import type { NativeSystemProjection } from "./projection";
type Node = DefaultTreeAdapterMap["node"];
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const fail = (message: string): never => { throw new DesignDocumentError("INVALID_DOCUMENT", message); };
export function nativeSystemIndex(raw: Record<string, unknown>, projection: NativeSystemProjection) {
  const rows = Array.isArray(raw.designSystems) ? raw.designSystems : [];
  const designSystems = [...rows.filter(row => !row || typeof row !== "object" || row.artifact !== projection.id), ...projection.palettes.map(palette => palette.row)];
  if (designSystems.length > 8) return fail("Native system palettes exceed the eight-theme limit. Bind fewer themes or systems");
  if (projection.conversion.target !== "slides/v4") return { ...raw, designSystems };
  const faces = { ...(raw.faces as Record<string, { family?: string; src?: string; href?: string }> | undefined) };
  for (const font of projection.fonts) {
    const identical = Object.values(faces).some(face => face.family === font.family && face.src === font.path && !face.href);
    if (identical) continue;
    if (Object.values(faces).some(face => face.family === font.family)) return fail("Choose one exact captured source for this native font family: " + font.family);
    faces["s_" + designDigest(JSON.stringify([projection.id, font.family, font.digest])).slice(7, 31)] = { family: font.family, src: font.path };
  }
  if (Object.keys(faces).length > 4) return fail("Native Slides supports four fixed font faces. Remove an unused face before binding");
  return { ...raw, designSystems, faces };
}
export function nativeSystemSection(source: string, projection: NativeSystemProjection) {
  const root = parseFragment(source, { sourceCodeLocationInfo: true }), replacements: { start: number; end: number; value: string }[] = [];
  const visit = (node: Node, inherited: string) => {
    let theme = inherited;
    if ("tagName" in node) {
      if (node.tagName === "x-embed") return;
      theme = node.attrs.find(attribute => attribute.name === "data-theme")?.value ?? theme;
      const style = node.attrs.find(attribute => attribute.name === "style"), location = node.sourceCodeLocation;
      const marker = node.attrs.find(attribute => attribute.name === "data-system-tokens");
      if (style && (/var\s*\(/i.test(style.value) || marker)) {
        const ast = postcss.parse("x{" + style.value + "}");
        if (marker) {
          const entries = marker.value.split(";"), seen = new Set<string>();
          const kinds: Record<string, string> = { background: "color", "background-color": "color", color: "color", "border-color": "color", "font-family": "font-family", "font-size": "font-size", "line-height": "line-height", "font-weight": "font-weight", "letter-spacing": "letter-spacing", "border-radius": "radius", gap: "spacing", padding: "spacing", margin: "spacing", left: "spacing", top: "spacing", width: "spacing", height: "spacing" };
          if (entries.length > 16 || marker.value.length > 1024) return fail("The explicit native system token map exceeds its budget");
          for (const entry of entries) {
            const match = /^([a-z-]+)=([A-Za-z0-9_.-]+)$/.exec(entry.trim());
            if (!match || !kinds[match[1]!] || seen.has(match[1]!)) return fail("Use distinct supported property=token mappings for native system styles");
            const [, property, name] = match, token = projection.tokens.find(token => token.name === name && token.theme === theme);
            if (!token?.supported || kinds[property!] !== token.kind) return fail("Capture a supported system value for " + property + "=" + name + " (" + theme + ")");
            seen.add(property!); let declaration: postcss.Declaration | undefined;
            ast.walkDecls(property!, value => { declaration = value; });
            if (declaration) declaration.value = token.value;
            else if (ast.first?.type === "rule") ast.first.append(postcss.decl({ prop: property!, value: token.value }));
          }
        }
        ast.walkDecls(declaration => {
          declaration.value = declaration.value.replace(/var\(\s*--([A-Za-z0-9_.-]+)\s*\)/g, (_all, name: string) => {
            const token = projection.tokens.find(token => token.name === name && token.theme === theme);
            if (!token || !token.supported) return fail("Capture a supported system value before binding " + name + " (" + theme + ")");
            return token.value;
          });
          if (/var\s*\(/i.test(declaration.value)) return fail("This system variable expression has no verified native mapping: " + declaration.prop);
        });
        const result = ast.first?.toString(); if (!result || !location?.attrs?.style) return fail("The original slide style has no source insertion target");
        replacements.push({ start: location.attrs.style.startOffset, end: location.attrs.style.endOffset, value: 'style="' + escape(result.slice(result.indexOf("{") + 1, -1)) + '"' });
      }
      const image = node.attrs.find(attribute => attribute.name === "data-system-asset");
      if (image) {
        if (node.tagName !== "img") return fail("A native system image marker must belong to an image");
        const target = projection.images.find(asset => asset.source === image.value);
        if (!target) return fail("Capture this exact system image before binding: " + image.value);
        const attribute = location?.attrs?.src, offset = location?.startTag?.endOffset;
        if (!attribute && offset === undefined) return fail("The original native image has no source insertion target");
        replacements.push(attribute ? { start: attribute.startOffset, end: attribute.endOffset, value: 'src="' + escape(target.path) + '"' } : { start: offset! - 1, end: offset! - 1, value: ' src="' + escape(target.path) + '"' });
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child, theme);
  };
  visit(root, projection.system.tokens.themes[0]!.id);
  let result = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end);
  return result;
}
