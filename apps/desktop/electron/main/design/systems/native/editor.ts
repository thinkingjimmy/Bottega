/**
 * [INPUT]: The canonical strict system, current manifest and immutable source members.
 * [OUTPUT]: Disposable original-editor files and explicit canonical edits with retained provenance and theme-specific literal/alias replacement.
 * [POS]: System UI boundary; projected tokens never become a second saved authority.
 */
import { z } from "zod";
import { inlineDesignTextResources } from "../../documents/resources/html";
import { designSystemSchema, systemName, type DesignSystem, type SystemToken } from "@ai-chat/cloud-protocol/artifacts/design/system/model";
import { inspectDesignSystem } from "@ai-chat/cloud-protocol/artifacts/design/system/validation";
import { validTokenValue, resolvedSystemValue } from "@ai-chat/cloud-protocol/artifacts/design/system/tokens";
import { designDigest, sourcePath, type DesignManifest } from "../../documents/model";
import { applySystemFonts } from "./fonts";
import { applySystemAssets } from "./assets";
import { projectTypography, applyTypography } from "./typography";
import { projectSystemFiles } from "../files";
type Files = readonly { path: string; data: Uint8Array }[];
const encode = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const text = (value: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(value);
const base = { name: systemName, usage: z.string().max(1000).default("") };
const scalar = z.object({ ...base, value: z.string().min(1).max(1000) }).strict();
const colored = z.object({ ...base, value: z.record(systemName.max(32), z.string().min(1).max(1000)) }).strict();
const family = z.object({ note: z.string().max(1000).default(""), tokens: z.array(scalar).max(512) }).strict();
const style = z.object({ ...base, fontSize: z.string(), lineHeight: z.string(), fontWeight: z.string(), letterSpacing: z.string(), fontStyle: z.enum(["normal", "italic", "oblique"]), opticalSize: z.number().finite().min(0).max(1000).nullable(), family: z.string(), sample: z.string().max(200) }).strict();
const nativeTokens = z.object({ version: z.literal(1), color: z.object({ themes: z.array(z.object({ id: systemName.max(32), name: z.string().min(1).max(80) }).strict()).min(1).max(8), tokens: z.array(colored).max(512) }).strict(),
  type: z.object({ fonts: z.array(z.object({ family: z.string(), file: sourcePath, weight: z.string(), style: z.enum(["normal", "italic", "oblique"]) }).strict()).max(32), families: z.record(systemName, z.string().max(1000)),
    groups: z.array(z.object({ name: z.string().max(120), family: z.string(), note: z.string().max(1000), styles: z.array(style).max(80) }).strict()).max(12) }).strict(),
  spacing: family, radius: family, shadow: z.object({ note: z.string().max(1000).default(""), tokens: z.array(colored).max(512) }).strict().optional(),
}).strict();
function editorTokens(system: DesignSystem) {
  const first = system.tokens.themes[0]!.id, themed = (token: SystemToken) => ({ name: token.name, usage: token.usage, value: { ...token.values } });
  const colors = system.tokens.tokens.filter(token => token.kind === "color").map(themed);
  for (const alias of system.aliases.aliases) {
    let value = colors.find(token => token.name === alias.name);
    if (!value) { value = { name: alias.name, usage: alias.usage, value: {} }; colors.push(value); }
    value.value[alias.theme] = `{${alias.target}}`;
  }
  const scalarFamily = (kind: string) => ({ note: "", tokens: system.tokens.tokens.filter(token => token.kind === kind).map(token => ({ name: token.name, usage: token.usage, value: token.values[first] ?? Object.values(token.values)[0]! })) });
  const families = Object.fromEntries(system.tokens.tokens.filter(token => token.kind === "font-family").map(token => [token.name, token.values[first] ?? Object.values(token.values)[0]!]));
  return { version: 1, color: { themes: system.tokens.themes, tokens: colors }, type: { families, fonts: system.tokens.fonts.map(({ family, file, weight, style }) => ({ family, file, weight, style })), groups: projectTypography(system) }, spacing: scalarFamily("spacing"), radius: scalarFamily("radius"), shadow: { note: "", tokens: system.tokens.tokens.filter(token => token.kind === "shadow").map(themed) } };
}
export function readCanonicalSystem(manifest: DesignManifest, files: Files): DesignSystem {
  if (!manifest.system) throw new Error("A canonical system manifest is required");
  return designSystemSchema.parse(Object.fromEntries(Object.entries(manifest.system).map(([key, path]) => {
    const source = files.find(file => file.path === path); if (!source) throw new Error("Missing system source: " + path);
    return [key, JSON.parse(text(source.data))];
  })));
}
export function systemEditorProjection(system: DesignSystem, manifest: DesignManifest, files: Files) {
  const projected = new Map<string, Uint8Array>();
  for (const file of files) if (!system.sources.files.some(source => source.path === file.path && source.id.startsWith("asset-blob-") && !source.retained) && /^(?:assets|fonts)\//.test(file.path) || ["README.md", "tokens.css", "manifest.json"].includes(file.path) || /^api\/(?:tokens\.md|(?:components|assets)\/[^/]+\.md)$/.test(file.path)) projected.set("project/" + file.path, file.data);
  const css = projected.get("project/tokens.css"); if (css) projected.set("project/tokens.css", Buffer.from("/* Bottega boundary projection — generated from tokens.json */\n" + text(css)));
  for (const font of system.tokens.fonts) { const file = files.find(value => value.path === font.file); if (file) projected.set("project/" + font.file, file.data); }
  for (const component of system.components.components) {
    const preview = component.preview && files.find(file => file.path === component.preview);
    const guide = files.find(file => file.path === `components/${component.name}/README.md`);
    projected.set(`project/components/${component.name}/README.md`, guide?.data ?? Buffer.from(`${component.name}\n\n${component.reason}\n\n${component.mode === "mounted" ? "Try the interactive example and use Props to explore its supported values." : "Static source inventory. Compile the component in Sources to create an interactive preview."}\n`));
    const declaration = system.sources.files.find(source => source.id === component.sourceId), source = declaration && files.find(file => file.path === declaration.capturedPath);
    if (source && source.data.length <= 128 * 1024) projected.set(`project/components/${component.name}/${component.name}.d.ts`, source.data);
    if (preview && component.mode === "mounted") {
      let html = text(preview.data).replace(/<head([^>]*)>/i, match => match + '<meta name="bottega-standalone-preview" content="' + component.bundleDigest + '">');
      for (const file of files) {
        const basename = file.path.split("/").at(-1)!;
        if (file.path === component.bundle) html = html.replaceAll(`src="${basename}"`, `src="data:application/javascript;base64,${Buffer.from(file.data).toString("base64")}"`);
        if (file.path === "tokens.css" || file.path.startsWith("components/") && file.path.endsWith(".css")) {
          let css = text(file.data);
          for (const font of system.tokens.fonts) { const source = files.find(value => value.path === font.file); if (source) css = css.replaceAll(font.file, "data:font/woff2;base64," + Buffer.from(source.data).toString("base64")); }
          const url = "data:text/css;base64," + Buffer.from(css).toString("base64"); html = html.replaceAll(`href="${basename}"`, `href="${url}"`).replaceAll(`href="../${basename}"`, `href="${url}"`);
        }
      }
      html = inlineDesignTextResources(html);
      projected.set(`project/components/${component.name}/preview.html`, Buffer.from(`<!-- @dsCard group="Components" -->\n` + html));
    }
  }
  if (!projected.has("project/README.md")) projected.set("project/README.md", Buffer.from(`# ${manifest.title}\n\nUnsupported source values are retained. Sources shows their exact provenance.\n`));
  const saved = files.find(file => file.path === "system-editor.json"), layout = saved ? JSON.parse(text(saved.data)) : {};
  projected.set("project/design-system.json", encode({ v: 3, layout: "files", createdOnFiles: { v: 1, at: "2026-11-03T00:00:00Z" }, title: manifest.title, namespace: "BottegaSystem", libraries: [], sections: {}, groups: [], assetGroups: {}, blobs: {}, docs: { readme: "project/README.md", sections: [] }, ...layout }));
  projected.set("project/tokens.json", encode(editorTokens(system))); return projected;
}
export function applySystemEditorProjection(original: DesignSystem, manifest: DesignManifest, files: Files, projected: ReadonlyMap<string, Uint8Array>) {
  const before = systemEditorProjection(original, manifest, files), changed = [...new Set([...before.keys(), ...projected.keys()])].filter(path => designDigest(before.get(path) ?? "") !== designDigest(projected.get(path) ?? ""));
  if (!changed.length) return { system: original, manifest, files };
  for (const path of changed) {
    if (!path.startsWith("project/")) throw new Error("System edits require an explicit project path");
    const local = sourcePath.parse(path.slice(8));
    const generated = /^api\/(?:tokens\.md|(?:components|assets)\/[^/]+\.md)$/.test(local) || local === "manifest.json";
    const guideline = original.components.components.some(component => local === `components/${component.name}/README.md`);
    if (!["tokens.json", "design-system.json", "README.md", "tokens.css"].includes(local) && !/^(?:assets|fonts)\//.test(local) && !original.tokens.fonts.some(font => local === font.file && !projected.has(path)) && !generated && !guideline) throw new Error("Use the source/compile workflow for " + local);
    if (local.startsWith("api/components/") && !original.components.components.some(component => local === `api/components/${component.name}.md`)) throw new Error("Generated documentation names an unknown component");
    if (local === "manifest.json" && projected.has(path)) {
      const value = JSON.parse(text(projected.get(path)!)); if (value.manifestVersion !== 3 || value.namespace !== "BottegaSystem" || (value.libraries?.length ?? 0) > 0) throw new Error("The derived editor manifest cannot change runtime identity");
      if (!Array.isArray(value.files) || value.files.some((path: unknown) => !sourcePath.safeParse(path).success)) throw new Error("The derived editor manifest contains an unsafe member");
    }
    if (["tokens.json", "design-system.json"].includes(local) && !projected.has(path)) throw new Error("The system index and tokens cannot be deleted");
  }
  const system = structuredClone(original), result = new Map(files.map(file => [file.path, file.data])), raw = projected.get("project/tokens.json")!;
  if (raw.byteLength > 1024 * 1024) throw new Error("System token edit exceeds 1 MiB");
  const incoming = nativeTokens.parse(JSON.parse(text(raw))), previous = nativeTokens.parse(editorTokens(original));
  const editorId = "editor", editorPath = "editor/values.json", origin = { sourceId: editorId, sourceKey: "tokens.json" };
  const touched = new Set<string>(), names = new Set<string>(), first = incoming.color.themes[0]!.id;
  const put = (name: string, kind: SystemToken["kind"], values: Record<string, string>, usage: string) => {
    if (names.has(name)) throw new Error("Duplicate editor token: " + name); names.add(name); touched.add(name);
    const existing = system.tokens.tokens.find(token => token.name === name);
    if (existing && existing.kind !== kind) throw new Error("A token kind cannot change implicitly");
    if (existing && JSON.stringify(existing.values) === JSON.stringify(values) && existing.usage === usage) return;
    for (const value of Object.values(values)) if (!validTokenValue(kind, value)) throw new Error("Unsupported edited value for " + name);
    const next: SystemToken = { name, kind, values, usage, sourceId: editorId, sourceKey: name, origins: Object.fromEntries(Object.keys(values).map(theme => [theme, { ...origin, sourceKey: name }])), override: true };
    if (existing) system.tokens.tokens[system.tokens.tokens.indexOf(existing)] = next; else system.tokens.tokens.push(next);
  };
  if (changed.includes("project/tokens.json") && JSON.stringify(incoming) !== JSON.stringify(previous)) {
    system.tokens.themes = incoming.color.themes;
    const aliases: DesignSystem["aliases"]["aliases"] = [];
    for (const token of incoming.color.tokens) {
      const values: Record<string, string> = {};
      for (const [theme, value] of Object.entries(token.value)) {
        const alias = /^\{([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\}$/.exec(value);
        if (alias) { const existing = original.aliases.aliases.find(item => item.name === token.name && item.theme === theme && item.target === alias[1] && item.usage === token.usage);
          aliases.push(existing ?? { name: token.name, theme, target: alias[1]!, usage: token.usage, ...origin, override: true }); }
        else values[theme] = value;
      }
      if (Object.keys(values).length) put(token.name, "color", values, token.usage);
      else {
        if (names.has(token.name)) throw new Error("Duplicate editor token");
        names.add(token.name); touched.add(token.name);
        system.tokens.tokens = system.tokens.tokens.filter(item => item.name !== token.name);
      }
    }
    system.aliases.aliases = aliases;
    for (const kind of ["spacing", "radius"] as const) for (const token of incoming[kind].tokens) put(token.name, kind, { ...original.tokens.tokens.find(item => item.name === token.name)?.values, [first]: token.value }, token.usage);
    for (const token of incoming.shadow?.tokens ?? []) put(token.name, "shadow", token.value, token.usage);
    for (const [name, value] of Object.entries(incoming.type.families)) put(name, "font-family", { ...original.tokens.tokens.find(item => item.name === name)?.values, [first]: value }, original.tokens.tokens.find(item => item.name === name)?.usage ?? "Font family");
    system.tokens.typography = applyTypography(original, incoming.type.groups, incoming.type.families, put);
    for (const group of system.tokens.typography.groups) for (const style of group.styles) for (const name of Object.values(style.tokens)) touched.add(name);
    system.tokens.tokens = system.tokens.tokens.filter(token => touched.has(token.name) || Object.values(token.values).some(value => !validTokenValue(token.kind, value)));
    const captured = encode(JSON.parse(text(raw))), digest = designDigest(captured);
    const record = { id: editorId, path: editorPath, capturedPath: editorPath, digest, bytes: captured.length, version: { kind: "digest" as const, digest } };
    system.sources.files = [...system.sources.files.filter(source => source.id !== editorId), record]; result.set(editorPath, captured);
    for (const alias of system.aliases.aliases) if (resolvedSystemValue(system, alias.name, alias.theme) === null) throw new Error("An edited alias has no valid target");
  }
  for (const path of changed) {
    const local = path.slice(8), value = projected.get(path);
    if (["tokens.json", "tokens.css", "manifest.json"].includes(local) || local.startsWith("api/")) continue;
    if (local === "README.md" && value) {
      const author = (value: Uint8Array) => text(value).split(/(?:\r?\n\r?\n---\r?\n\r?\n|^)## Consuming this system \(generated — do not edit\)/)[0]!;
      const content = author(value), prior = before.get(path);
      if (prior && content.trimEnd() === author(prior).trimEnd()) continue;
      result.set(local, Buffer.from(content.trimEnd() + "\n")); continue;
    }
    if (local === "design-system.json") {
      const index = JSON.parse(text(value!));
      if (index.v !== 3 || index.layout !== "files" || !index.createdOnFiles || index.namespace !== "BottegaSystem" || index.libraries?.length) throw new Error("The virtual editor identity cannot change");
      const metadata = z.object({ title: z.string().min(1).max(250), sections: z.record(z.string().max(80), z.string().max(250)), groups: z.array(z.string().max(80)).max(32), assetGroups: z.record(z.string().max(80), z.unknown()), blobs: z.record(z.string().max(240), z.unknown()), docs: z.object({ readme: z.literal("project/README.md").optional(), sections: z.array(sourcePath).max(32) }).strict() }).strict().parse(Object.fromEntries(["title", "sections", "groups", "assetGroups", "blobs", "docs"].map(key => [key, index[key]])));
      manifest = { ...manifest, title: metadata.title }; result.set("system-editor.json", encode(metadata));
    } else if (value) result.set(local, value); else if (!original.sources.files.some(source => source.capturedPath === local)) result.delete(local);
  }
  applySystemFonts(system, incoming.type.fonts, projected, result, editorId);
  applySystemAssets(system, projected, result);
  const parsed = designSystemSchema.parse(system), checked = inspectDesignSystem(parsed, new Set(result.keys()));
  if (checked.issues.length) throw new Error(checked.issues.map(issue => issue.message).join("; "));
  if (JSON.stringify(parsed) === JSON.stringify(original) && result.size === files.length && files.every(file => result.has(file.path) && designDigest(result.get(file.path)!) === designDigest(file.data))) return { system: original, manifest, files };
  return { system: parsed, manifest, files: projectSystemFiles(parsed, manifest, [...result].map(([path, data]) => ({ path, data }))) };
}
