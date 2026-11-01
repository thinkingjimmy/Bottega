/**
 * [INPUT]: A current design revision and one explicitly selected immutable system revision.
 * [OUTPUT]: Fixed legacy/native version bindings, deterministic original palettes/resources, exact runtime validation and syntax-position native section or HTML style updates.
 * [POS]: System consumption through the existing edit journal; later system updates cannot change this copy.
 */
import { nativeSystemProjection } from "./native/projection";
import { nativeSystemIndex, nativeSystemSection } from "./native/apply";
import { posix } from "node:path";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { projectNativeManifest } from "@ai-chat/cloud-protocol/artifacts/design/native/source";
import { nativeEditorAssets } from "../../artifacts/render/native/assets";
import { designResourceReferences, designResourceTarget } from "../documents/resources/references";
import { readDesignSystem } from "./validation";
import { systemBindingSchema } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { designDocuments } from "../documents/runtime";
import type { DesignRevision } from "../documents/store";
import { DesignDocumentError, sourcePath, manifestSchema, designDigest, type DesignReadSet, type DesignAuthority, type DesignIssue } from "../documents/model";
import { validateDesignSystem } from "./validation";
import { transformedDesignSet } from "../documents/edits";

function stylesheetLink(source: string, systemId: string, href: string) {
  const ast = parse(source, { sourceCodeLocationInfo: true }), removals: { start: number; end: number }[] = [];
  let head: DefaultTreeAdapterMap["element"] | undefined, html: DefaultTreeAdapterMap["element"] | undefined;
  const visit = (node: DefaultTreeAdapterMap["node"]) => {
    if ("tagName" in node) {
      if (node.tagName === "head") head = node;
      if (node.tagName === "html") html = node;
      if (node.tagName === "link" && node.attrs.some(attribute => attribute.name === "data-design-system" && attribute.value === systemId)) {
        const location = node.sourceCodeLocation; if (location) removals.push({ start: location.startOffset, end: location.endOffset });
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  }; visit(ast);
  const close = head?.sourceCodeLocation?.endTag?.startOffset;
  const open = html?.sourceCodeLocation?.startTag?.endOffset;
  if (close === undefined && open === undefined) throw new DesignDocumentError("INVALID_DOCUMENT", "Board has no source-mapped HTML/head insertion target");
  const link = `<link rel="stylesheet" data-design-system="${systemId}" href="${href}">`;
  const insertion = close === undefined ? `<head>${link}</head>` : link;
  const offset = close ?? open!;
  const replacements = [...removals.map(value => ({ ...value, value: "" })), { start: offset, end: offset, value: insertion }].sort((a, b) => b.start - a.start);
  let result = source;
  for (const replacement of replacements) result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end);
  return result;
}
export async function bindDesignSystem(input: WorkspaceCommand, version: DesignRevision, source: DesignReadSet) {
  if (version.manifest.format !== "bottega-design" || !input.systemId || !input.targetRevision) throw new DesignDocumentError("INVALID_DOCUMENT", "Choose an exact system revision for this design");
  const documents = designDocuments(), snapshot = await documents.readRevision(input.chatId, input.incarnationId, input.systemId, input.targetRevision);
  if (snapshot.version.manifest.format !== "bottega-design-system") throw new DesignDocumentError("INVALID_DOCUMENT", "Selected document is not a design system");
  const issues = validateDesignSystem(transformedDesignSet(snapshot.version.path, snapshot.files));
  if (issues.length) throw new DesignDocumentError("INVALID_DOCUMENT", "Selected system has invalid captured resources", issues);
  const prefix = `systems/${input.systemId}/`, files = new Map(source.files.map(file => [file.path, file.data]));
  const projection = version.manifest.contentFormat ? await nativeSystemProjection(snapshot, version.manifest.contentFormat) : undefined;
  const closure = projection ? [...projection.closure, ...projection.derived] : snapshot.files.filter(file => file.path !== "canvas.json" && file.path !== "overview.html").map(file => ({ path: prefix + file.path, data: file.data }));
  const prior = new Set(version.manifest.systems?.find(binding => binding.documentId === input.systemId)?.files);
  for (const file of closure) {
    sourcePath.parse(file.path);
    const existing = files.get(file.path);
    if (existing && !prior.has(file.path) && designDigest(existing) !== designDigest(file.data)) throw new DesignDocumentError("INVALID_DOCUMENT", "A native system resource would replace an unrelated file: " + file.path);
    files.set(file.path, Buffer.from(file.data));
  }
  const binding = systemBindingSchema.parse({ documentId: input.systemId, revision: input.targetRevision, snapshotRef: snapshot.version.snapshotRef,
    files: closure.map(file => file.path) });
  const manifest = { ...version.manifest, systems: [...(version.manifest.systems ?? []).filter(value => value.documentId !== input.systemId), binding] };
  for (const board of manifest.boards) {
    const bytes = files.get(board.file); if (!bytes) throw new DesignDocumentError("INVALID_DOCUMENT", "Consumer board is missing");
    const href = posix.relative(posix.dirname(board.file), prefix + "tokens.css");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    files.set(board.file, Buffer.from(projection?.conversion.target === "slides/v4" ? nativeSystemSection(text, projection) : stylesheetLink(text, input.systemId, href)));
  }
  const index = version.manifest.contentFormat === "slides/v4" ? "deck.json" : "canvas.json";
  const raw = projection ? JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(files.get(index)!)) : null;
  files.set(index, Buffer.from(JSON.stringify(raw ? { ...nativeSystemIndex(raw, projection!), bottegaSystems: manifest.systems } : manifest, null, 2) + "\n"));
  return [...files].map(([path, data]) => ({ path, data }));
}
export async function validateSystemBindings(readSet: DesignReadSet, authority: DesignAuthority): Promise<DesignIssue[]> {
  const issues: DesignIssue[] = [];
  const index = readSet.files.some(file => file.path === "deck.json") ? "deck.json" : "canvas.json";
  const issue = (message: string) => { if (issues.length < 32) issues.push({ file: index, message: message.slice(0, 500) }); };
  const bytes = readSet.files.find(file => file.path === index)?.data;
  if (!bytes) return issues;
  let manifest;
  try { manifest = projectNativeManifest(readSet.files, readSet.path.split("/")[1]!) ?? manifestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); }
  catch { return issues; }
  if (!manifest.systems?.length) return issues;
  const seen = new Set<string>(), documents = designDocuments();
  for (const binding of manifest.systems ?? []) {
    if (seen.has(binding.documentId)) { issue(`Duplicate system binding: ${binding.documentId}`); continue; } seen.add(binding.documentId);
    try {
      const snapshot = await documents.readRevision(authority.chatId, authority.incarnationId, binding.documentId, binding.revision);
      if (JSON.stringify(snapshot.version.authority) !== JSON.stringify(authority) || snapshot.version.manifest.format !== "bottega-design-system" || snapshot.version.snapshotRef !== binding.snapshotRef) {
        issue(`System binding does not identify an authorized exact revision: ${binding.documentId}`); continue;
      }
      if (manifest.contentFormat === "canvas-dc/v3") {
        const system = readDesignSystem(snapshot.files, snapshot.version.manifest).system;
        if (!system) { issue("Fixed system metadata is invalid"); continue; }
        const runtime = (await nativeEditorAssets()).get("artifact-type/dc-runtime.js");
        for (const component of system.components.components) {
          if (component.dc?.status === "ready" && (!runtime || designDigest(runtime) !== component.dc.runtimeDigest)) issue("Native component runtime changed; rebuild DC target: " + component.name);
          if (!component.bundle || component.bundle === (component.dc?.status === "ready" ? component.dc.bundle : undefined)) continue;
          const forbidden = "systems/" + binding.documentId + "/" + component.bundle;
          for (const board of manifest.boards) {
            const source = readSet.files.find(file => file.path === board.file);
            if (source && (await designResourceReferences(new TextDecoder().decode(source.data), board.file)).some(reference => reference.kind === "load" && designResourceTarget(board.file, reference.url) === forbidden))
              issue("Native board must use a compiled React18 DC export, not the standalone bundle: " + component.name);
          }
        }
      }
      const prefix = `systems/${binding.documentId}/`;
      const projection = manifest.contentFormat ? await nativeSystemProjection(snapshot, manifest.contentFormat) : undefined;
      const closure = projection ? [...projection.closure, ...projection.derived] : snapshot.files.filter(file => file.path !== "canvas.json" && file.path !== "overview.html").map(file => ({ path: prefix + file.path, data: file.data }));
      const expected = closure.map(file => file.path).sort();
      if (new Set(binding.files).size !== binding.files.length || JSON.stringify([...binding.files].sort()) !== JSON.stringify(expected)) {
        issue(`Fixed system closure is incomplete or contains unrelated paths: ${binding.documentId}`); continue;
      }
      for (const file of closure) {
        const current = readSet.files.find(value => value.path === file.path);
        if (!current || designDigest(current.data) !== designDigest(file.data)) issue(`Fixed system resource differs from v${binding.revision}: ${file.path}`);
      }
    } catch { issue(`System revision is unavailable to this Chat: ${binding.documentId} v${binding.revision}`); }
  }
  return issues;
}
