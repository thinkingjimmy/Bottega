/**
 * [INPUT]: Closed manifest objects, captured bytes and syntax-mapped complete board HTML.
 * [OUTPUT]: Canonical board object layers, legal font checks and complete fixed image closure validation.
 * [POS]: Canvas source projection; object data is authoritative and generated HTML is checked against it.
 */
import { parse, type DefaultTreeAdapterTypes as Tree } from "parse5";
import { posix } from "node:path";
import { canvasObjectMarkup } from "@ai-chat/cloud-protocol/artifacts/design/canvas/markup";
import { CANVAS_LIMITS, fontFamilySchema } from "@ai-chat/cloud-protocol/artifacts/design/canvas/model";
import { canvasFonts, readCanvas } from "@ai-chat/cloud-protocol/artifacts/design/canvas/view";
import { sniffImageMime } from "@ai-chat/cloud-protocol/artifacts/media-types";
import sharp from "sharp";
import { designResourceTarget } from "../documents/resources/references";
import { DesignDocumentError, designDigest, type DesignManifest, type DesignIssue } from "../documents/model";
type File = { path: string; data: Uint8Array };
export function requireCanvasNavigation(manifest: DesignManifest, files: readonly File[], href: string, boardId?: string, pageId?: string) {
  const board = boardId ? manifest.boards.find(board => board.id === boardId) : undefined;
  if (!href.startsWith("#")) {
    const path = designResourceTarget(board?.file ?? "canvas.json", href);
    const destination = manifest.boards.find(board => board.file === path);
    if (!destination) throw new DesignDocumentError("INVALID_DOCUMENT", "Link to a listed board in this fixed document");
    const hash = href.indexOf("#"); if (hash >= 0) requireCanvasNavigation(manifest, files, href.slice(hash), destination.id, destination.pageId);
    return;
  }
  const id = href.slice(1);
  if (!board) {
    if (!manifest.objects?.some(object => object.pageId === pageId && !object.boardId && object.id === id)) throw new DesignDocumentError("INVALID_DOCUMENT", "Choose an existing Canvas object on this page for the fragment link");
    return;
  }
  const file = files.find(file => file.path === board.file); if (!file) throw new DesignDocumentError("INVALID_DOCUMENT", "Link board source is missing");
  const queue: Tree.Node[] = [parse(new TextDecoder("utf-8", { fatal: true }).decode(file.data))]; let count = 0;
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index]!; if ("tagName" in node && node.attrs.some(value => value.name === "id" && value.value === id)) count++;
    if ("childNodes" in node) queue.push(...node.childNodes);
  }
  if (count !== 1) throw new DesignDocumentError("INVALID_DOCUMENT", "Fragment destination must name one static element in this board");
}
export function requireCanvasFont(manifest: DesignManifest, files: readonly File[], family: string) {
  const allowed = canvasFonts(manifest, files).map(value => value.toLowerCase());
  if (!fontFamilySchema.safeParse(family).success || family.split(",").some(value => !allowed.includes(value.trim().replace(/^['"]|['"]$/g, "").toLowerCase())))
    throw new DesignDocumentError("INVALID_DOCUMENT", "Choose an existing system font or a font in the fixed bound design system");
}
export function canvasLayerMarkup(manifest: DesignManifest, board: DesignManifest["boards"][number]) {
  const objects = (manifest.objects ?? []).filter(object => object.boardId === board.id);
  if (!objects.length) return "";
  const markup = objects.map(object => canvasObjectMarkup(object, path => posix.relative(posix.dirname(board.file), path))).join("");
  return `<div data-bottega-canvas-layer="1" style="position:absolute;left:0;top:0;width:${board.viewport.width}px;height:${board.viewport.height}px;pointer-events:none">${markup}</div>`;
}
export function replaceCanvasLayer(html: string, markup: string) {
  const root = parse(html, { sourceCodeLocationInfo: true }); let close: number | undefined;
  const layers: { start: number; end: number }[] = [];
  const visit = (node: Tree.Node) => {
    if ("tagName" in node) {
      if (node.tagName === "body") close = node.sourceCodeLocation?.endTag?.startOffset;
      if (node.attrs.some(value => value.name === "data-bottega-canvas-layer")) {
        const location = node.sourceCodeLocation;
        if (!location?.endTag || layers.length) throw new DesignDocumentError("INVALID_DOCUMENT", "Canvas layer must have one source-mapped container");
        layers.push({ start: location.startOffset, end: location.endOffset }); return;
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  }; visit(root);
  if (close === undefined) throw new DesignDocumentError("INVALID_DOCUMENT", "Canvas objects need a source-mapped complete body");
  const edits = [...layers.map(value => ({ ...value, value: "" })), { start: close, end: close, value: markup }].sort((a, b) => b.start - a.start);
  let result = html;
  for (const edit of edits) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  return result;
}
export async function validateCanvasResources(manifest: DesignManifest, files: readonly File[]): Promise<DesignIssue[]> {
  const issues: DesignIssue[] = [];
  try { readCanvas(manifest, files); }
  catch { throw new DesignDocumentError("BUDGET_EXCEEDED", "Canvas image projection exceeds the complete generated resource budget"); }
  const checked = new Set<string>();
  for (const object of manifest.objects ?? []) {
    try {
      if (object.style?.["font-family"]) requireCanvasFont(manifest, files, object.style["font-family"]);
      if (object.kind === "image") {
        const file = files.find(file => file.path === object.asset.path);
        if (!file || file.data.length > CANVAS_LIMITS.imageBytes || !sniffImageMime(file.data) || designDigest(file.data) !== object.asset.digest)
          throw new Error("Canvas image must name bounded raster bytes with their exact fixed digest");
        if (!checked.has(file.path)) {
          const metadata = await sharp(file.data, { limitInputPixels: 16_000_000, failOn: "error" }).metadata();
          const frames = metadata.pages ?? 1, height = metadata.pageHeight ?? metadata.height;
          if (!metadata.width || !height || metadata.width > 8000 || height > 8000 || frames > 128 || metadata.width * height * frames > 16_000_000) throw new Error("Image exceeds 8000 pixels per axis, 128 frames or 16 million total decoded pixels");
          await sharp(file.data, { limitInputPixels: 16_000_000, failOn: "error" }).resize(1, 1).png().toBuffer(); checked.add(file.path);
        }
      }
      if (object.kind === "text" && object.href) {
        requireCanvasNavigation(manifest, files, object.href, object.boardId, object.pageId);
      }
    } catch (cause) { issues.push({ file: "canvas.json", message: cause instanceof Error ? cause.message.slice(0, 500) : "Invalid Canvas resource" }); }
  }
  for (const board of manifest.boards) {
    const file = files.find(file => file.path === board.file); if (!file) continue;
    try {
      const html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(file.data), expected = canvasLayerMarkup(manifest, board);
      if (expected || html.includes("data-bottega-canvas-layer")) {
        if (replaceCanvasLayer(html, expected) !== html) throw new Error("Board Canvas layer differs from its authoritative object model");
      }
    } catch (cause) { issues.push({ file: board.file, message: cause instanceof Error ? cause.message.slice(0, 500) : "Invalid Canvas layer" }); }
  }
  return issues.slice(0, 32);
}
