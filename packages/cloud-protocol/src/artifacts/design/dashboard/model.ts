/**
 * [INPUT]: Complete immutable Dashboard members, explicit v1 index and native document batches.
 * [OUTPUT]: Strict inert document/data projection and a validated complete atomic replacement set.
 * [POS]: Dashboard source authority boundary; no host filesystem, network, script or database execution.
 */
import { z } from "zod";
import { nativeSourceId } from "../native/identity";
import { parseDashboardRows, DASHBOARD_DATA_LIMITS, type DashboardDataFormat, type DashboardTable } from "./datasets";
export const DASHBOARD_LIMITS = Object.freeze({ files: 512, source: 32 * 1024 * 1024, document: 256 * 1024, batch: 1024 * 1024, writes: 50, datasets: 128 });
type Member = { path: string; data: Uint8Array };
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const blobId = z.string().regex(/^[a-f0-9]{32}$/);
export const dashboardDatasetSchema = z.object({ title: z.string().min(1).max(200), description: z.string().max(4000).optional(),
  source: z.object({ kind: z.literal("file"), url: z.string().regex(/^\/_blob\/[a-f0-9]{32}$/), name: z.string().min(1).max(240), format: z.enum(["csv", "tsv", "json"]).optional() }).strict(),
  updated: z.object({ at: z.string().datetime({ offset: true }), by: z.string().min(1).max(200) }).strict(),
  schedule: z.string().max(2000).optional(), staleAfterHours: z.number().finite().positive().max(87600).optional(), fixed: z.boolean().optional(),
}).strict();
export type DashboardDataset = z.infer<typeof dashboardDatasetSchema>;
export type DashboardData = DashboardTable & { id: string; meta: DashboardDataset; status: "ok" };
const indexSchema = z.object({ v: z.literal(1) }).strict();
const pageSchema = z.object({ text: z.string() }).strict();
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) && [null, Object.prototype].includes(Object.getPrototypeOf(value));
function safeJson(value: unknown, depth = 0): void {
  if (depth > 32) throw new Error("Dashboard JSON exceeds 32 nested levels");
  if (value === null || ["string", "boolean"].includes(typeof value) || typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) safeJson(item, depth + 1); return; }
  if (!plain(value)) throw new Error("Dashboard documents require plain JSON data");
  for (const [key, item] of Object.entries(value)) { if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Unsafe Dashboard JSON key"); safeJson(item, depth + 1); }
}
function documentPath(value: string) {
  const simple = /^(?:dash\/[A-Za-z0-9_-]{1,64}|datasets\/[A-Za-z0-9_-]{1,64}|files\/[A-Za-z0-9_][A-Za-z0-9_. -]{0,199})$/.test(value);
  if (!simple && value !== "data/users/local/runs") throw new Error("Invalid native Dashboard document path");
  return value;
}
const encoded = (value: unknown) => { safeJson(value); const data = encoder.encode(JSON.stringify(value, null, 2) + "\n"); if (data.length > DASHBOARD_LIMITS.document) throw new Error("A Dashboard document exceeds 256 KiB"); return data; };
export function readDashboardSource(files: readonly Member[], documentId: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(documentId)) throw new Error("Invalid Dashboard identity");
  if (files.length > DASHBOARD_LIMITS.files || files.reduce((total, file) => total + file.data.length, 0) > DASHBOARD_LIMITS.source || new Set(files.map(file => file.path)).size !== files.length) throw new Error("Dashboard source exceeds its complete member budget");
  const members = new Map(files.map(file => [file.path, file.data])), index = members.get("dashboard.json");
  if (!index || members.has("canvas.json") || members.has("deck.json")) throw new Error("An unambiguous Dashboard index is required");
  if (index.length > 65536) throw new Error("Dashboard index exceeds 64 KiB"); indexSchema.parse(JSON.parse(decoder.decode(index)));
  const documents: Record<string, Record<string, unknown>> = Object.create(null), blobs = new Map<string, Uint8Array>();
  for (const file of files) {
    if (["dashboard.json", "comments.json"].includes(file.path)) continue;
    if (file.path.startsWith("db/") && file.path.endsWith(".json")) {
      const path = documentPath(file.path.slice(3, -5));
      if (file.data.length > DASHBOARD_LIMITS.document) throw new Error("A Dashboard document exceeds 256 KiB");
      const value: unknown = JSON.parse(decoder.decode(file.data)); safeJson(value); if (!plain(value)) throw new Error("A Dashboard document must be an object"); documents[path] = value;
    } else {
      const match = /^_blobs\/([a-f0-9]{32})(\.json)?$/.exec(file.path);
      if (!match) throw new Error("Unknown Dashboard source member: " + file.path);
      if (match[2]) { if (file.data.length > 8192) throw new Error("Blob metadata exceeds 8 KiB"); const meta: unknown = JSON.parse(decoder.decode(file.data)); safeJson(meta); }
      else { if (file.data.length > DASHBOARD_DATA_LIMITS.bytes) throw new Error("A Dashboard attachment exceeds 8 MiB"); blobs.set(blobId.parse(match[1]), file.data); }
    }
  }
  const title = z.object({ title: z.string().trim().min(1).max(250) }).passthrough().parse(documents["dash/meta"]).title;
  const page = pageSchema.parse(documents["files/index.html"]).text;
  const sourceFiles: Record<string, string> = Object.create(null);
  for (const [path, value] of Object.entries(documents)) if (path.startsWith("files/")) sourceFiles[path.slice(6)] = pageSchema.parse(value).text;
  const datasets: Record<string, DashboardData> = Object.create(null);
  for (const [path, value] of Object.entries(documents)) {
    if (!path.startsWith("datasets/")) continue;
    if (Object.keys(datasets).length >= DASHBOARD_LIMITS.datasets) throw new Error("Dashboard exceeds 128 datasets");
    const datasetId = id.parse(path.slice(9)), meta = dashboardDatasetSchema.parse(value), bytes = blobs.get(meta.source.url.slice(7));
    if (!bytes || !members.has("_blobs/" + meta.source.url.slice(7) + ".json")) throw new Error("A dataset attachment or its metadata is missing");
    const format = meta.source.format ?? /\.(csv|tsv|json)$/i.exec(meta.source.name)?.[1]?.toLowerCase() as DashboardDataFormat | undefined;
    if (!format) throw new Error("Declare the dataset format when its name has no csv/tsv/json extension");
    datasets[datasetId] = { id: datasetId, meta, status: "ok", ...parseDashboardRows(decoder.decode(bytes), format) };
  }
  const file = "db/files/index.html.json", boardId = nativeSourceId("dash-", "index.html");
  return { manifest: { schemaVersion: 1 as const, format: "bottega-design" as const, contentFormat: "dashboard/v1" as const, documentId, title,
    boards: [{ id: boardId, title, file, mode: "responsive" as const, viewport: { width: 1200, height: 900 } }], launchBoard: boardId }, documents, datasets, sourceFiles, blobs, page };
}
export type DashboardSource = ReturnType<typeof readDashboardSource>;
function update(base: Record<string, unknown>, incoming: Record<string, unknown>) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null || plain(value) && Object.keys(value).length === 1 && value.__delete__ === true) delete result[key];
    else result[key] = plain(value) && plain(result[key]) ? update(result[key] as Record<string, unknown>, value) : structuredClone(value);
  }
  return result;
}
export function applyDashboardBatch(files: readonly Member[], raw: unknown, documentId: string): Member[] {
  if (encoder.encode(JSON.stringify(raw)).length > DASHBOARD_LIMITS.batch) throw new Error("A Dashboard batch exceeds 1 MiB");
  const writes = z.array(z.object({ op: z.enum(["set", "update", "delete"]), path: z.string().max(240), data: z.unknown().optional() }).strict()).min(1).max(DASHBOARD_LIMITS.writes).parse(raw);
  if (new Set(writes.map(write => write.path)).size !== writes.length) throw new Error("A Dashboard batch writes each document only once");
  readDashboardSource(files, documentId); const next = new Map(files.map(file => [file.path, file.data]));
  for (const write of writes) {
    const path = "db/" + documentPath(write.path) + ".json";
    if (write.op === "delete") { if (write.data !== undefined) throw new Error("A delete has no data"); next.delete(path); continue; }
    safeJson(write.data); if (!plain(write.data)) throw new Error("A document write requires a JSON object");
    if (write.op === "update" && !next.has(path)) throw new Error("Cannot update a missing Dashboard document");
    const value = write.op === "set" ? write.data : update(JSON.parse(decoder.decode(next.get(path)!)), write.data); next.set(path, encoded(value));
  }
  const result = [...next].map(([path, data]) => ({ path, data })); readDashboardSource(result, documentId); return result;
}
