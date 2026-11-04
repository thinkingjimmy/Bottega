/**
 * [INPUT]: One committed revision's complete immutable resource map and board identity.
 * [OUTPUT]: Exactly-one-runtime offline frozen-board HTML without a redundant root Base64 wrapper with reachable-only resource copies, syntax-position resource rewrites, exact digests and manifest-owned board navigation.
 * [POS]: Snapshot renderer preparation; live workspace bytes never enter a committed render.
 */
import { artifactMime } from "../../artifacts/admission/files";
import { DESIGN_LIMITS, DesignDocumentError, designDigest } from "./model";
import { designResourceReferences, designResourceTarget } from "./resources/references";
import { rewriteReferences } from "./resources/types";
import type { DesignDocuments } from "./service";
import type { DesignRevision } from "./store";

export async function prepareDesignBoard(service: DesignDocuments, chatId: string, incarnationId: string,
  documentId: string, revision: number, boardId?: string) {
  const snapshot = await service.readRevision(chatId, incarnationId, documentId, revision);
  return prepareDesignSnapshot(snapshot, boardId);
}
export async function prepareDesignSnapshot(snapshot: { version: DesignRevision; files: { path: string; data: Uint8Array }[] }, boardId?: string) {
  const { documentId } = snapshot.version.manifest, { revision } = snapshot.version;
  const board = snapshot.version.manifest.boards.find(value => value.id === (boardId ?? snapshot.version.manifest.launchBoard));
  if (!board) throw new DesignDocumentError("INVALID_DOCUMENT", "Board ID is not in this revision");
  const files = new Map(snapshot.files.map(file => [file.path, file.data]));
  if (snapshot.version.manifest.contentFormat === "dashboard/v1") {
    const runtime = await (await import("../../artifacts/render/native/assets")).nativeEditorAssets("dashboard/v1");
    const html = await (await import("../dashboard/resources")).prepareDashboardPage(snapshot.files, documentId, runtime);
    return { html, size: board.viewport, metadata: { documentId, revision, boardId: board.id, boardDigest: designDigest(files.get(board.file)!), readSetDigest: snapshot.version.readSetDigest,
      snapshotRef: snapshot.version.snapshotRef, contentFormat: "dashboard/v1" as const, navigation: {} as Record<string, string> } };
  }
  const slides = snapshot.version.manifest.contentFormat === "slides/v4";
  const nativeSource = snapshot.version.manifest.contentFormat === "canvas-dc/v3";
  const systemDc = !nativeSource && await (await import("../systems/components/proof")).isSystemDcBoard(snapshot, board.file), native = nativeSource || systemDc;
  const runtime = native ? (await (await import("../../artifacts/render/native/assets")).nativeEditorAssets()).get("artifact-type/dc-runtime.js") : undefined;
  if (native && !runtime) throw new DesignDocumentError("INVALID_DOCUMENT", "Native document runtime is unavailable");
  const nativeAssets = native || slides ? await (await import("../../artifacts/render/native/assets")).nativeEditorAssets(slides ? "slides/v4" : "canvas-dc/v3") : undefined;
  if (runtime) files.set("@runtime/support.js", runtime);
  const resourceTarget = async (path: string, url: string) => (native || slides) ? (await import("../native/resources")).nativeResourceTarget(path, url, new Set(files.keys())) : designResourceTarget(path, url);
  const cache = new Map<string, string>(), active = new Set<string>();
  let generatedBytes = 0;
  const prepare = async (path: string, root = false): Promise<string> => {
    const cached = cache.get(path); if (cached) return cached;
    const bytes = files.get(path);
    if (!bytes || active.has(path)) throw new DesignDocumentError("INVALID_DOCUMENT", `Missing or cyclic loaded render dependency: ${path}`);
    active.add(path);
    let content: Buffer = Buffer.from(bytes);
    if (/\.(?:html|css|[cm]?js|svg)$/i.test(path)) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes), references = await designResourceReferences(text, path);
      const replacements = new Map<number, string>();
      for (const reference of references) {
        if (reference.kind === "navigation") continue;
        const target = await resourceTarget(path, reference.url); if (!target) continue;
        const hash = reference.url.indexOf("#"), fragment = hash < 0 ? "" : "#" + encodeURIComponent(reference.url.slice(hash + 1)).replaceAll("'", "%27");
        replacements.set(reference.start, await prepare(target) + fragment);
      }
      content = Buffer.from(rewriteReferences(text, references, reference => replacements.get(reference.start) ?? null));
    }
    active.delete(path);
    if (root) return content.toString("utf8");
    const uri = `data:${artifactMime(path)};base64,${content.toString("base64")}`;
    generatedBytes += Buffer.byteLength(uri);
    if (generatedBytes > DESIGN_LIMITS.archive) throw new DesignDocumentError("BUDGET_EXCEEDED", "Prepared render resources exceed the transfer budget");
    cache.set(path, uri); return uri;
  };
  let html = Buffer.from(await prepare(board.file, true));
  if (slides) {
    const assets = nativeAssets!;
    const viewer = assets.get("artifact-type/slides-runtime.js"), css = [...assets].find(([path]) => /^assets\/.*\.css$/.test(path))?.[1];
    if (!viewer || !css) throw new DesignDocumentError("INVALID_DOCUMENT", "The fixed Slides viewer is unavailable");
    const deck = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(files.get("deck.json")!)) as { faces?: Record<string, { family: string; src?: string; href?: string }> };
    const faces: { family: string; src: string }[] = [], resources: [string, string][] = [];
    for (const face of Object.values(deck.faces ?? {})) {
      if (!face.src || face.href) throw new DesignDocumentError("INVALID_DOCUMENT", "Capture the selected Slides font resources before rendering");
      const target = await resourceTarget("deck.json", face.src);
      if (!target) throw new DesignDocumentError("INVALID_DOCUMENT", "A captured Slides font is missing");
      faces.push({ family: face.family, src: face.src });
      resources.push([face.src, await prepare(target)]);
    }
    const source = new TextDecoder("utf-8", { fatal: true }).decode(files.get(board.file)!);
    for (const reference of await designResourceReferences(source, board.file)) {
      if (reference.kind === "navigation") continue;
      const target = await resourceTarget(board.file, reference.url);
      if (target) resources.push([reference.url, await prepare(target)]);
    }
    html = (await import("../native/slides-view")).nativeSlideHtml({ source, slideId: board.file.slice(7, -5), viewer, css, faces, resources });
  }
  const navigation: Record<string, string> = {};
  for (const reference of await designResourceReferences(new TextDecoder().decode(files.get(board.file)!), board.file)) {
    if (reference.kind !== "navigation") continue;
    const target = await resourceTarget(board.file, reference.url), destination = snapshot.version.manifest.boards.find(value => value.file === target);
    if (destination) navigation[reference.url] = destination.id;
  }

  if (native) {
    const hasBoot = systemDc || (await designResourceReferences(new TextDecoder().decode(files.get(board.file)!), board.file)).some(reference => /^(?:\.\/)?support\.js$/.test(reference.url));
    const setup = `<script>window.__dcSourcePath=${JSON.stringify(board.file).replaceAll("<", "\\u003c")};window.__resources={};</script>${hasBoot ? "" : `<script src="data:text/javascript;base64,${Buffer.from(runtime!).toString("base64")}"></script>`}`;
    const text = html.toString("utf8"); html = Buffer.from(text.replace(/<head([^>]*)>/i, value => value + setup));
  }
  if (nativeAssets) html = Buffer.concat([html, (await import("../native/notices")).nativeDocumentNotices(nativeAssets, snapshot.files)]);
  if (html.length > DESIGN_LIMITS.archive) throw new DesignDocumentError("BUDGET_EXCEEDED", "Prepared board exceeds the render budget");
  return { html, size: board.viewport, metadata: { documentId, revision, boardId: board.id,
    boardDigest: designDigest(files.get(board.file)!), readSetDigest: snapshot.version.readSetDigest,
    snapshotRef: snapshot.version.snapshotRef, contentFormat: slides ? "slides/v4" as const : native ? "canvas-dc/v3" as const : undefined, navigation } };
}
