/**
 * [INPUT]: Immutable canonical/native versions, bounded comment data and portable regular ZIP members.
 * [OUTPUT]: One hash-addressed handoff graph, original native History projection and completely verified import material.
 * [POS]: Portable project content model; imported display metadata never carries host execution authority.
 */
import { z } from "zod";
import { createHash } from "node:crypto";
import { sourcePath } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { nativeComposeSchema, nativeCommentsSchema } from "@ai-chat/cloud-protocol/artifacts/design/native/comments";
import { PROJECT_ZIP_LIMITS, type ProjectMember } from "./zip";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex"), encode = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const hex = z.string().regex(/^[a-f0-9]{64}$/), format = z.enum(["canvas-dc/v3", "slides/v4", "design-system/v1", "dashboard/v1"]);
const authorSchema = z.object({ kind: z.enum(["user", "agent", "restore", "external"]), name: z.string().min(1).max(80) }).strict();
const versionSchema = z.object({ n: z.number().int().positive(), at: z.string().datetime({ offset: true }), author: authorSchema,
  restoredFrom: z.number().int().positive().max(PROJECT_ZIP_LIMITS.versions).optional(), restoredPart: z.boolean().optional(),
  source: z.record(sourcePath, hex), native: z.record(z.string().min(1).max(512), hex) }).strict();
const handoffSchema = z.object({ format: z.literal("artifact-project/v1"), contentFormat: format, title: z.string().min(1).max(250), cut: z.number().int().positive().max(PROJECT_ZIP_LIMITS.versions), versions: z.array(versionSchema).min(1).max(PROJECT_ZIP_LIMITS.versions) }).strict();
export type ProjectFormat = z.infer<typeof format>;
export type ProjectVersion = { restoredFrom?: number; restoredPart?: boolean; n: number; at: string; author: z.infer<typeof authorSchema>; source: readonly ProjectMember[]; native: readonly ProjectMember[] };
const portableLocation = nativeComposeSchema.pick({ file: true, section: true, area: true, revision: true, snapshotRef: true, readSetDigest: true }).strip();
export function portableComments(bytes: Uint8Array): Uint8Array {
  const comments = nativeCommentsSchema.parse(JSON.parse(decode(bytes)));
  return encode({ ...comments, threads: comments.threads.map(thread => ({ ...thread,
    location: portableLocation.parse(thread.location),
    ...(thread.result ? { result: { ...thread.result, requestId: "portable-" + hash(encode([thread.id, thread.result.revision, thread.result.summary])).slice(0, 32), messageId: "portable-result" } } : {}),
    ...(thread.agent ? { agent: { ...thread.agent, via: undefined } } : {}),
  })) });
}
function nativePath(contentFormat: ProjectFormat, path: string) {
  if (path === "comments.json") return path;
  const local = contentFormat === "dashboard/v1" ? path : path.startsWith("project/") ? path.slice(8) : "";
  sourcePath.parse(local);
  if (contentFormat === "dashboard/v1" && local !== "dashboard.json" && !local.startsWith("db/") && !local.startsWith("_blobs/")) throw new Error("Unknown native Dashboard project member");
  return path;
}
function sourceBudget(contentFormat: ProjectFormat, entries: readonly ProjectMember[], native = false) {
  const limit = contentFormat === "canvas-dc/v3" ? 64 : 512;
  if (!entries.length || entries.length > limit + (native ? 32 : 0) || entries.reduce((total, file) => total + file.data.length, 0) > (native ? 50_000_000 : 32 * 1024 * 1024)) throw new Error("Project version source exceeds its complete member/byte budget");
  const names = new Set<string>();
  for (const file of entries) { const key = file.path.toLowerCase(); if (names.has(key)) throw new Error("Duplicate project version member"); names.add(key); if (native) nativePath(contentFormat, file.path); else sourcePath.parse(file.path); }
}
function nativeHistory(contentFormat: ProjectFormat, versions: z.infer<typeof versionSchema>[]) {
  let before: Record<string, string> = {};
  return { format: 1, next: versions.length + 1, base: {}, versions: versions.map(version => {
    const tracked = contentFormat === "dashboard/v1" ? Object.fromEntries(Object.entries(version.native).filter(([path]) => /^db\/(?:dash|datasets|files)\/.+\.json$/.test(path) && path !== "db/dash/settings.json").map(([path, digest]) => [path.slice(3, -5), digest])) : version.native;
    const changes = Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(tracked)])].sort().flatMap(path => before[path] === tracked[path] ? [] : [[path, tracked[path] ?? null]])); before = tracked;
    const by = version.author.kind === "user" ? "human" : version.author.kind === "agent" ? "agent" : "system";
    return { n: version.n, first: version.at, at: version.at, by, user: { id: by, name: version.author.name }, changes, ...(version.restoredFrom ? { restoredFrom: version.restoredFrom, ...(version.restoredPart ? { restoredPart: true } : {}) } : {}) };
  }), notices: [] };
}
export function createProjectMembers(root: string, contentFormat: ProjectFormat, title: string, versions: readonly ProjectVersion[]): ProjectMember[] {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(root)) throw new Error("Invalid portable project root");
  format.parse(contentFormat); const objects = new Map<string, Uint8Array>();
  const members = (input: readonly ProjectMember[], native: boolean) => {
    const files = input.map(file => ({ path: file.path, data: file.path === "comments.json" ? portableComments(file.data) : file.data })); sourceBudget(contentFormat, files, native);
    return Object.fromEntries([...files].sort((a, b) => a.path < b.path ? -1 : 1).map(file => { const digest = hash(file.data); objects.set(digest, file.data.slice()); return [file.path, digest]; }));
  };
  const handoff = handoffSchema.parse({ format: "artifact-project/v1", contentFormat, title, cut: versions.length,
    versions: versions.map((version, index) => { if (version.n !== index + 1) throw new Error("Complete project history requires a contiguous sequence"); return { n: version.n, at: version.at, author: version.author, ...(version.restoredFrom ? { restoredFrom: version.restoredFrom, restoredPart: version.restoredPart ?? false } : {}), source: members(version.source, false), native: members(version.native, true) }; }) });
  const result: ProjectMember[] = [{ path: root + "/handoff.json", data: encode(handoff) }, { path: root + "/history/index.json", data: encode(nativeHistory(handoff.contentFormat, handoff.versions)) }];
  for (const [digest, data] of objects) result.push({ path: root + "/history/objects/" + digest, data });
  for (const [path, digest] of Object.entries(handoff.versions.at(-1)!.native)) result.push({ path: root + "/" + path, data: objects.get(digest)!.slice() });
  if (result.length > PROJECT_ZIP_LIMITS.entries || result.reduce((total, file) => total + file.data.length, 0) > PROJECT_ZIP_LIMITS.expanded) throw new Error("Complete project history exceeds its member/expanded budget");
  return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
export function readProjectMembers(input: readonly ProjectMember[]) {
  if (!input.length || input.length > PROJECT_ZIP_LIMITS.entries || input.reduce((total, file) => total + file.data.length, 0) > PROJECT_ZIP_LIMITS.expanded || new Set(input.map(file => file.path.toLowerCase())).size !== input.length) throw new Error("Project members exceed their identity or expanded budget");
  const roots = new Set(input.map(file => file.path.split("/")[0]!)); if (roots.size !== 1) throw new Error("A project ZIP requires one complete root"); const root = [...roots][0]!;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(root)) throw new Error("Invalid portable project root");
  const files = new Map(input.map(file => [file.path.slice(root.length + 1), file.data])), raw = files.get("handoff.json");
  if (!raw || raw.length > 16 * 1024 * 1024) throw new Error("Missing or oversized portable project manifest");
  const handoff = handoffSchema.parse(JSON.parse(decode(raw))); if (handoff.cut !== handoff.versions.length || handoff.versions.some((version, index) => version.n !== index + 1)) throw new Error("Incomplete project history sequence");
  const used = new Set(["handoff.json", "history/index.json"]);
  const material = (members: Record<string, string>, native: boolean) => Object.entries(members).map(([path, digest]) => {
    if (native) nativePath(handoff.contentFormat, path); const name = "history/objects/" + digest, data = files.get(name); used.add(name);
    if (!data || hash(data) !== digest) throw new Error("Missing or corrupt project history object"); return { path, data };
  });
  const logical = handoff.versions.reduce((total, version) => total + Object.values(version.source).reduce((sum, digest) => sum + (files.get("history/objects/" + digest)?.length ?? 0), 0), 0);
  if (logical > PROJECT_ZIP_LIMITS.expanded) throw new Error("Complete canonical history exceeds its materialization budget");
  const versions = handoff.versions.map(version => { const source = material(version.source, false), native = material(version.native, true); sourceBudget(handoff.contentFormat, source); sourceBudget(handoff.contentFormat, native, true); return { n: version.n, at: version.at, author: version.author, ...(version.restoredFrom ? { restoredFrom: version.restoredFrom, restoredPart: version.restoredPart ?? false } : {}), source, native }; });
  const history = files.get("history/index.json"); if (!history || JSON.stringify(JSON.parse(decode(history))) !== JSON.stringify(nativeHistory(handoff.contentFormat, handoff.versions))) throw new Error("Native project History differs from its fixed handoff history");
  for (const [path, digest] of Object.entries(handoff.versions.at(-1)!.native)) { used.add(path); const bytes = files.get(path); if (!bytes || hash(bytes) !== digest) throw new Error("Current native project member differs from the final saved version"); }
  if ([...files.keys()].some(path => !used.has(path))) throw new Error("The project contains an unlisted member");
  return { title: handoff.title, contentFormat: handoff.contentFormat, versions };
}
