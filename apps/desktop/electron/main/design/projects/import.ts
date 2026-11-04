/**
 * [INPUT]: Complete untrusted project ZIP bytes, a newly main-allocated document ID and cancellation.
 * [OUTPUT]: Validated immutable canonical revisions and exact hash-bound original-journal import under new source identity.
 * [POS]: Pure preparation followed only by explicit original-journal admission; authored source never executes in main.
 */
import { designId, manifestSchema } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { unpackProjectZip, PROJECT_ZIP_LIMITS } from "./zip";
import { readProjectMembers } from "./model";
import { transformedDesignSet } from "../documents/edits";
import { requireValidDesignSet } from "../documents/resources/validation";
export async function prepareProjectImport(bytes: Uint8Array, documentId: string, signal: AbortSignal, progress: (completed: number, total: number) => void = () => {}) {
  signal.throwIfAborted(); designId.parse(documentId);
  const project = readProjectMembers(unpackProjectZip(bytes, signal));
  const logical = project.versions.reduce((total, version) => total + version.source.reduce((sum, file) => sum + file.data.length, 0), 0);
  if (logical > PROJECT_ZIP_LIMITS.expanded) throw new Error("Complete canonical history exceeds its materialization budget");
  const path = (project.contentFormat === "design-system/v1" ? "design-systems/" : "design/") + documentId, versions = [];
  for (const [index, version] of project.versions.entries()) {
    signal.throwIfAborted(); progress(index, project.versions.length); let files: readonly { path: string; data: Uint8Array }[] = version.source;
    if (project.contentFormat === "design-system/v1") {
      const raw = files.find(file => file.path === "canvas.json"); if (!raw) throw new Error("Missing canonical System manifest");
      const original = manifestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw.data)));
      if (original.format !== "bottega-design-system") throw new Error("The imported System has a different canonical format");
      await requireValidDesignSet(transformedDesignSet("design-systems/" + original.documentId, files)); signal.throwIfAborted();
      const updated = { ...original, documentId };
      files = files.map(file => file.path === "canvas.json" ? { ...file, data: Buffer.from(JSON.stringify(updated, null, 2) + "\n") } : file);
      // DC namespaces include their source system ID and require a fresh isolated compile.
      files = await (await import("./systems")).rehomeSystemComponents(files, updated, signal);
    }
    const source = transformedDesignSet(path, files), manifest = await requireValidDesignSet(source); signal.throwIfAborted();
    const actual = manifest.system ? "design-system/v1" : manifest.contentFormat;
    if (actual !== project.contentFormat || manifest.documentId !== documentId) throw new Error("The imported revision changes its explicit content format or identity");
    if (manifest.systems?.length) {
      const issues = await (await import("../systems/consume")).validateSystemBindings(source);
      signal.throwIfAborted();
      if (issues.length) throw new Error("The project has an incomplete fixed System copy: " + issues[0]!.message);
    }
    versions.push({ source, manifest, author: version.author, at: Date.parse(version.at), ...(version.restoredFrom ? { restoredFrom: version.restoredFrom, restoredPart: version.restoredPart ?? false } : {}) });
  }
  progress(versions.length, versions.length); return { path, title: project.title, contentFormat: project.contentFormat, versions };
}
export type PreparedProjectImport = Awaited<ReturnType<typeof prepareProjectImport>>;

export async function importProjectBytes(input: import("@ai-chat/cloud-protocol/artifacts/design/model").WorkspaceCommand, bytes: Uint8Array, current: () => void, signal = new AbortController().signal) {
  current(); signal.throwIfAborted();
  if (bytes.length < 1 || bytes.length > PROJECT_ZIP_LIMITS.transfer || (await import("../documents/model")).designDigest(bytes) !== input.sourceDigest) throw new Error("The project input does not match its fixed source hash or byte budget");
  return (await import("../documents/runtime")).designDocuments().importProject(input, id => prepareProjectImport(bytes, id, signal), () => { current(); signal.throwIfAborted(); });
}
