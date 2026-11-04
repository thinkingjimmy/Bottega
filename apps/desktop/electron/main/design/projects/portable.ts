/**
 * [INPUT]: Complete immutable consumer/System source, exact binding hashes and existing native projection rules.
 * [OUTPUT]: Verified self-contained fixed System copies and consumer bytes independent of the original Chat.
 * [POS]: Project handoff adaptation; copied Systems provide content and no host execution or write authority.
 */
import { packArtifactArchive, unpackArtifactArchive } from "@ai-chat/cloud-protocol/artifacts/archive";
import { readDesignManifest } from "@ai-chat/cloud-protocol/artifacts/design/core/source";
import { systemBindingSchema } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { designDigest } from "../documents/model";
import { transformedDesignSet } from "../documents/edits";
import { validateDesignSystem } from "../systems/validation";
import { nativeSystemProjection, type NativeSystemSnapshot } from "../systems/native/projection";
import { nativeSystemIndex } from "../systems/native/apply";
import { portableComments } from "./model";
import type { DesignDocuments } from "../documents/service";
import type { DesignRevision } from "../documents/store";
type Member = { path: string; data: Uint8Array };
type Binding = NonNullable<DesignRevision["manifest"]["systems"]>[number];
export function readPortableSystem(files: readonly Member[], input: Binding): NativeSystemSnapshot {
  const binding = systemBindingSchema.parse(input), path = `systems/${binding.documentId}/source.tar`;
  if (!binding.copy || binding.copy.path !== path || binding.copy.digest !== binding.snapshotRef || !binding.files.includes(path)) throw new Error("The fixed System has no exact portable source copy");
  const bytes = files.find(file => file.path === path)?.data;
  if (!bytes || designDigest(bytes) !== binding.copy.digest) throw new Error("The portable System source copy is missing or corrupt");
  const source = unpackArtifactArchive(bytes, 512), manifest = readDesignManifest(source, binding.documentId);
  if (manifest.format !== "bottega-design-system" || manifest.documentId !== binding.documentId) throw new Error("The portable source copy is not the selected System");
  const issues = validateDesignSystem(transformedDesignSet("design-systems/" + binding.documentId, source));
  if (issues.length) throw new Error("The portable System has invalid or incomplete captured resources: " + issues[0]!.message);
  return { version: { manifest, revision: binding.revision, snapshotRef: binding.snapshotRef }, files: source };
}
export async function portableSystemBindings(documents: DesignDocuments, version: DesignRevision, source: readonly Member[], check: () => void, versionAt: string): Promise<readonly Member[]> {
  if (!version.manifest.systems?.length) return source;
  const target = version.manifest.contentFormat;
  if (target !== "canvas-dc/v3" && target !== "slides/v4") throw new Error("This project format cannot carry fixed System bindings");
  const files = new Map(source.map(file => [file.path, file.data])), index = target === "slides/v4" ? "deck.json" : "canvas.json";
  let raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(files.get(index)!)) as Record<string, unknown>;
  const bindings: Binding[] = [];
  for (const binding of version.manifest.systems) {
    check();
    const snapshot = binding.copy ? readPortableSystem(source, binding) : await documents.readRevision(version.authority.chatId, version.authority.incarnationId, binding.documentId, binding.revision);
    check();
    if (snapshot.version.manifest.format !== "bottega-design-system" || snapshot.version.manifest.documentId !== binding.documentId || snapshot.version.snapshotRef !== binding.snapshotRef) throw new Error("A fixed System binding no longer identifies its exact source");
    const canonical = snapshot.files.map(file => ({ path: file.path, data: file.path === "comments.json" ? portableComments(file.data) : file.data }));
    const bytes = packArtifactArchive(canonical, 512), digest = designDigest(bytes), path = `systems/${binding.documentId}/source.tar`;
    const projection = await nativeSystemProjection({ version: { ...snapshot.version, snapshotRef: digest }, files: canonical }, target);
    check();
    const closure = [...projection.closure, ...projection.derived, { path, data: bytes }], prior = new Set(binding.files);
    for (const file of closure) {
      const existing = files.get(file.path);
      if (existing && !prior.has(file.path) && designDigest(existing) !== designDigest(file.data)) throw new Error("A fixed System copy would replace an unrelated project resource");
      files.set(file.path, file.data);
    }
    const paths = new Set(closure.map(file => file.path));
    for (const old of prior) if (!paths.has(old)) files.delete(old);
    bindings.push(systemBindingSchema.parse({ documentId: binding.documentId, revision: binding.revision, snapshotRef: digest, files: [...paths], copy: { path, digest } }));
    const rows = Array.isArray(raw.designSystems) ? raw.designSystems : [];
    const copied = rows.find(row => row && typeof row === "object" && row.artifact === binding.documentId && typeof row.copiedAt === "string" && Number.isFinite(Date.parse(row.copiedAt)));
    raw = nativeSystemIndex(raw, projection, copied?.copiedAt ?? versionAt);
  }
  files.set(index, Buffer.from(JSON.stringify({ ...raw, bottegaSystems: bindings }, null, 2) + "\n"));
  return [...files].map(([path, data]) => ({ path, data }));
}
