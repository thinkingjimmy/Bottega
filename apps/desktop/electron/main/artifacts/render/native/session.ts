/**
 * [INPUT]: Exact-owner immutable native snapshot, live generation/window guard, pending mounted-view flush admission and the existing document journal.
 * [OUTPUT]: Bounded native reads, original fixed-comment result recovery, source-CAS publish/upload, nonce-bound closing saves, authenticated concrete-preview/main-frozen producer jobs and token-bound same-origin exact-file reads and immutable original-operation receipts without adopting unseen external heads.
 * [POS]: Trusted native editor session; authored frames have neither its origin nor its write token.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { readNativeComments } from "@ai-chat/cloud-protocol/artifacts/design/native/comments";
import { unpackArtifactArchive } from "@ai-chat/cloud-protocol/artifacts/archive";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { designDocuments } from "../../../design/documents/runtime";
import type { DesignRevision } from "../../../design/documents/store";
import { designDigest, sourcePath, requestKey, DESIGN_LIMITS, DESIGN_SLIDES_LIMITS } from "../../../design/documents/model";
import { readDesignSet } from "../../../design/documents/read-set";
import { assertArtifactGeneration } from "../../admission/state";
import { artifactMime } from "../../admission/files";
import { NativePresentationHost } from "../../../design/native/presentation/host";
import type { NativeExportOptions } from "@ai-chat/cloud-protocol/artifacts/design/export/options";
import type { NativePresentationRole } from "@ai-chat/cloud-protocol/artifacts/design/native/presentation/model";
import { NativeDownloads } from "./downloads";
import { nativeEditorAssets } from "./assets";
export type NativeEditorOptions = { export?: NativeExportOptions; presentation?: NativePresentationRole };
export type NativeReply = { status: number; body: Uint8Array; mime: string };
const json = (status: number, value: unknown): NativeReply => ({ status, body: Buffer.from(JSON.stringify(value)), mime: "application/json" });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const write = z.object({ base64: z.string().max(24 * 1024 * 1024), contentType: z.string().max(256), ifMatch: hash.nullable().optional() }).strict();
const deletion = z.object({ delete: z.literal(true), ifMatch: hash.optional() }).strict();
const batchSchema = z.object({ files: z.record(z.string().max(1024), z.union([write, deletion, z.null()])) }).strict();
export class NativeEditorSession {
  readonly token = randomUUID();
  readonly files = new Map<string, Uint8Array>();
  readonly downloads: NativeDownloads;
  private readonly presentation: NativePresentationHost;
  private sources: Map<string, Uint8Array>;
  private version: DesignRevision;
  private constructor(readonly input: WorkspaceCommand, snapshot: { version: DesignRevision; files: { path: string; data: Uint8Array }[] }, private readonly guard: () => void, private readonly editable: boolean, private readonly finalFlush: (nonce: string) => void, windowId: number, role?: NativePresentationRole, private readonly completeFileList = false) {
    this.presentation = new NativePresentationHost({ key: this.token, input, windowId, guard, role });
    this.downloads = new NativeDownloads(input, guard, windowId);
    this.version = snapshot.version; this.sources = new Map(snapshot.files.map(file => [file.path, file.data]));
  }
  static async create(input: WorkspaceCommand, snapshot: { version: DesignRevision; files: { path: string; data: Uint8Array }[]; editable: boolean }, guard: () => void, finalFlush: (nonce: string) => void, windowId: number, options?: NativeEditorOptions) {
    const exportOptions = options?.export;
    if (options?.presentation && (snapshot.editable || exportOptions)) throw new Error("A presentation audience must be separate and read-only");
    if (exportOptions && snapshot.editable) throw new Error("A native export job must be read-only");
    if (!["canvas-dc/v3", "slides/v4"].includes(snapshot.version.manifest.contentFormat ?? "")) throw new Error("Unsupported native editor format");
    const session = new NativeEditorSession(input, snapshot, guard, snapshot.editable, finalFlush, windowId, options?.presentation, exportOptions?.format === "html" && exportOptions.bundle);
    const assets = await nativeEditorAssets(snapshot.version.manifest.contentFormat!); guard();
    for (const [path, data] of assets) session.files.set("editor/" + path, data);
    const presentationMeta = options?.presentation ? `<meta name="bottega-native-presentation" content="${Buffer.from(JSON.stringify(options.presentation)).toString("base64")}">` : "";
    const exportMeta = exportOptions ? `<meta name="bottega-native-export" content="${Buffer.from(JSON.stringify(exportOptions)).toString("base64")}">` : "";
    const html = Buffer.from(assets.get("index.html")!).toString("utf8").replace("<head>", `<head><meta name="bottega-native-token" content="${session.token}">${exportMeta}${presentationMeta}`);
    session.files.set("editor/index.html", Buffer.from(html));
    const runtime = assets.get("artifact-type/dc-runtime.js");
    if (runtime) session.files.set("editor/support.js", runtime);
    session.syncFiles(); return session;
  }
  close() { this.downloads.close(); this.presentation.close(); }
  snapshot() { return { version: this.version, files: [...this.sources].map(([path, data]) => ({ path, data })) }; }
  mime(path: string) {
    const id = /\/_blob\/([a-f0-9]{32})$/.exec(path)?.[1];
    const asset = id ? [...this.sources.keys()].find(path => path.startsWith("assets/" + id + ".")) : undefined;
    return artifactMime(asset ?? path);
  }
  private syncFiles() {
    for (const path of this.files.keys()) if (path.startsWith("editor/project/") || path.startsWith("editor/_blob/")) this.files.delete(path);
    const runtime = this.files.get("editor/support.js");
    if (runtime && !this.sources.has("support.js")) this.files.set("editor/project/support.js", runtime);
    for (const [path, data] of this.sources) {
      this.files.set("editor/project/" + path, data);
      const asset = /^assets\/([a-f0-9]{32})\.[a-z0-9]+$/.exec(path);
      if (asset) this.files.set("editor/_blob/" + asset[1], data);
    }
  }
  private async canWrite(nonce?: string) {
    try {
      if (nonce) this.finalFlush(nonce); else { this.guard(); assertArtifactGeneration(this.input.generation); }
      if (!this.editable) return false;
      const documents = designDocuments(), authority = documents.authority(this.input.chatId, this.input.incarnationId);
      if (JSON.stringify(authority) !== JSON.stringify(this.version.authority)) return false;
      const latest = documents.store.latest(authority.ownerId, this.version.manifest.documentId, authority);
      if (!latest || latest.artifactId !== this.version.artifactId || documents.store.blocking().some(operation => operation.revision.authority.ownerId === authority.ownerId && operation.revision.manifest.documentId === this.version.manifest.documentId)) return false;
      return (await readDesignSet(authority.workspace, latest.path)).readSetDigest === latest.readSetDigest;
    } catch { return false; }
  }
  private async body(request: IncomingMessage, limit = 24 * 1024 * 1024) {
    const pieces: Buffer[] = []; let total = 0;
    for await (const piece of request) { const bytes = Buffer.from(piece); total += bytes.length;
      if (total > limit) throw new Error("Native request exceeds its byte budget"); pieces.push(bytes); }
    return Buffer.concat(pieces);
  }
  async handle(request: IncomingMessage, path: string, origin: string): Promise<NativeReply | null> {
    if (path.startsWith("/")) path = "editor/" + path.slice(1);
    if (!path.startsWith("editor/")) return null;
    const route = path.slice(7), method = request.method ?? "";
    const header = request.headers["x-bottega-final-flush"];
    const nonce = typeof header === "string" && request.headers["x-bottega-native"] === this.token ? header : undefined;
    const admit = () => { if (nonce) this.finalFlush(nonce); else { this.guard(); assertArtifactGeneration(this.input.generation); } };
    if (route === "_files.json" && ["GET", "HEAD"].includes(method)) return json(200, { ver: this.version.readSetDigest,
      files: Object.fromEntries([...this.sources].filter(([path]) => this.completeFileList || this.version.manifest.contentFormat === "slides/v4" || !path.startsWith("assets/")).map(([path, bytes]) => ["project/" + path, { sha256: designDigest(bytes).slice(7), size: bytes.length, contentType: artifactMime(path) }])) });
    if (route === "__deck/session" && ["GET", "HEAD"].includes(method)) return json(200, { canEdit: await this.canWrite(nonce), revision: this.version.revision });
    if (!["__deck/publish", "__deck/assets", "__deck/download", "__deck/comment-result", "__deck/presentation"].includes(route)) return null;
    if (method !== "POST" && !(route === "__deck/download" && method === "GET")) return json(405, { code: "not_granted" });
    const sameOriginRead = route === "__deck/download" && method === "GET" && !request.headers.origin && request.headers["sec-fetch-site"] === "same-origin";
    if ((!sameOriginRead && request.headers.origin !== origin) || request.headers["x-bottega-native"] !== this.token) return json(403, { code: "not_granted", message: "Native request belongs to another frame" });
    const id = request.headers["x-bottega-request"];
    if (typeof id !== "string" || !/^native-[a-f0-9-]{36}$/.test(id)) return json(400, { code: "invalid_content", message: "A stable native request ID is required" });
    try {
      if (route === "__deck/presentation") return json(200, await this.presentation.handle(JSON.parse((await this.body(request, 8192)).toString("utf8")), id, this.snapshot()));
      if (route === "__deck/download") {
        this.guard();
        if (method === "GET") { const result = await this.downloads.read(id); return { status: 200, body: result.data, mime: result.mime }; }
        return json(200, await this.downloads.stage(request, id, this.snapshot()));
      }
      if (route === "__deck/comment-result") return this.commentResult(id, await this.body(request));
      const body = await this.body(request), digest = designDigest(JSON.stringify([route, request.headers["content-type"] ?? "", designDigest(body)])), documents = designDocuments();
      const existing = documents.store.operation(requestKey(this.version.authority, id));
      if (existing) {
        const input = existing.sourceEdit?.input;
        if (!input || input.action !== "native-publish" || input.sourceDigest !== digest || existing.revision.manifest.documentId !== this.version.manifest.documentId)
          return json(409, { code: "conflict", message: "Native request ID was used with different bytes" });
        return this.finish(await documents.operationStatus(input, true), route, body);
      }
      admit();
      if (!await this.canWrite(nonce)) return json(409, { code: "conflict", message: "The source or editor lifetime changed. Reopen the current document." });
      const files = new Map(this.sources);
      if (route === "__deck/publish") {
        const batch = batchSchema.parse(JSON.parse(body.toString("utf8"))).files;
        if (Object.keys(batch).length > (this.version.manifest.contentFormat === "slides/v4" ? DESIGN_SLIDES_LIMITS.files : DESIGN_LIMITS.files)) throw new Error("Native publish exceeds the file budget");
        let total = 0;
        for (const [key, value] of Object.entries(batch)) {
          if (!key.startsWith("project/")) throw new Error("Native publication requires a project path");
          const path = sourcePath.parse(key.slice(8));
          if (path.startsWith("assets/")) throw new Error("Native assets must use the upload capability");
          const previous = files.get(path), actual = previous ? designDigest(previous).slice(7) : null;
          if (value && value.ifMatch !== undefined && value.ifMatch !== actual)
            return json(409, { code: "conflict", live: this.version.readSetDigest, paths: [{ path: key, actual, expected: value.ifMatch }] });
          if (value === null || "delete" in value) files.delete(path);
          else { const bytes = Buffer.from(value.base64, "base64"); total += bytes.length;
            if (bytes.toString("base64") !== value.base64 || total > 16 * 1024 * 1024) throw new Error("Native publication has invalid or oversized content");
            files.set(path, bytes); }
        }
      } else {
        const { path } = this.asset(body, request.headers["content-type"] ?? ""); files.set(path, body);
      }
      const input: WorkspaceCommand = { action: "native-publish", chatId: this.input.chatId, incarnationId: this.input.incarnationId,
        artifactId: this.version.artifactId, documentId: this.version.manifest.documentId, generation: this.input.generation,
        requestId: id, expectedRevision: this.version.revision, readSetDigest: this.version.readSetDigest, sourceDigest: digest };
      const receipt = await documents.edit(input, this.version, async () => [...files].map(([path, data]) => ({ path, data })), admit, nonce ? { kind: "native-final-flush", assert: admit } : undefined);
      return this.finish(receipt, route, body, request.headers["content-type"] ?? "");
    } catch (cause) { return json(409, { code: "conflict", message: cause instanceof Error ? cause.message.slice(0, 500) : "Native save failed" }); }
  }
  private async commentResult(id: string, body: Uint8Array) {
    const { digest } = z.object({ digest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict().parse(JSON.parse(Buffer.from(body).toString("utf8")));
    const documents = designDocuments(), operation = documents.store.operation(requestKey(this.version.authority, id)), input = operation?.sourceEdit?.input;
    if (!operation) return json(404, { beforeDigest: designDigest(JSON.stringify(readNativeComments([...this.sources].map(([path, data]) => ({ path, data }))))) });
    if (!input || input.action !== "native-publish" || operation.revision.manifest.documentId !== this.version.manifest.documentId ||
      operation.sourceEdit?.effects?.length !== 1 || operation.sourceEdit.effects[0]?.path !== "comments.json") throw new Error("Original comment save belongs to another operation");
    const files = unpackArtifactArchive(await documents.store.read(operation.revision.snapshotRef), 512);
    if (designDigest(JSON.stringify(readNativeComments(files))) !== digest) throw new Error("Original comment save has different bytes");
    const result = await this.finish(await documents.operationStatus(input, true), "__deck/comment-result", new Uint8Array());
    return result;
  }
  private asset(bytes: Uint8Array, mime: string) {
    const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg", "font/woff": "woff", "font/woff2": "woff2", "font/ttf": "ttf", "font/otf": "otf" } as Record<string, string>)[mime];
    if (!ext || bytes.length > 8 * 1024 * 1024) throw new Error("Native asset type or size is unsupported");
    const id = designDigest(bytes).slice(7, 39); return { id, path: `assets/${id}.${ext}` };
  }
  private async finish(receipt: Awaited<ReturnType<ReturnType<typeof designDocuments>["operationStatus"]>>, route: string, body: Uint8Array, mime = "") {
    if (receipt.status !== "committed") return json(409, { code: "conflict", message: "Save result is pending. Query the original request before retrying.", receipt });
    const documents = designDocuments(), operation = documents.store.operation(requestKey(this.version.authority, receipt.requestId));
    if (!operation || operation.state !== "complete") throw new Error("Native save receipt is unavailable");
    const committed = operation.revision, files = unpackArtifactArchive(await documents.store.read(committed.snapshotRef), 512);
    if (committed.revision >= this.version.revision) { this.version = committed; this.sources = new Map(files.map(file => [file.path, file.data])); this.syncFiles(); }
    const common = { version: committed.readSetDigest, revision: committed.revision, fence: committed.fence, requestId: receipt.requestId,
      shas: Object.fromEntries(files.map(({ path, data }) => ["project/" + path, designDigest(data).slice(7)])) };
    if (route === "__deck/assets") { const id = designDigest(body).slice(7, 39); return json(200, { ...common, id, url: `/_blob/${id}`, sizeBytes: body.length, ...(mime ? { contentType: mime } : {}) }); }
    return json(200, route === "__deck/comment-result" ? { ...common, comments: readNativeComments(files) } : common);
  }
}
