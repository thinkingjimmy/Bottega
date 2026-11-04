/**
 * [INPUT]: Fixed target/current/restored members and exact selected System or Dashboard units.
 * [OUTPUT]: Related historical provenance/resources and regenerated derived System files before one journal publication.
 * [POS]: Format closure for selective History restore; never overwrites unrelated newer captured bytes.
 */
import { posix } from "node:path";
import { designSystemSchema, type DesignSystem } from "@ai-chat/cloud-protocol/artifacts/design/system/model";
import type { HistorySelection } from "@ai-chat/cloud-protocol/artifacts/design/history/model";
import type { DesignManifest } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { designDigest, sourcePath } from "../documents/model";
import { designResourceReferences } from "../documents/resources/references";
import { projectSystemFiles } from "../systems/files";
import { readCanonicalSystem } from "../systems/native/editor";
type Member = { path: string; data: Uint8Array };
type Input = { format: string; manifest?: DesignManifest; target: readonly Member[]; current: readonly Member[]; restored: readonly Member[]; selections: readonly HistorySelection[] };
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
function systemClosure(input: Input): Member[] {
  const manifest = input.manifest!;
  if (!manifest.system) throw new Error("A fixed canonical System manifest is required");
  const old = readCanonicalSystem(manifest, input.target), next = readCanonicalSystem(manifest, input.restored);
  const files = new Map(input.restored.map(file => [file.path, file.data])), target = new Map(input.target.map(file => [file.path, file.data]));
  const source = (id: string) => {
    const original = old.sources.files.find(source => source.id === id), bytes = original && target.get(original.capturedPath);
    if (!original || !bytes || bytes.length !== original.bytes || designDigest(bytes) !== original.digest) throw new Error("Missing fixed historical source: " + id);
    const existing = next.sources.files.find(source => source.id === id);
    if (existing?.digest === original.digest && existing.capturedPath === original.capturedPath && files.get(existing.capturedPath) && designDigest(files.get(existing.capturedPath)!) === original.digest) return existing;
    const suffix = designDigest(JSON.stringify(original)).slice(7, 31), newId = "history-" + suffix;
    const retained = next.sources.files.find(source => source.id === newId);
    if (retained) { if (retained.digest !== original.digest || !files.get(retained.capturedPath) || designDigest(files.get(retained.capturedPath)!) !== original.digest) throw new Error("Historical source identity collision"); return retained; }
    if (next.sources.files.length >= 52) throw new Error("Historical source closure exceeds 52 captured files");
    const capturedPath = sourcePath.parse("history/" + suffix + "/" + posix.basename(original.capturedPath)), collision = files.get(capturedPath);
    if (collision && designDigest(collision) !== original.digest) throw new Error("Historical captured path has newer bytes");
    const record = { ...original, id: newId, capturedPath, retained: true }; next.sources.files.push(record); files.set(capturedPath, bytes.slice()); return record;
  };
  const origin = (value: { sourceId: string; sourceKey: string }) => ({ sourceId: source(value.sourceId).id, sourceKey: value.sourceKey });
  const token = (name: string, theme?: string) => {
    const before = old.tokens.tokens.find(token => token.name === name), after = next.tokens.tokens.find(token => token.name === name);
    if (!before || !after) return;
    if (theme) { const previous = before.origins[theme]; if (previous && Object.hasOwn(after.values, theme)) after.origins[theme] = origin(previous); else delete after.origins[theme]; }
    else { after.sourceId = source(before.sourceId).id; after.sourceKey = before.sourceKey; after.origins = Object.fromEntries(Object.entries(before.origins).map(([theme, value]) => [theme, origin(value)])); }
  };
  const alias = (key: string) => {
    const before = old.aliases.aliases.find(alias => alias.name + ":" + alias.theme === key), after = next.aliases.aliases.find(alias => alias.name + ":" + alias.theme === key);
    if (before && after) Object.assign(after, origin(before));
  };
  const addFixed = (path: string) => {
    const bytes = target.get(path); if (!bytes) throw new Error("Missing historical component resource: " + path);
    const live = files.get(path); if (live && designDigest(live) !== designDigest(bytes)) throw new Error("Historical component resource has newer bytes: " + path); files.set(path, bytes.slice());
  };
  for (const selected of input.selections) {
    if (selected.path === manifest.system.sources) throw new Error("Restore the related token or the complete version instead of its provenance index");
    if (selected.path === manifest.system.tokens) {
      if (!selected.unit) { for (const value of old.tokens.tokens) token(value.name); }
      else { const match = /^json:\/tokens\/@([^/]+)(?:\/values\/([^/]+))?/.exec(selected.unit); if (match) token(match[1]!, match[2]); }
      if (!selected.unit || selected.unit === "json:/fonts") for (const font of next.tokens.fonts) {
        const before = old.tokens.fonts.find(value => value.family === font.family && value.file === font.file && value.weight === font.weight && value.style === font.style);
        if (before) { const captured = source(before.sourceId); font.sourceId = captured.id; font.file = captured.capturedPath; font.definitionSourceId = source(before.definitionSourceId).id; }
      }
    }
    if (selected.path === manifest.system.aliases) {
      if (!selected.unit) for (const value of old.aliases.aliases) alias(value.name + ":" + value.theme);
      else { const match = /^json:\/aliases\/@([^/]+)/.exec(selected.unit); if (match) alias(match[1]!); }
    }
    if (selected.path === manifest.system.components) {
      const selectedName = selected.unit && /^json:\/components\/@([^/]+)/.exec(selected.unit)?.[1];
      for (const component of next.components.components) if (!selected.unit || component.name === selectedName) {
        component.sourceId = source(component.sourceId).id;
        for (const path of [...component.closure, component.bundle, component.preview, component.evidence?.file, ...(component.dc?.status === "ready" ? [component.dc.bundle, component.dc.preview, component.dc.runtimeFile, component.dc.stylesheet, component.dc.evidence.file] : [])].filter((path): path is string => Boolean(path))) addFixed(path);
      }
    }
  }
  return projectSystemFiles(designSystemSchema.parse(next) as DesignSystem, manifest, [...files].map(([path, data]) => ({ path, data })));
}
async function dashboardClosure(input: Input) {
  const files = new Map(input.restored.map(file => [file.path, file.data])), old = new Map(input.target.map(file => [file.path, file.data]));
  const add = (path: string) => { if (files.has(path)) return; const bytes = old.get(path); if (!bytes) throw new Error("Missing historical Dashboard resource: " + path); files.set(path, bytes.slice()); };
  const blob = (id: string) => { add("_blobs/" + id); add("_blobs/" + id + ".json"); };
  const active = new Set<string>(), seen = new Set<string>();
  const page = async (name: string): Promise<void> => {
    if (active.has(name)) throw new Error("Cyclic historical Dashboard page resource"); if (seen.has(name)) return;
    active.add(name); const path = "db/files/" + name + ".json"; add(path);
    const value = JSON.parse(decode(files.get(path)!)); if (typeof value.text !== "string") throw new Error("Historical page resource requires text");
    for (const reference of /\.(?:html|css|[cm]?js|svg)$/i.test(name) ? await designResourceReferences(value.text, name) : []) {
      if (reference.kind === "navigation" || /^(?:data:|#)/i.test(reference.url)) continue;
      const url = decodeURIComponent(reference.url.split(/[?#]/, 1)[0]!);
      if (/^\/_blob\/[a-f0-9]{32}$/.test(url)) { blob(url.slice(7)); continue; }
      const local = posix.normalize(posix.join(posix.dirname(name), url.replace(/^\.\//, "").replace(/^files\//, "")));
      if (!/^[A-Za-z0-9_][A-Za-z0-9_. -]{0,199}$/.test(local)) throw new Error("Unsafe historical Dashboard page resource"); await page(local);
    }
    active.delete(name); seen.add(name);
  };
  for (const selected of input.selections) {
    const bytes = files.get(selected.path); if (!bytes) continue;
    if (selected.path.startsWith("db/datasets/")) { const value = JSON.parse(decode(bytes)); if (!/^\/_blob\/[a-f0-9]{32}$/.test(value.source?.url)) throw new Error("Missing fixed Dashboard attachment identity"); blob(value.source.url.slice(7)); }
    if (/^db\/files\//.test(selected.path)) await page(selected.path.slice(9, -5));
  }
  return [...files].map(([path, data]) => ({ path, data }));
}
export async function completeHistoryRestore(input: Input): Promise<Member[]> {
  if (input.format === "design-system/v1") return systemClosure(input);
  if (input.format === "dashboard/v1") return dashboardClosure(input);
  return [...input.restored];
}
