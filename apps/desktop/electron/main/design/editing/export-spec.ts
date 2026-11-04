/**
 * [INPUT]: Exact immutable revision/resource bytes, closed main-producer options and verified native runtime assets.
 * [OUTPUT]: createDesignExportSpec freezes normalized options and source/resource/font/runtime/engine identities before rendering or cache access.
 * [POS]: Main export identity shared by local rendering and private-file flights; glyph validation remains a separate font gate.
 */
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { DesignRevision } from "../documents/store";
import { designDigest, DesignDocumentError } from "../documents/model";
import { normalizeDesignExportRange } from "./export-range";
type Snapshot = { version: DesignRevision; files: { path: string; data: Uint8Array }[] };
const freeze = <T extends object>(value: T): Readonly<T> => {
  for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child);
  return Object.freeze(value);
};
export async function createDesignExportSpec(input: WorkspaceCommand, snapshot: Snapshot) {
  const range = freeze(normalizeDesignExportRange(input, snapshot.version));
  if (input.candidateId || input.candidateDigest)
    throw new DesignDocumentError("INVALID_DOCUMENT", "Export this sealed candidate through its candidate preview");
  const { version } = snapshot;
  const source = freeze({ documentId: version.manifest.documentId, revision: version.revision, snapshotRef: version.snapshotRef,
    readSetDigest: version.readSetDigest, contentFormat: version.manifest.contentFormat ?? "design-system/v1" });
  const files = snapshot.files.map(file => ({ path: file.path, bytes: file.data.length, digest: designDigest(file.data) })).sort((a, b) => a.path.localeCompare(b.path, "en"));
  const resources = freeze({ digest: designDigest(JSON.stringify(files)), files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) });
  const fontResources = freeze({ digest: designDigest(JSON.stringify(files.filter(file => /\.(?:woff2?|otf|ttf)$/i.test(file.path)))),
    verification: "captured-resources-only" as const });
  const selected = version.manifest.boards.filter(board => range.scope === "board" ? board.id === range.boardId : true);
  let native = Boolean(version.manifest.contentFormat);
  if (!native && version.manifest.format === "bottega-design-system") {
    const { isSystemDcBoard } = await import("../systems/components/proof");
    for (const board of selected) native ||= await isSystemDcBoard(snapshot, board.file);
  }
  const runtime = native ? await (await import("../../artifacts/render/native/assets")).nativeEditorAssets(version.manifest.contentFormat) : new Map<string, Uint8Array>();
  const nativeRuntime = native ? runtime.get(version.manifest.contentFormat === "slides/v4" ? "artifact-type/slides-runtime.js" : "artifact-type/dc-runtime.js") : undefined;
  if (native && !nativeRuntime) throw new DesignDocumentError("INVALID_DOCUMENT", "Native export runtime is unavailable");
  const spec = freeze({ version: "design-export/v5" as const, source, range, resources, fontResources,
    producer: { id: "bottega-main", rasterScale: 1, hideScrollbars: range.format === "png", annotations: "none", interactive: range.format === "html", variant: range.format,
      quality: range.format === "png" ? "lossless" : "format-default",
      printMedia: range.format === "pdf-fixed" && native ? "screen" : range.format === "pdf-flow" || range.format === "pdf-fixed" ? "print" : null,
      pageMarginInches: range.format === "pdf-flow" ? .4 : 0 },
    runtime: { dc: nativeRuntime && version.manifest.contentFormat !== "slides/v4" ? designDigest(nativeRuntime) : null,
      slides: nativeRuntime && version.manifest.contentFormat === "slides/v4" ? designDigest(nativeRuntime) : null, electron: process.versions.electron ?? "unavailable",
      chromium: process.versions.chrome ?? "unavailable", platform: process.platform, arch: process.arch } });
  return { spec, digest: designDigest(JSON.stringify(spec)) };
}
export type DesignExportSpec = Awaited<ReturnType<typeof createDesignExportSpec>>;
