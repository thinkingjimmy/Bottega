/**
 * [INPUT]: One authorized immutable revision, normalized fixed specification, complete resources and offline frame policy.
 * [OUTPUT]: Format-dispatched revision-bound board/page PNG, opaque srcdoc offline HTML without data-URL size limits and scoped fixed/flow PDFs.
 * [POS]: Export adapter; working-source bytes and active preview state never enter the result.
 */
import { DESIGN_FRAME_CSP } from "@ai-chat/cloud-protocol/artifacts/design/frame";
import { PDFDocument } from "pdf-lib";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { DesignRevision } from "../documents/store";
import { prepareDesignSnapshot } from "../documents/rendering";
import { DESIGN_LIMITS, DesignDocumentError, designDigest } from "../documents/model";
import { captureDesignCanvas } from "../tooling/render-check";
import { guardDesignExportHtml, printDesignBoard } from "./print";
import { prepareCanvasPage } from "../canvas/export";
import { canvasPages, canvasBoardPage } from "@ai-chat/cloud-protocol/artifacts/design/canvas/view";
import { designResourceTarget } from "../documents/resources/references";
import { createDesignExportSpec, type DesignExportSpec } from "./export-spec";
type Snapshot = { version: DesignRevision; files: { path: string; data: Uint8Array }[] };
const OFFLINE_HTML_CSP = DESIGN_FRAME_CSP.replace("frame-src 'none'", "frame-src 'self'");
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export async function exportDesignRevision(input: WorkspaceCommand, snapshot: Snapshot, fixed?: DesignExportSpec) {
  const plan = fixed ?? await createDesignExportSpec(input, snapshot);
  const { version } = snapshot, range = plan.spec.range, { format, paper } = range;
  if (plan.spec.source.snapshotRef !== version.snapshotRef || plan.spec.source.readSetDigest !== version.readSetDigest)
    throw new DesignDocumentError("INVALID_DOCUMENT", "Export specification belongs to another source");
  const signal = AbortSignal.timeout(60_000), scope = range.scope;
  let native = Boolean(version.manifest.contentFormat);
  const selectedBoards = range.scope === "board" ? version.manifest.boards.filter(board => board.id === range.boardId) : version.manifest.boards;
  let bytes: Buffer, mime: string, pages: number | undefined, dimensions: { width: number; height: number } | undefined;
  if (range.scope === "page") {
    const page = await prepareCanvasPage(snapshot, range.pageId, signal);
    if (format === "html") { bytes = Buffer.from(guardDesignExportHtml(page.html.toString("utf8"), native)); mime = "text/html"; }
    else if (format === "png") {
      const image = await captureDesignCanvas({ html: page.html, viewport: "desktop", size: page.size, maxImageBytes: DESIGN_LIMITS.archive, signal, format: "png", hideScrollbars: plan.spec.producer.hideScrollbars, native });
      bytes = Buffer.from(image.data, "base64"); mime = "image/png"; dimensions = { width: image.width, height: image.height };
    } else { bytes = await printDesignBoard(page.html.toString("utf8"), page.size, format === "pdf-flow", paper, signal, native); mime = "application/pdf"; pages = (await PDFDocument.load(bytes)).getPageCount(); }
  } else if (format === "png") {
    const board = await prepareDesignSnapshot(snapshot, range.scope === "board" ? range.boardId : undefined);
    const image = await captureDesignCanvas({ html: board.html, viewport: "desktop", size: board.size, maxImageBytes: DESIGN_LIMITS.archive, signal, format: "png", hideScrollbars: plan.spec.producer.hideScrollbars, native: Boolean(board.metadata.contentFormat) });
    bytes = Buffer.from(image.data, "base64"); mime = "image/png"; dimensions = { width: image.width, height: image.height };
  } else if (format === "html") {
    const nonce = plan.digest.slice(7), boards: { id: string; title: string; src: string }[] = []; let total = 0;
    for (const board of selectedBoards) {
      const prepared = await prepareDesignSnapshot(snapshot, board.id);
      native ||= Boolean(prepared.metadata.contentFormat);
      const navigation = JSON.stringify(prepared.metadata.navigation).replace(/</g, "\\u003c");
      const bridge = `<script>(()=>{const navigation=${navigation};addEventListener('click',event=>{const link=event.target instanceof Element?event.target.closest('a,area'):null;if(!link)return;const href=link.getAttribute('href')||'';if(href.startsWith('#'))return;event.preventDefault();if(Object.hasOwn(navigation,href))parent.postMessage({type:'bottega:offline:navigate',nonce:'${nonce}',boardId:navigation[href]},'*');},true);})();</script>`;
      const html = guardDesignExportHtml(bridge + prepared.html.toString("utf8"), Boolean(prepared.metadata.contentFormat));
      const src = "data:text/html;base64," + Buffer.from(html).toString("base64"); total += Buffer.byteLength(src);
      if (total > DESIGN_LIMITS.archive - 8192) throw new DesignDocumentError("BUDGET_EXCEEDED", "Complete HTML exceeds the export budget");
      boards.push({ id: board.id, title: board.title, src });
    }
    if (scope === "document") for (const page of canvasPages(version.manifest)) {
      if (!version.manifest.objects?.some(object => object.pageId === page.id && !object.boardId) && version.manifest.boards.some(board => canvasBoardPage(version.manifest, board) === page.id)) continue;
      const prepared = await prepareCanvasPage(snapshot, page.id, signal, false);
      const navigation: Record<string, string> = {};
      for (const object of version.manifest.objects ?? []) if (object.pageId === page.id && !object.boardId && object.kind === "text" && object.href) {
        const target = designResourceTarget("canvas.json", object.href), board = version.manifest.boards.find(board => board.file === target); if (board) navigation[object.href] = board.id;
      }
      const targets = JSON.stringify(navigation).replace(/</g, "\\u003c");
      const bridge = `<script>(()=>{const navigation=${targets};addEventListener('click',event=>{const link=event.target instanceof Element?event.target.closest('a'):null;if(!link)return;const href=link.getAttribute('href')||'';if(href.startsWith('#'))return;event.preventDefault();if(Object.hasOwn(navigation,href))parent.postMessage({type:'bottega:offline:navigate',nonce:'${nonce}',boardId:navigation[href]},'*');},true);})();</script>`;
      const src = "data:text/html;base64," + Buffer.from(guardDesignExportHtml(bridge + prepared.html.toString("utf8"))).toString("base64"); total += Buffer.byteLength(src);
      if (total > DESIGN_LIMITS.archive - 8192) throw new DesignDocumentError("BUDGET_EXCEEDED", "Complete HTML exceeds the export budget");
      boards.push({ id: "canvas-page:" + page.id, title: page.title + " · Canvas objects", src });
    }
    const data = JSON.stringify(boards).replace(/</g, "\\u003c"), initial = boards.findIndex(board => board.id === (range.scope === "board" ? range.boardId : version.manifest.launchBoard));
    bytes = Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${native ? OFFLINE_HTML_CSP.replace("script-src ", "script-src 'unsafe-eval' ") : OFFLINE_HTML_CSP}"><title>${escape(version.manifest.title)} - v${version.revision}</title><style>body{margin:0;font:16px system-ui;height:100vh;display:flex;flex-direction:column}header{padding:12px;display:flex;gap:16px;align-items:center}select{min-height:44px;font:inherit}iframe{border:0;width:100%;flex:1}</style></head><body><header><strong>${escape(version.manifest.title)} - v${version.revision}</strong><select id="boards" aria-label="Board">${boards.map(board => `<option value="${board.id}">${escape(board.title)}</option>`).join("")}</select></header><iframe id="board" sandbox="allow-scripts" title="${escape(version.manifest.title)}"></iframe><script>const boards=${data},picker=document.getElementById('boards'),frame=document.getElementById('board');function show(id){const board=boards.find(board=>board.id===id);if(board){picker.value=id;frame.srcdoc=new TextDecoder().decode(Uint8Array.from(atob(board.src.slice(board.src.indexOf(',')+1)),value=>value.charCodeAt(0)));}}picker.onchange=()=>show(picker.value);addEventListener('message',event=>{if(event.source===frame.contentWindow&&event.origin==='null'&&event.data?.type==='bottega:offline:navigate'&&event.data.nonce==='${nonce}')show(event.data.boardId);});show(boards[${Math.max(0, initial)}].id);</script></body></html>`);
    mime = "text/html";
  } else {
    const document = await PDFDocument.create(); pages = 0;
    document.setTitle(version.manifest.title + " - v" + version.revision);
    for (const board of selectedBoards) {
      const prepared = await prepareDesignSnapshot(snapshot, board.id);
      native ||= Boolean(prepared.metadata.contentFormat);
      const printed = await printDesignBoard(prepared.html.toString("utf8"), prepared.size, format === "pdf-flow", paper, signal, Boolean(prepared.metadata.contentFormat));
      const source = await PDFDocument.load(printed), indices = source.getPageIndices();
      for (const page of await document.copyPages(source, indices)) document.addPage(page);
      pages += indices.length;
      if (pages > 512) throw new DesignDocumentError("BUDGET_EXCEEDED", "PDF exceeds the page budget");
    }
    if (scope === "document") for (const page of canvasPages(version.manifest)) {
      if (!version.manifest.objects?.some(object => object.pageId === page.id && !object.boardId) && version.manifest.boards.some(board => canvasBoardPage(version.manifest, board) === page.id)) continue;
      const prepared = await prepareCanvasPage(snapshot, page.id, signal, false);
      const printed = await printDesignBoard(prepared.html.toString("utf8"), prepared.size, format === "pdf-flow", paper, signal, native);
      const source = await PDFDocument.load(printed), indices = source.getPageIndices();
      for (const value of await document.copyPages(source, indices)) document.addPage(value);
      pages += indices.length; if (pages > 512) throw new DesignDocumentError("BUDGET_EXCEEDED", "PDF exceeds the page budget");
    }
    bytes = Buffer.from(await document.save()); mime = "application/pdf";
  }
  if (bytes.length > DESIGN_LIMITS.archive) throw new DesignDocumentError("BUDGET_EXCEEDED", "Complete export exceeds the transfer budget");
  const name = version.manifest.title.replace(/[<>:"/\\|?*\p{Cc}]/gu, "_").slice(0, 100) || "Artifact";
  return { data: bytes.toString("base64"), mime, filename: `${name}-v${version.revision}.${format === "html" ? "html" : format === "png" ? "png" : "pdf"}`,
    exportSpec: plan.spec, exportSpecDigest: plan.digest, revision: version.revision, snapshotRef: version.snapshotRef, readSetDigest: version.readSetDigest, digest: designDigest(bytes), pages, dimensions,
    scope, ...(range.scope === "page" ? { pageId: range.pageId, presentation: "static" as const } : {}) };
}
