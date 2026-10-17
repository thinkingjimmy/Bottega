/**
 * [INPUT]: Main-captured source, closed Canvas batches and an original-Chat image reader.
 * [OUTPUT]: Complete in-memory page/board/object/source transforms with host IDs, compact JSON manifests and retained files.
 * [POS]: One semantic edit transformer; all validation precedes the existing journal's prepare/write effects.
 */
import { posix } from "node:path";
import { locateDesignElement } from "@ai-chat/cloud-protocol/artifacts/design/anchors";
import { CANVAS_LIMITS, canvasObjectSchema, canvasObjectInputSchema, type CanvasObject } from "@ai-chat/cloud-protocol/artifacts/design/canvas/model";
import { canvasOperationsSchema, type CanvasOperation } from "@ai-chat/cloud-protocol/artifacts/design/canvas/commands";
import { canvasPages, readCanvas } from "@ai-chat/cloud-protocol/artifacts/design/canvas/view";
import { sniffImageMime, artifactExtension } from "@ai-chat/cloud-protocol/artifacts/media-types";
import { DesignDocumentError, designDigest, manifestSchema, sourcePath, type DesignReadSet, type DesignManifest } from "../documents/model";
import { designResourceReferences, designResourceTarget } from "../documents/resources/references";
import { rewriteReferences } from "../documents/resources/types";
import { escapeCanvasText } from "@ai-chat/cloud-protocol/artifacts/design/canvas/markup";
import { patchCanvasSource, type SourceOperation } from "./source";
import { canvasLayerMarkup, replaceCanvasLayer, requireCanvasFont, requireCanvasNavigation } from "./layers";
type ImageSource = { kind: "artifact"; artifactId: string; digest: string };
export type CanvasTransformPorts = { readImage(source: ImageSource): Promise<Uint8Array> };
const invalid = (message: string): never => { throw new DesignDocumentError("INVALID_DOCUMENT", message); };
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
export async function transformCanvas(source: DesignReadSet, requestId: string, raw: readonly CanvasOperation[], ports: CanvasTransformPorts) {
  try { return await transformCanvasSet(source, requestId, raw, ports); }
  catch (cause) {
    if (cause instanceof DesignDocumentError || cause instanceof Error && /ARTIFACT_(?:DISABLED|GENERATION)/.test(cause.message)) throw cause;
    throw new DesignDocumentError("INVALID_DOCUMENT", cause instanceof Error ? cause.message.slice(0, 500) : "Canvas source or object is not editable");
  }
}
async function transformCanvasSet(source: DesignReadSet, requestId: string, raw: readonly CanvasOperation[], ports: CanvasTransformPorts) {
  const operations = canvasOperationsSchema.parse(raw), files = new Map(source.files.map(file => [file.path, Buffer.from(file.data)]));
  const original = manifestSchema.parse(JSON.parse(decode(files.get("canvas.json")!).replace(/^\uFEFF/, "")));
  if (original.format !== "bottega-design") invalid("Canvas editing requires a design document, not a design system");
  const manifest: DesignManifest = { ...original, pages: canvasPages(original).map(page => ({ ...page })),
    boards: readCanvas(original, []).boards, objects: structuredClone(original.objects ?? []) };
  const id = (index: number, label: string) => `canvas-${designDigest(JSON.stringify([manifest.documentId, requestId, index, label])).slice(7, 39)}`;
  const fileSet = () => [...files].map(([path, data]) => ({ path, data }));
  const retargetHref = (from: string, href: string, copies: Map<string, string>, objectIds: Map<string, string>) => {
    let suffix = href.match(/[?#].*$/)?.[0] ?? "";
    const hash = suffix.indexOf("#"), objectId = hash < 0 ? undefined : objectIds.get(suffix.slice(hash + 1));
    if (objectId) suffix = suffix.slice(0, hash) + "#" + objectId;
    if (href.startsWith("#")) return objectId ? suffix : href;
    const target = designResourceTarget(from, href), copied = target && copies.get(target);
    return copied ? posix.relative(posix.dirname(from), copied) + suffix : objectId ? href.slice(0, href.length - (href.match(/[?#].*$/)?.[0].length ?? 0)) + suffix : href;
  };
  const page = (pageId: string) => manifest.pages!.find(page => page.id === pageId) ?? invalid("Page is missing from this version");
  const board = (boardId: string) => manifest.boards.find(board => board.id === boardId) ?? invalid("Board is missing from this version");
  const object = (objectId: string) => manifest.objects!.find(object => object.id === objectId) ?? invalid("Object is missing from this version");
  const putObject = (value: CanvasObject) => {
    const parsed = canvasObjectSchema.parse(value); page(parsed.pageId);
    if (parsed.boardId && board(parsed.boardId).pageId !== parsed.pageId) invalid("Object and board must belong to the same page");
    if (parsed.style?.["font-family"]) requireCanvasFont(manifest, fileSet(), parsed.style["font-family"]);
    return parsed;
  };
  const cloneBoard = (original: DesignManifest["boards"][number], pageId: string, index: number, label: string, objectIds: Map<string, string>) => {
    page(pageId); const boardId = id(index, label), file = posix.join(posix.dirname(original.file), boardId + ".html"); sourcePath.parse(file);
    if (files.has(file)) invalid("Host copy path already exists. Start a new action after reading the current source.");
    const bytes = files.get(original.file) ?? invalid("Board source is missing");
    files.set(file, Buffer.from(replaceCanvasLayer(decode(bytes), "")));
    const cloned = { ...original, id: boardId, file, pageId, title: (original.title + " copy").slice(0, 250) };
    manifest.boards.push(cloned);
    for (const child of manifest.objects!.filter(value => value.boardId === original.id)) {
      const objectId = id(index, label + ":" + child.id); objectIds.set(child.id, objectId);
      manifest.objects!.push(putObject({ ...structuredClone(child), id: objectId, pageId, boardId }));
    }
    return cloned;
  };
  // Every source anchor is checked against the same untouched capture before any in-memory action.
  const sourceEdits = operations.filter((value): value is SourceOperation => value.type === "source.update");
  const spans: { file: string; start: number; end: number }[] = [];
  for (const edit of sourceEdits) {
    const sourceBoard = original.boards.find(board => board.id === edit.anchor.boardId) ?? invalid("Source anchor names another board");
    const html = decode(files.get(sourceBoard.file)!), location = locateDesignElement(html, edit.anchor).sourceCodeLocation!;
    if (spans.some(span => span.file === sourceBoard.file && location.startOffset < span.end && location.endOffset > span.start)) invalid("Source edits overlap or repeat a target. Combine properties into one source update.");
    patchCanvasSource(html, edit);
    spans.push({ file: sourceBoard.file, start: location.startOffset, end: location.endOffset });
  }
  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index]!;
    switch (operation.type) {
      case "page.create": manifest.pages!.push({ id: id(index, "page"), title: operation.title }); break;
      case "page.rename": page(operation.pageId).title = operation.title; break;
      case "page.duplicate": {
        const previous = page(operation.pageId), pageId = id(index, "page"), copies = new Map<string, string>(), objectIds = new Map<string, string>();
        manifest.pages!.push({ id: pageId, title: operation.title ?? (previous.title + " copy").slice(0, 250) });
        for (const value of [...manifest.boards].filter(value => value.pageId === previous.id)) {
          const cloned = cloneBoard(value, pageId, index, "board:" + value.id, objectIds); copies.set(value.file, cloned.file);
        }
        for (const value of [...manifest.objects!].filter(value => value.pageId === previous.id && !value.boardId)) {
          const objectId = id(index, "object:" + value.id); objectIds.set(value.id, objectId);
          manifest.objects!.push(putObject({ ...structuredClone(value), id: objectId, pageId }));
        }
        for (const value of manifest.objects!.filter(value => value.pageId === pageId)) if (value.kind === "text" && value.href) value.href = retargetHref(value.boardId ? board(value.boardId).file : "canvas.json", value.href, copies, objectIds);
        for (const path of copies.values()) {
          const html = decode(files.get(path)!), references = await designResourceReferences(html, path);
          files.set(path, Buffer.from(rewriteReferences(html, references, reference => {
            if (reference.kind !== "navigation") return null;
            const value = retargetHref(path, reference.url, copies, objectIds); return value === reference.url ? null : escapeCanvasText(value);
          })));
        }
        break;
      }
      case "page.delete": {
        page(operation.pageId); if (manifest.pages!.length === 1) invalid("Keep at least one page");
        const remaining = manifest.boards.filter(value => value.pageId !== operation.pageId); if (!remaining.length) invalid("Keep at least one board in the document. Create a board on another page before deleting this page.");
        manifest.pages = manifest.pages!.filter(value => value.id !== operation.pageId); manifest.boards = remaining;
        manifest.objects = manifest.objects!.filter(value => value.pageId !== operation.pageId); break;
      }
      case "board.create": {
        page(operation.pageId); const boardId = id(index, "board"), file = `boards/${boardId}.html`;
        if (files.has(file)) invalid("Host board path already exists");
        manifest.boards.push({ id: boardId, title: operation.title, file, pageId: operation.pageId, position: operation.position, mode: operation.mode, viewport: operation.viewport });
        files.set(file, Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;min-height:${operation.viewport.height}px;background:#fff"></body></html>`)); break;
      }
      case "board.update": {
        const target = board(operation.boardId);
        if (operation.pageId) { page(operation.pageId); target.pageId = operation.pageId; for (const child of manifest.objects!.filter(value => value.boardId === target.id)) child.pageId = operation.pageId; }
        if (operation.title) target.title = operation.title; if (operation.viewport) target.viewport = operation.viewport; if (operation.position) target.position = operation.position; break;
      }
      case "board.duplicate": {
        const target = board(operation.boardId), objectIds = new Map<string, string>(), cloned = cloneBoard(target, operation.pageId ?? target.pageId!, index, "board", objectIds);
        const copies = new Map([[target.file, cloned.file]]);
        for (const value of manifest.objects!.filter(value => value.boardId === cloned.id)) if (value.kind === "text" && value.href) value.href = retargetHref(cloned.file, value.href, copies, objectIds);
        const html = decode(files.get(cloned.file)!); files.set(cloned.file, Buffer.from(rewriteReferences(html, await designResourceReferences(html, cloned.file), reference => {
          if (reference.kind !== "navigation") return null; const value = retargetHref(cloned.file, reference.url, copies, objectIds); return value === reference.url ? null : escapeCanvasText(value);
        })));
        cloned.position = operation.position ?? { x: (target.position?.x ?? 0) + 40, y: (target.position?.y ?? 0) + 40 }; break;
      }
      case "board.delete": {
        board(operation.boardId); if (manifest.boards.length === 1) invalid("Keep at least one board in the document");
        manifest.boards = manifest.boards.filter(value => value.id !== operation.boardId); manifest.objects = manifest.objects!.filter(value => value.boardId !== operation.boardId); break;
      }
      case "object.create": {
        page(operation.pageId); const objectId = id(index, "object"); let data: unknown = operation.object;
        if (operation.object.kind === "image" && "source" in operation.object) {
          const imageSource = operation.object.source, bytes = imageSource.kind === "document" ? files.get(imageSource.path) ?? invalid("Image resource is not in this document") : Buffer.from(await ports.readImage(imageSource));
          const mime = sniffImageMime(bytes) ?? invalid("Choose a PNG, JPEG, GIF or WebP resource");
          if (bytes.length > CANVAS_LIMITS.imageBytes || designDigest(bytes) !== imageSource.digest) invalid("Image bytes or fixed digest does not match");
          const path = imageSource.kind === "document" ? imageSource.path : `assets/image-${imageSource.digest.slice(7)}.${artifactExtension({ kind: "image", mime })}`;
          const existing = files.get(path); if (existing && designDigest(existing) !== imageSource.digest) invalid("Host image resource path contains different source bytes");
          if (!existing) files.set(path, Buffer.from(bytes));
          const { source: _source, ...value } = operation.object; data = { ...value, asset: { path, digest: designDigest(bytes) } };
        }
        const value = canvasObjectInputSchema.parse(data);
        manifest.objects!.push(putObject({ ...value, id: objectId, pageId: operation.pageId, ...(operation.boardId ? { boardId: operation.boardId } : {}) })); break;
      }
      case "object.update": {
        const target = object(operation.objectId), changes = operation.changes;
        const updated = putObject({ ...target, ...changes, ...(changes.style ? { style: { ...target.style, ...changes.style } } : {}) } as CanvasObject);
        manifest.objects = manifest.objects!.map(value => value.id === target.id ? updated : value); break;
      }
      case "object.duplicate": {
        const target = object(operation.objectId), pageId = operation.pageId ?? target.pageId;
        const boardId = operation.boardId ?? (pageId === target.pageId ? target.boardId : undefined), offset = operation.offset ?? { x: 20, y: 20 };
        const { boardId: _boardId, ...value } = structuredClone(target);
        manifest.objects!.push(putObject({ ...value, id: id(index, "object"), pageId, ...(boardId ? { boardId } : {}), bounds: { ...value.bounds, x: value.bounds.x + offset.x, y: value.bounds.y + offset.y } })); break;
      }
      case "object.delete": object(operation.objectId); manifest.objects = manifest.objects!.filter(value => value.id !== operation.objectId); break;
      case "source.update": {
        const target = board(operation.anchor.boardId), html = decode(files.get(target.file)!);
        if (operation.changes?.["font-family"]) requireCanvasFont(manifest, fileSet(), operation.changes["font-family"]);
        if (operation.href) requireCanvasNavigation(manifest, fileSet(), operation.href, target.id, target.pageId);
        files.set(target.file, Buffer.from(patchCanvasSource(html, { ...operation, anchor: { ...operation.anchor, boardDigest: designDigest(html) } }))); break;
      }
    }
    if (manifest.pages!.length > CANVAS_LIMITS.pages || manifest.boards.length > 16 || manifest.objects!.length > CANVAS_LIMITS.objects)
      throw new DesignDocumentError("BUDGET_EXCEEDED", "Canvas exceeds 16 pages, 16 boards or 256 objects");
  }
  if (!manifest.boards.some(value => value.id === manifest.launchBoard)) manifest.launchBoard = manifest.boards[0]!.id;
  const result = manifestSchema.parse(manifest);
  for (const value of result.boards) {
    const html = decode(files.get(value.file)!); if ((result.objects ?? []).some(object => object.boardId === value.id) || html.includes("data-bottega-canvas-layer"))
      files.set(value.file, Buffer.from(replaceCanvasLayer(html, canvasLayerMarkup(result, value))));
  }
  files.set("canvas.json", Buffer.from(JSON.stringify(result) + "\n"));
  return fileSet();
}
