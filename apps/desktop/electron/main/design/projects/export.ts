/**
 * [INPUT]: One authorized fixed journal cut, complete immutable source ancestry and verified native runtime resources.
 * [OUTPUT]: Frozen complete project ZIP with original directories/History, portable source graph and bounded progress.
 * [POS]: Read-only project export; no live workspace scan, model call, source effect or second version ledger.
 */
import type { DesignDocuments } from "../documents/service";
import type { DesignRevision } from "../documents/store";
import { designDigest, requestKey } from "../documents/model";
import { readCanonicalSystem, systemEditorProjection } from "../systems/native/editor";
import { historyVersion } from "../history/service";
import { portableSystemBindings } from "./portable";
import { createProjectMembers, type ProjectFormat, type ProjectVersion } from "./model";
import { packProjectZip, PROJECT_ZIP_LIMITS, type ProjectMember } from "./zip";
export type ProjectProgress = { stage: "versions" | "resources" | "archive" | "complete"; completed: number; total: number };
export async function exportDesignProject(documents: DesignDocuments, selected: DesignRevision, options: { signal: AbortSignal; current(): void; progress(value: ProjectProgress): void }) {
  const { signal, current, progress } = options, check = () => { signal.throwIfAborted(); current(); };
  check(); const { chatId, incarnationId } = selected.authority, id = selected.manifest.documentId;
  const authority = documents.authority(chatId, incarnationId), fixed = documents.store.revision(authority, id, selected.revision);
  if (!fixed || fixed.artifactId !== selected.artifactId || fixed.snapshotRef !== selected.snapshotRef) throw new Error("The selected saved project is unavailable");
  if (documents.store.unsupportedBlocks(authority, id) || documents.store.blocking().some(value => value.revision.authority.ownerId === authority.ownerId && value.revision.manifest.documentId === id && value.revision.revision <= selected.revision)) throw new Error("Required project history is unsupported or incomplete. Recover the original operation before exporting this cut.");
  const versions = documents.store.versions(authority, id).filter(value => value.revision <= selected.revision);
  if (versions.length > PROJECT_ZIP_LIMITS.versions || versions.length !== selected.revision || versions.some((value, index) => value.revision !== index + 1)) throw new Error("The complete project history cannot be handed off within its supported version budget");
  const contentFormat = selected.manifest.system ? "design-system/v1" : selected.manifest.contentFormat as ProjectFormat;
  let canvasRuntime: ReadonlyMap<string, Uint8Array> | undefined;
  if (contentFormat === "canvas-dc/v3") { canvasRuntime = await (await import("../../artifacts/render/native/assets")).nativeEditorAssets("canvas-dc/v3"); check(); }
  const projection: ProjectVersion[] = []; let materialized = 0;
  for (const [index, version] of versions.entries()) {
    check(); progress({ stage: "versions", completed: index, total: versions.length });
    if (version.manifest.format !== selected.manifest.format || version.manifest.contentFormat !== selected.manifest.contentFormat) throw new Error("The project contains unsupported mixed-format history; a complete handoff cannot discard it");
    const snapshot = await documents.readRevision(chatId, incarnationId, id, version.revision); check();
    const native = new Map<string, Uint8Array>(), source = await portableSystemBindings(documents, version, snapshot.files, check, new Date(historyVersion(documents, version).createdAt).toISOString()); check();
    progress({ stage: "resources", completed: index, total: versions.length });
    if (version.manifest.system) {
      const system = readCanonicalSystem(version.manifest, source);
      for (const [path, bytes] of systemEditorProjection(system, version.manifest, source)) native.set(path, bytes);
      const components = system.components.components.filter(component => component.mode === "mounted" && native.has(`project/components/${component.name}/preview.html`));
      if (components.length) {
        const previews = Object.fromEntries(components.map(component => [component.name, new TextDecoder("utf-8", { fatal: true }).decode(native.get(`project/components/${component.name}/preview.html`)!)]));
        // Native recipients get real isolated component exports; each fixed React19 closure owns its own hooks and resources.
        const value = JSON.stringify(previews).replaceAll("<", "\\u003c");
        const code = `/* @ds-bundle: {"namespace":"BottegaSystem","representation":"isolated-fixed-components"} */\n(function(){const previews=${value};const R=window.React;if(!R)throw new Error('The native component React runtime is missing');window.BottegaSystem=Object.fromEntries(Object.entries(previews).map(([name,html])=>[name,function FixedComponent(){return R.createElement('iframe',{title:name,sandbox:'allow-scripts',srcDoc:html,style:{width:'100%',height:900,border:0}})}]));})();\n`;
        native.set("project/components/bundle.js", Buffer.from(code));
        const index = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(native.get("project/design-system.json")!));
        native.set("project/design-system.json", Buffer.from(JSON.stringify({ ...index, libraries: [{ name: "react", version: "18" }, { name: "react-dom", version: "18" }] }, null, 2) + "\n"));
      }
      // Original per-file tooling can inspect captured component/style source as ordinary inert files.
      for (const captured of system.sources.files) { const bytes = source.find(file => file.path === captured.capturedPath)?.data; if (!bytes || designDigest(bytes) !== captured.digest) throw new Error("A fixed System source is missing"); native.set("project/" + captured.capturedPath, bytes); }
    } else {
      for (const file of source) if (file.path !== "comments.json") {
        const data = contentFormat === "dashboard/v1" && file.path.startsWith("db/") ? Buffer.from(JSON.stringify(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.data)), null, 2) + "\n") : file.data;
        native.set((contentFormat === "dashboard/v1" ? "" : "project/") + file.path, data);
      }
      if (canvasRuntime && !native.has("project/support.js")) { const bytes = canvasRuntime.get("artifact-type/dc-runtime.js"); if (!bytes) throw new Error("The verified Canvas runtime is unavailable"); native.set("project/support.js", bytes); }
    }
    materialized += source.reduce((total, file) => total + file.data.length, 0) + [...native.values()].reduce((total, bytes) => total + bytes.length, 0);
    if (materialized > PROJECT_ZIP_LIMITS.expanded) throw new Error("Complete project history exceeds its materialization budget");
    const comments = source.find(file => file.path === "comments.json"); if (comments) native.set("comments.json", comments.data);
    const author = historyVersion(documents, version).author, operation = documents.store.operation(requestKey(authority, version.requestId)), original = operation?.sourceEdit?.input;
    projection.push({ n: version.revision, at: new Date(version.createdAt).toISOString(), author: { kind: author.kind === "user" ? "user" : author.kind === "restore" ? "restore" : author.kind === "agent" ? "agent" : "external", name: author.name },
      ...(original?.action === "native-history-restore" ? { restoredFrom: original.history!.revision, restoredPart: Boolean(original.history!.items) } : operation?.imported?.restoredFrom ? { restoredFrom: operation.imported.restoredFrom, restoredPart: operation.imported.restoredPart } : {}), source, native: [...native].map(([path, data]) => ({ path, data })) });
  }
  if (contentFormat === "dashboard/v1") {
    // The original Dashboard serves immutable uploads outside its historical DB reader.
    const uploads = new Map(projection.flatMap(version => version.native.filter(file => file.path.startsWith("_blobs/")).map(file => [file.path, file.data] as const)));
    for (const version of projection) { const native = new Map(version.native.map(file => [file.path, file.data])); for (const [path, data] of uploads) native.set(path, data); version.native = [...native].map(([path, data]) => ({ path, data })); }
  }
  check(); const root = "project-" + designDigest(JSON.stringify([contentFormat, selected.snapshotRef, selected.revision])).slice(7, 19);
  const members = createProjectMembers(root, contentFormat, selected.manifest.title, projection);
  progress({ stage: "archive", completed: versions.length, total: versions.length }); const bytes = packProjectZip(members, signal); check();
  let title = selected.manifest.title.replace(/[<>:"/\\|?*\p{Cc}]/gu, "_").trim() || "Project";
  while (Buffer.byteLength(title + "-v" + selected.revision + ".zip") > 240) title = Array.from(title).slice(0, -1).join("");
  progress({ stage: "complete", completed: versions.length, total: versions.length });
  return { bytes, filename: title + "-v" + selected.revision + ".zip", digest: designDigest(bytes), revision: selected.revision, snapshotRef: selected.snapshotRef,
    contentFormat, members: members.map((file: ProjectMember) => ({ path: file.path, bytes: file.data.length, digest: designDigest(file.data) })) };
}
