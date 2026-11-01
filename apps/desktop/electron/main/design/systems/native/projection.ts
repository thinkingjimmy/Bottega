/**
 * [INPUT]: One authorized immutable system revision, captured resources and the verified original native color parser/palette contract.
 * [OUTPUT]: Deterministic native palettes, exact resource closure, font/image mappings and explicit unsupported items.
 * [POS]: Native system conversion; source system bytes and React component targets remain unchanged.
 */
import { nativeSlideColors } from "../../native/slides-check";
import { posix } from "node:path";
import { resolvedSystemToken, validTokenValue } from "@ai-chat/cloud-protocol/artifacts/design/system/tokens";
import type { DesignSystem } from "@ai-chat/cloud-protocol/artifacts/design/system/model";
import type { DesignRevision } from "../../documents/store";
import { designDigest, DesignDocumentError } from "../../documents/model";
import { readDesignSystem } from "../validation";
type Member = { path: string; data: Uint8Array };
export type NativeSystemSnapshot = { version: DesignRevision; files: Member[] };
const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const fail = (message: string): never => { throw new DesignDocumentError("INVALID_DOCUMENT", message); };
const primary = (value: string) => /^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/.exec(value)?.slice(1).find(Boolean)?.trim();
function supported(kind: string, value: string, system: DesignSystem, target: string) {
  if (!validTokenValue(kind as DesignSystem["tokens"]["tokens"][number]["kind"], value)) return false;
  if (kind === "color") return true;
  if (kind === "font-family") return target !== "slides/v4" || system.tokens.fonts.some(font => font.family === primary(value) && font.style === "normal");
  if (kind === "font-weight") return /^(?:[1-9]\d{0,2}|1000|normal|bold)$/.test(value);
  if (kind === "line-height") return /^(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/.test(value);
  if (kind === "shadow") return false;
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/.test(value);
}
export async function nativeSystemProjection(snapshot: NativeSystemSnapshot, target: "canvas-dc/v3" | "slides/v4") {
  const { version } = snapshot, system = readDesignSystem(snapshot.files, version.manifest).system;
  if (!system) return fail("The fixed native system metadata is invalid");
  const id = version.manifest.documentId, prefix = "systems/" + id + "/", title = version.manifest.title;
  const closure = snapshot.files.filter(file => file.path !== "canvas.json" && file.path !== "overview.html" &&
    (target !== "slides/v4" || !/\.(?:[cm]?js|jsx|tsx?|html|css)$/i.test(file.path))).map(file => ({ path: prefix + file.path, data: file.data }));
  const unsupported: { kind: string; name: string; theme?: string; reason: string }[] = [];
  const names = [...new Set([...system.tokens.tokens.map(token => token.name), ...system.aliases.aliases.map(alias => alias.name)])].sort();
  const rawTokens = system.tokens.themes.flatMap(theme => names.map(name => {
    const token = resolvedSystemToken(system, name, theme.id); if (!token) return fail("A native system alias is unresolved: " + name);
    return { name, theme: theme.id, kind: token.token.kind, value: token.value };
  }));
  const values = [...new Set(rawTokens.filter(token => token.kind === "color" && validTokenValue("color", token.value)).map(token => token.value))];
  const normalized = await nativeSlideColors(values), colors = new Map(values.map((value, index) => [value, normalized.colors[index]]));
  const tokens = rawTokens.map(token => {
    const value = token.kind === "color" ? colors.get(token.value) : token.value;
    const usable = value !== null && value !== undefined && supported(token.kind, token.value, system, target);
    if (!usable) unsupported.push({ kind: "token", name: token.name, theme: token.theme, reason: "This exact value has no verified native mapping. Capture a supported value before using it: " + token.value });
    return { ...token, sourceValue: token.value, value: value ?? token.value, supported: usable };
  });
  const fonts = system.tokens.fonts.map(font => {
    if (target === "slides/v4" && font.family.length > 128) return fail("This font family exceeds the native Slides name limit");
    const resource = snapshot.files.find(file => file.path === font.file); if (!resource) return fail("A fixed native system font is missing");
    const owner = system.sources.files.find(source => source.id === font.sourceId);
    const licenses = system.sources.files.filter(source => /(?:license|licence|ofl|notice)/i.test(posix.basename(source.path)) && /\.(?:txt|md)$/i.test(source.path) &&
      owner && (posix.dirname(owner.path) === posix.dirname(source.path) || posix.dirname(owner.path).startsWith(posix.dirname(source.path) + "/")));
    if (!licenses.length) return fail("Capture the font license beside its source before binding: " + font.family);
    if (target === "slides/v4" && font.style !== "normal") return fail("This native Slides font style has no verified face mapping: " + font.family + " " + font.style);
    return { family: font.family, path: prefix + font.file, weight: font.weight, style: font.style, digest: designDigest(resource.data), licenses: licenses.map(source => prefix + source.capturedPath).sort() };
  });
  if (target === "slides/v4" && new Set(fonts.map(font => font.family)).size !== new Set(fonts.map(font => font.family + ":" + font.digest)).size)
    return fail("Native Slides needs one exact variable font file per family; choose a supported captured face");
  const images = system.sources.files.filter(source => /\.(?:png|jpe?g|webp|gif|svg)$/i.test(source.path)).map(source => ({ source: source.path, path: prefix + source.capturedPath, digest: source.digest }));
  for (const component of system.components.components) if (target === "slides/v4" || component.dc?.status !== "ready")
    unsupported.push({ kind: "component", name: component.name, reason: target === "slides/v4" ? "Native Slides does not load React components; use an image or native elements." : component.dc?.reason ?? "Compile and verify the React18 DC target before using this component." });
  const palettes = system.tokens.themes.map(theme => {
    const namespace = "b-" + designDigest(JSON.stringify([id, target, theme.id])).slice(7, 31), path = "ds/" + namespace + "/tokens.json";
    if ([...title + " · " + theme.name].length > 80) return fail("Shorten the system or theme title to fit the original native palette");
    const selected = tokens.filter(token => token.theme === theme.id && token.supported), families = selected.filter(token => token.kind === "font-family");
    const data = json({ meta: { name: title + " · " + theme.name }, color: { themes: [theme], tokens: selected.filter(token => token.kind === "color").map(token => ({ name: token.name, value: token.value })) },
      type: { families: Object.fromEntries(families.map(token => [token.name, token.value])), groups: [{ name: theme.name,
        ...(families.length === 1 ? { family: families[0]!.name } : {}), styles: selected.filter(token => token.kind === "font-size").map(token => ({ name: token.name, fontSize: token.value })) }] } });
    return { theme: theme.id, namespace, path, data, digest: designDigest(data), row: { title: title + " · " + theme.name, namespace, artifact: id,
      version: "v" + version.revision + " " + version.snapshotRef } };
  });
  const conversion = { version: "native-system/v2", target, normalizer: { id: "original-native-colors/v1", runtimeDigest: normalized.runtimeDigest }, source: { documentId: id, revision: version.revision, snapshotRef: version.snapshotRef },
    mappings: { tokens, fonts, images, palettes: palettes.map(({ theme, namespace, path, digest }) => ({ theme, namespace, path, digest })) }, unsupported };
  const report = json(conversion); if (report.length > 256 * 1024) return fail("The complete native system conversion exceeds its report budget");
  return { id, prefix, system, tokens, fonts, images, palettes, conversion, closure, derived: [...palettes.map(({ path, data }) => ({ path, data })), { path: prefix + "conversion.json", data: report }] };
}
export type NativeSystemProjection = Awaited<ReturnType<typeof nativeSystemProjection>>;
