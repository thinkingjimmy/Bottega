/**
 * [INPUT]: Fixed manifest and captured resource bytes; no live source or platform authority.
 * [OUTPUT]: Implicit pages, resolved membership and offline image/font choices for shared editors.
 * [POS]: Read-only Canvas projection; opening an older manifest never rewrites it.
 */
import type { DesignManifest } from "../model";
import { CANVAS_LIMITS, CANVAS_SYSTEM_FONTS, fontFamilySchema, implicitCanvasPageId, type CanvasObject, type CanvasPage } from "./model";
import { sniffImageMime } from "../../media-types";
import { hashBytes } from "../../../blobs/transfer";
type File = { path: string; data: Uint8Array };
export const canvasPages = (manifest: DesignManifest): CanvasPage[] => manifest.pages ?? [{ id: implicitCanvasPageId(manifest), title: "Page 1" }];
export const canvasBoardPage = (manifest: DesignManifest, board: DesignManifest["boards"][number]) => board.pageId ?? canvasPages(manifest)[0]!.id;
export function canvasImageUrl(bytes: Uint8Array) {
  const mime = sniffImageMime(bytes); if (!mime || bytes.length > CANVAS_LIMITS.imageBytes) return null;
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 8192) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 8192)));
  return `data:${mime};base64,${btoa(chunks.join(""))}`;
}
export function canvasFonts(manifest: DesignManifest, files: readonly File[]) {
  const fonts: string[] = [...CANVAS_SYSTEM_FONTS];
  const known = new Set(files.map(file => file.path));
  for (const binding of manifest.systems ?? []) for (const path of binding.files.filter(path => path === `systems/${binding.documentId}/tokens.json`)) {
    const file = files.find(file => file.path === path); if (!file) continue;
    try {
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.data));
      for (const font of Array.isArray(value.fonts) ? value.fonts : []) {
        if (fontFamilySchema.safeParse(font.family).success && known.has(path.slice(0, path.lastIndexOf("/") + 1) + font.file)) fonts.push(font.family);
      }
    } catch { /* Invalid source metadata never adds a font choice. */ }
  }
  return [...new Set(fonts)].slice(0, 265);
}
export function readCanvas(manifest: DesignManifest, files: readonly File[]) {
  const width = Math.max(...manifest.boards.map(board => board.viewport.width)) + 80, height = Math.max(...manifest.boards.map(board => board.viewport.height)) + 80;
  const images = files.flatMap(file => {
    const mime = sniffImageMime(file.data); if (!mime || file.data.length > CANVAS_LIMITS.imageBytes) return [];
    return [{ path: file.path, digest: "sha256:" + hashBytes(file.data), mime, bytes: file.data.length }];
  });
  const objectImages: Record<string, string> = {};
  const urls = new Map<string, string>(); let projectedBytes = 0;
  for (const object of manifest.objects ?? []) if (object.kind === "image") {
    const image = images.find(image => image.path === object.asset.path && image.digest === object.asset.digest);
    const file = image && files.find(file => file.path === image.path);
    const url = file && (urls.get(file.path) ?? canvasImageUrl(file.data));
    if (url) {
      urls.set(file!.path, url); projectedBytes += url.length + object.id.length + 6;
      if (projectedBytes > CANVAS_LIMITS.resourceBytes - 262144) throw new Error("Canvas image projection exceeds the 50,000,000-byte generated resource budget");
      objectImages[object.id] = url;
    }
  }
  return { pages: canvasPages(manifest), objects: manifest.objects ?? [] as CanvasObject[],
    boards: manifest.boards.map(board => {
      const pageId = canvasBoardPage(manifest, board), index = manifest.boards.filter(value => canvasBoardPage(manifest, value) === pageId).findIndex(value => value.id === board.id);
      return { ...board, pageId, position: board.position ?? { x: index % 4 * width, y: Math.floor(index / 4) * height } };
    }),
    fonts: canvasFonts(manifest, files), images, objectImages };
}
export type CanvasRead = ReturnType<typeof readCanvas>;
export function validateCanvasCheckpoint(manifest: DesignManifest, checkpoint: { canvas?: { pageId: string; selection: string[] } }) {
  if (!checkpoint.canvas) return;
  const { pageId, selection } = checkpoint.canvas;
  if (!canvasPages(manifest).some(page => page.id === pageId) || selection.some(id =>
    !manifest.boards.some(board => board.id === id && canvasBoardPage(manifest, board) === pageId) &&
    !manifest.objects?.some(object => object.id === id && object.pageId === pageId))) throw new Error("Canvas checkpoint page or selection belongs to another snapshot");
}
