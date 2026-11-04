/**
 * [INPUT]: One immutable native formal/candidate snapshot, closed producer choices and verified maintained runtime bytes.
 * [OUTPUT]: Frozen native export specification/digest and a separate read-only selected-source projection.
 * [POS]: Original native producer planning; derived index/notes bytes never write the working source or its journal.
 */
import { parseFragment } from "parse5";
import { normalizeNativeExportOptions, type NativeExportOptions } from "@ai-chat/cloud-protocol/artifacts/design/export/options";
import { projectNativeManifest } from "@ai-chat/cloud-protocol/artifacts/design/native/source";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { nativeEditorAssets } from "../../../artifacts/render/native/assets";
import { designDigest, DesignDocumentError } from "../../documents/model";
import type { DesignRevision } from "../../documents/store";
export type NativeExportSnapshot = { version: DesignRevision; files: { path: string; data: Uint8Array }[] };
const freeze = <T extends object>(value: T): Readonly<T> => {
  for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child);
  return Object.freeze(value);
};
export async function createNativeExportPlan(input: WorkspaceCommand, snapshot: NativeExportSnapshot, choices: unknown) {
  const { version } = snapshot, format = version.manifest.contentFormat;
  if (format !== "canvas-dc/v3" && format !== "slides/v4") throw new DesignDocumentError("INVALID_DOCUMENT", "Choose an original native Canvas or Slides document");
  if (Boolean(input.candidateId) !== Boolean(input.candidateDigest)) throw new Error("Native export needs the complete sealed candidate identity");
  if (input.candidateDigest && input.candidateDigest !== version.snapshotRef) throw new Error("The export belongs to another sealed candidate");
  const options = normalizeNativeExportOptions(choices, { contentFormat: format, pages: version.manifest.boards.map(board => board.id), launchPage: version.manifest.launchBoard });
  const files = snapshot.files.map(file => ({ path: file.path, bytes: file.data.length, digest: designDigest(file.data) })).sort((a, b) => a.path.localeCompare(b.path, "en"));
  const assets = await nativeEditorAssets(format);
  const font = await (await import("../fonts/catalog")).fixedDesignFont();
  const runtime = [...assets].map(([path, bytes]) => ({ path, bytes: bytes.length, digest: designDigest(bytes) })).sort((a, b) => a.path.localeCompare(b.path, "en"));
  const source = input.candidateId ? { kind: "candidate" as const, candidateId: input.candidateId, candidateDigest: input.candidateDigest!, documentId: version.manifest.documentId,
    snapshotRef: version.snapshotRef, readSetDigest: version.readSetDigest, revision: version.revision } :
    { kind: "formal" as const, documentId: version.manifest.documentId, snapshotRef: version.snapshotRef, readSetDigest: version.readSetDigest, revision: version.revision };
  const spec = freeze({ version: "native-export/v1" as const, contentFormat: format, source, options,
    resources: { digest: designDigest(JSON.stringify(files)), files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) },
    fonts: { policy: options.fonts, verifier: format === "canvas-dc/v3" ? "fixed-cdp-native-source/v3" : "fixed-cdp/v1", catalog: { id: font.info.id, metadataDigest: designDigest(JSON.stringify(font.info)) }, sourceDigest: designDigest(JSON.stringify(files.filter(file => /\.(?:ttf|otf|woff2?)$/i.test(file.path)))) },
    producer: { decoration: "native-notices/v1", id: format === "slides/v4" ? "maintained-slides" : "maintained-canvas", runtimeDigest: designDigest(JSON.stringify(runtime)), byteBudget: 32 * 1024 * 1024,
      engine: { electron: process.versions.electron ?? "unavailable", chromium: process.versions.chrome ?? "unavailable", platform: process.platform, arch: process.arch } } });
  return { spec, digest: designDigest(JSON.stringify(spec)) };
}
export type NativeExportPlan = Awaited<ReturnType<typeof createNativeExportPlan>>;
function withoutNotes(data: Uint8Array): Uint8Array {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(data), fragment = parseFragment(source, { sourceCodeLocationInfo: true });
  const section = fragment.childNodes.find(node => "tagName" in node && node.tagName === "section");
  if (!section || !("childNodes" in section)) throw new Error("Native section is missing");
  const spans = section.childNodes.filter(node => "tagName" in node && node.tagName === "aside").map(node => node.sourceCodeLocation!);
  let result = source;
  for (const span of spans.reverse()) result = result.slice(0, span.startOffset) + result.slice(span.endOffset);
  return Buffer.from(result);
}
export function nativeExportProjection(snapshot: NativeExportSnapshot, options: NativeExportOptions): NativeExportSnapshot {
  const paths = options.pages.map(id => snapshot.version.manifest.boards.find(board => board.id === id)!.file), selected = new Set(paths);
  const slides = snapshot.version.manifest.contentFormat === "slides/v4", name = slides ? "deck.json" : "canvas.json";
  const data = snapshot.files.find(file => file.path === name)!.data;
  const index = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  if (slides) {
    index.order = paths.map(path => path.slice(7, -5)); index.cover = index.order[0];
    index.sections = Object.fromEntries(Object.entries(index.sections ?? {}).filter(([, value]) => index.order.includes((value as { start: string }).start)));
  } else {
    index.order = paths;
    index.boards = Object.fromEntries(paths.map(path => {
      const board = { ...index.boards[path] };
      if (options.format === "pdf") { board.paper = options.paper; if (options.layout === "flow") board.print = "flow"; else delete board.print; }
      return [path, board];
    }));
    index.launch = options.format === "png" && paths.length === 1 ? { view: "focused", file: paths[0] } : { view: "canvas" };
    if (paths.length !== snapshot.version.manifest.boards.length) index.notes = {};
  }
  const files = snapshot.files.filter(file => !slides && options.format === "html" && options.bundle || !(slides ? /^slides\/[^/]+\.html$/.test(file.path) : /\.dc\.html$/.test(file.path) && !/^(?:assets|ds)\//.test(file.path)) || selected.has(file.path))
    .map(file => file.path === name ? { path: name, data: Buffer.from(JSON.stringify(index)) } : slides && selected.has(file.path) && !options.notes ? { path: file.path, data: withoutNotes(file.data) } : file);
  const manifest = projectNativeManifest(files, snapshot.version.manifest.documentId);
  if (!manifest || manifest.boards.length !== selected.size) throw new Error("The fixed native export range is incomplete");
  return { version: { ...snapshot.version, manifest }, files };
}
