/**
 * [INPUT]: A current design revision and one explicitly selected immutable system revision.
 * [OUTPUT]: A fixed version binding, copied complete resources and syntax-position stylesheet links.
 * [POS]: System consumption through the existing edit journal; later system updates cannot change this copy.
 */
import { posix } from "node:path";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
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
  const closure = snapshot.files.filter(file => file.path !== "canvas.json" && file.path !== "overview.html");
  for (const file of closure) { const path = prefix + file.path; sourcePath.parse(path); files.set(path, Buffer.from(file.data)); }
  const binding = systemBindingSchema.parse({ documentId: input.systemId, revision: input.targetRevision, snapshotRef: snapshot.version.snapshotRef,
    files: closure.map(file => prefix + file.path) });
  const manifest = { ...version.manifest, systems: [...(version.manifest.systems ?? []).filter(value => value.documentId !== input.systemId), binding] };
  for (const board of manifest.boards) {
    const bytes = files.get(board.file); if (!bytes) throw new DesignDocumentError("INVALID_DOCUMENT", "Consumer board is missing");
    const href = posix.relative(posix.dirname(board.file), prefix + "tokens.css");
    files.set(board.file, Buffer.from(stylesheetLink(new TextDecoder("utf-8", { fatal: true }).decode(bytes), input.systemId, href)));
  }
  files.set("canvas.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
  return [...files].map(([path, data]) => ({ path, data }));
}
export async function validateSystemBindings(readSet: DesignReadSet, authority: DesignAuthority): Promise<DesignIssue[]> {
  const issues: DesignIssue[] = [];
  const issue = (message: string) => { if (issues.length < 32) issues.push({ file: "canvas.json", message: message.slice(0, 500) }); };
  const bytes = readSet.files.find(file => file.path === "canvas.json")?.data;
  if (!bytes) return issues;
  let manifest;
  try { manifest = manifestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); }
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
      const prefix = `systems/${binding.documentId}/`, closure = snapshot.files.filter(file => file.path !== "canvas.json" && file.path !== "overview.html");
      const expected = closure.map(file => prefix + file.path).sort();
      if (new Set(binding.files).size !== binding.files.length || JSON.stringify([...binding.files].sort()) !== JSON.stringify(expected)) {
        issue(`Fixed system closure is incomplete or contains unrelated paths: ${binding.documentId}`); continue;
      }
      for (const file of closure) {
        const current = readSet.files.find(value => value.path === prefix + file.path);
        if (!current || designDigest(current.data) !== designDigest(file.data)) issue(`Fixed system resource differs from v${binding.revision}: ${prefix + file.path}`);
      }
    } catch { issue(`System revision is unavailable to this Chat: ${binding.documentId} v${binding.revision}`); }
  }
  return issues;
}
