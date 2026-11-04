/**
 * [INPUT]: Complete immutable source members, document identity and native Canvas v3 or Slides v4 index bytes.
 * [OUTPUT]: Explicit native-format host metadata and fixed system bindings without changing or converting source files.
 * [POS]: Shared native source dispatch for capture, encrypted archives and local/remote readers.
 */
import { z } from "zod";
import { nativeSourceId as nativeId } from "./identity";
import { projectSlidesManifest } from "./slides";
import { designId } from "../reference/identifiers";
import { sourcePath } from "../reference/path";
import { systemBindingSchema, type DesignManifest } from "../model";
const page = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), name: z.string().max(250) }).passthrough();
const board = z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().int().min(40).max(8000), h: z.number().int().min(40).max(8000),
  title: z.string().max(250).optional(), page: z.string().optional(), expand: z.literal("fill").optional(), print: z.literal("flow").optional(),
  paper: z.enum(["letter", "a4"]).optional(), is_interactive: z.boolean().optional(), frameless: z.boolean().optional(), radius: z.number().min(0).optional(),
  guides: z.array(z.object({ kind: z.enum(["columns", "rows", "grid"]) }).passthrough()).max(100).optional() }).passthrough();
const indexSchema = z.object({ bottegaSystems: z.array(systemBindingSchema).max(8).optional(), v: z.literal(3), title: z.string().max(250).optional(),
  boards: z.record(sourcePath.refine(path => path.endsWith(".dc.html") && !/^(?:assets|ds)\//.test(path)), board),
  order: z.array(sourcePath).min(1).max(16), pages: z.array(page).max(16).optional(),
  launch: z.discriminatedUnion("view", [z.object({ view: z.literal("canvas"), page: z.string().optional() }).passthrough(),
    z.object({ view: z.literal("focused"), file: sourcePath }).passthrough()]).optional(),
  notes: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), z.object({ x: z.number().finite(), y: z.number().finite(), text: z.string().max(100_000), page: z.string().optional() }).passthrough()).optional(),
}).passthrough();
export function projectNativeManifest(files: readonly { path: string; data: Uint8Array }[], documentId: string): DesignManifest {
  designId.parse(documentId);
  const canvas = files.find(file => file.path === "canvas.json"), deck = files.find(file => file.path === "deck.json");
  if (canvas && deck) throw new Error("Ambiguous native document: canvas.json and deck.json are both present");
  if (!canvas) { if (deck) return projectSlidesManifest(files, documentId); throw new Error("A current Canvas or Slides index is required"); }
  if (canvas.data.length > 65_536) throw new Error("Native index exceeds its 64 KiB budget");
  const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(canvas.data));
  const index = indexSchema.parse(raw), paths = Object.keys(index.boards);
  if (!paths.length || paths.length > 16 || index.order.length !== paths.length || new Set(index.order).size !== paths.length || index.order.some(path => !index.boards[path]))
    throw new Error("Native board order must contain every board exactly once (at most 16)");
  const pages = index.pages?.length ? index.pages : [{ id: "page-1", name: "Page 1" }];
  const pageIds = new Set(pages.map(page => page.id));
  if (pageIds.size !== pages.length) throw new Error("Native page IDs must be unique");
  for (const entry of [...Object.values(index.boards), ...Object.values(index.notes ?? {})])
    if (entry.page !== undefined && !pageIds.has(entry.page)) throw new Error("Native page membership is invalid");
  const sources = new Set(files.map(file => file.path));
  if (paths.some(path => !sources.has(path))) throw new Error("Native board source is missing");
  if (files.some(file => file.path.endsWith(".dc.html") && !/^(?:assets|ds)\//.test(file.path) && !index.boards[file.path]))
    throw new Error("Native artboard is absent from its index");
  const launch = index.launch;
  if (launch?.view === "focused" && !index.boards[launch.file] || launch?.view === "canvas" && launch.page && !pageIds.has(launch.page))
    throw new Error("Native launch target is missing");
  const launchPath = launch?.view === "focused" ? launch.file : index.order[0]!;
  return { schemaVersion: 1, format: "bottega-design", contentFormat: "canvas-dc/v3", documentId, title: index.title?.trim() || documentId,
    pages: pages.map(page => ({ id: nativeId("p-", page.id), title: page.name.trim() || "Page" })),
    boards: index.order.map(path => { const board = index.boards[path]!; return { id: nativeId("b-", path), file: path,
      title: board.title?.trim() || path.replace(/\.dc\.html$/, "").split("/").at(-1)!, mode: board.expand === "fill" ? "responsive" : "fixed",
      viewport: { width: board.w, height: board.h }, pageId: nativeId("p-", board.page ?? pages[0]!.id), position: { x: board.x, y: board.y } }; }),
    launchBoard: nativeId("b-", launchPath), ...(index.bottegaSystems ? { systems: index.bottegaSystems } : {}) };
}
