/**
 * [INPUT]: Exact immutable manifest/resources, explicit page identity and existing isolated board capture.
 * [OUTPUT]: Bounded static page/object compositions and document-local font/image closure for exports.
 * [POS]: Frozen Canvas export adapter; neither live source nor the editor camera enters exported bytes.
 */
import { canvasObjectMarkup, escapeCanvasText } from "@ai-chat/cloud-protocol/artifacts/design/canvas/markup";
import { readCanvas, canvasImageUrl } from "@ai-chat/cloud-protocol/artifacts/design/canvas/view";
import { prepareDesignSnapshot } from "../documents/rendering";
import { captureDesignCanvas } from "../tooling/render-check";
import { DesignDocumentError, DESIGN_LIMITS } from "../documents/model";
import type { DesignRevision } from "../documents/store";
type Snapshot = { version: DesignRevision; files: { path: string; data: Uint8Array }[] };
export async function prepareCanvasPage(snapshot: Snapshot, pageId: string, signal: AbortSignal, includeBoards = true) {
  const canvas = readCanvas(snapshot.version.manifest, snapshot.files), page = canvas.pages.find(page => page.id === pageId);
  if (!page) throw new DesignDocumentError("INVALID_DOCUMENT", "Choose a page in this fixed revision");
  const boards = includeBoards ? canvas.boards.filter(board => board.pageId === pageId) : [], objects = canvas.objects.filter(object => object.pageId === pageId && !object.boardId);
  const bounds = [...boards.map(board => ({ ...board.position, ...board.viewport })), ...objects.map(object => object.bounds)];
  const left = Math.min(0, ...bounds.map(value => value.x)), top = Math.min(0, ...bounds.map(value => value.y));
  const width = Math.max(40, ...bounds.map(value => value.x + value.width)) - left, height = Math.max(40, ...bounds.map(value => value.y + value.height)) - top;
  const scale = Math.min(1, 8000 / width, 8000 / height), size = { width: Math.max(40, Math.ceil(width * scale)), height: Math.max(40, Math.ceil(height * scale)) };
  const markup: string[] = []; let bytes = 0;
  for (const board of boards) {
    signal.throwIfAborted(); const prepared = await prepareDesignSnapshot(snapshot, board.id);
    const image = await captureDesignCanvas({ html: prepared.html, viewport: "desktop", size: board.viewport, format: "png", maxImageBytes: DESIGN_LIMITS.archive, signal });
    const item = `<img alt="${escapeCanvasText(board.title)}" src="data:image/png;base64,${image.data}" style="position:absolute;left:${board.position.x}px;top:${board.position.y}px;width:${board.viewport.width}px;height:${board.viewport.height}px">`;
    bytes += Buffer.byteLength(item); if (bytes > DESIGN_LIMITS.archive) throw new DesignDocumentError("BUDGET_EXCEEDED", "Complete page exceeds the export budget"); markup.push(item);
  }
  for (const object of objects) {
    const item = canvasObjectMarkup(object, path => {
      const image = objects.find(object => object.kind === "image" && object.asset.path === path);
      const file = image && snapshot.files.find(file => file.path === path);
      return file ? canvasImageUrl(file.data) : null;
    }); bytes += Buffer.byteLength(item); if (bytes > DESIGN_LIMITS.archive) throw new DesignDocumentError("BUDGET_EXCEEDED", "Canvas object resources exceed the export budget"); markup.push(item);
  }
  const fonts: string[] = [];
  for (const binding of snapshot.version.manifest.systems ?? []) {
    for (const path of binding.files.filter(path => path === `systems/${binding.documentId}/tokens.json`)) {
      const file = snapshot.files.find(file => file.path === path); if (!file) continue;
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.data));
      for (const font of value.fonts ?? []) {
        if (!canvas.fonts.includes(font.family) || !/^(?:normal|bold|[1-9]\d{0,2}|1000)$/.test(String(font.weight)) || !["normal", "italic", "oblique"].includes(font.style)) continue;
        const fontFile = snapshot.files.find(file => file.path === path.slice(0, path.lastIndexOf("/") + 1) + font.file); if (!fontFile) continue;
        const mime = font.file.endsWith(".woff2") ? "font/woff2" : font.file.endsWith(".ttf") ? "font/ttf" : font.file.endsWith(".otf") ? "font/otf" : "font/woff";
        fonts.push(`@font-face{font-family:${JSON.stringify(font.family)};src:url(data:${mime};base64,${Buffer.from(fontFile.data).toString("base64")});font-weight:${font.weight};font-style:${font.style}}`);
      }
    }
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeCanvasText(page.title)}</title><style>${fonts.join("\n")}body{margin:0;background:white;font-family:system-ui}</style></head><body><main style="position:relative;width:${size.width}px;height:${size.height}px;overflow:hidden"><div style="position:absolute;left:0;top:0;transform-origin:0 0;transform:scale(${scale}) translate(${-left}px,${-top}px);width:${width}px;height:${height}px">${markup.join("")}</div></main></body></html>`;
  if (Buffer.byteLength(html) > DESIGN_LIMITS.archive) throw new DesignDocumentError("BUDGET_EXCEEDED", "Page fonts and objects exceed the export budget");
  return { html: Buffer.from(html), size, pageId, scale, static: true as const };
}
