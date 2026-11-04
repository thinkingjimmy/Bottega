/**
 * [INPUT]: Exact-owner immutable native snapshot, live generation/window guard, pending mounted-view flush admission and the existing document journal.
 * [OUTPUT]: Bounded native reads, original fixed-comment result recovery, source-CAS publish/upload, nonce-bound closing saves, authenticated concrete-preview/main-frozen producer jobs and token-bound same-origin exact-file reads and immutable original-operation receipts with exact journal-parent adoption of confirmed Chat results, effect-free System acknowledgements and capability-free fixed History previews.
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
import { designDigest, sourcePath, requestKey, designFileLimit } from "../../../design/documents/model";
import { readDesignSet } from "../../../design/documents/read-set";
import { assertArtifactGeneration } from "../../admission/state";
import { artifactMime } from "../../admission/files";
import { NativePresentationHost } from "../../../design/native/presentation/host";
import type { NativeExportOptions } from "@ai-chat/cloud-protocol/artifacts/design/export/options";
import type { NativePresentationRole } from "@ai-chat/cloud-protocol/artifacts/design/native/presentation/model";
import { readCanonicalSystem, systemEditorProjection, applySystemEditorProjection } from "../../../design/systems/native/editor";
import { NativeDownloads } from "./downloads";
import { nativeEditorAssets } from "./assets";
export type NativeEditorOptions = { preview?: boolean; export?: NativeExportOptions; presentation?: NativePresentationRole };
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
  private editorSources = new Map<string, Uint8Array>();
  private readonly editorSerializations = new Map<string, { canonicalDigest: string; bytes: Uint8Array }>();
  private readonly noEffects = new Map<string, { digest: string; reply: NativeReply; commentsDigest: string }>();
  private version: DesignRevision;
  private constructor(readonly input: WorkspaceCommand, snapshot: { version: DesignRevision; files: { path: string; data: Uint8Array }[] }, private readonly guard: () => void, private readonly editable: boolean, private readonly finalFlush: (nonce: string) => void, windowId: number, role?: NativePresentationRole, private readonly completeFileList = false) {
    this.presentation = new NativePresentationHost({ key: this.token, input, windowId, guard, role });
    this.downloads = new NativeDownloads(input, guard, windowId);
    this.version = snapshot.version; this.sources = new Map(snapshot.files.map(file => [file.path, file.data]));
  }
  static async create(input: WorkspaceCommand, snapshot: { version: DesignRevision; files: { path: string; data: Uint8Array }[]; editable: boolean }, guard: () => void, finalFlush: (nonce: string) => void, windowId: number, options?: NativeEditorOptions) {
    const exportOptions = options?.export;
    if (options?.preview && (snapshot.editable || exportOptions || options.presentation)) throw new Error("A System browser must be separate and read-only");
    if (options?.presentation && (snapshot.editable || exportOptions)) throw new Error("A presentation audience must be separate and read-only");
    if (exportOptions && snapshot.editable) throw new Error("A native export job must be read-only");
    if (snapshot.version.manifest.format !== "bottega-design-system" && !["canvas-dc/v3", "slides/v4", "dashboard/v1"].includes(snapshot.version.manifest.contentFormat ?? "")) throw new Error("Unsupported native editor format");
    const session = new NativeEditorSession(input, snapshot, guard, snapshot.editable, finalFlush, windowId, options?.presentation, exportOptions?.format === "html" && exportOptions.bundle);
    const assets = await nativeEditorAssets(snapshot.version.manifest.format === "bottega-design-system" ? "design-system/v1" : snapshot.version.manifest.contentFormat!); guard();
    for (const [path, data] of assets) session.files.set("editor/" + path, data);
    const presentationMeta = options?.presentation ? `<meta name="bottega-native-presentation" content="${Buffer.from(JSON.stringify(options.presentation)).toString("base64")}">` : "";
    const exportMeta = exportOptions ? `<meta name="bottega-native-export" content="${Buffer.from(JSON.stringify(exportOptions)).toString("base64")}">` : "";
    const html = Buffer.from(assets.get("index.html")!).toString("utf8").replace("<head>", `<head><meta name="bottega-native-token" content="${session.token}">${options?.preview ? '<meta name="bottega-native-readonly" content="1">' : ""}<meta name="bottega-native-systems" content="${Buffer.from(JSON.stringify(snapshot.version.manifest.systems?.map(value => value.documentId) ?? [])).toString("base64")}">${exportMeta}${presentationMeta}`);
    session.files.set("editor/index.html", Buffer.from(html));
    const runtime = assets.get("artifact-type/dc-runtime.js");
    if (runtime) session.files.set("editor/support.js", runtime);
    session.syncFiles(); return session;
  }
  close() { this.noEffects.clear(); this.downloads.close(); this.presentation.close(); }
  snapshot() { return { version: this.version, files: [...this.sources].map(([path, data]) => ({ path, data })) }; }
  editorSnapshot() {
    const files = [...this.editorSources].map(([path, data]) => ({ path, data }));
    if (files.length > 512 || files.reduce((total, file) => total + file.data.length, 0) > 32 * 1024 * 1024) throw new Error("The native editor projection exceeds its complete byte budget");
    return files;
  }
  mime(path: string) {
    const id = /\/_blob\/([a-f0-9]{32})$/.exec(path)?.[1];
    const asset = id ? [...this.sources.keys()].find(path => path.startsWith("assets/" + id + ".")) : undefined;
    if (id && this.version.manifest.contentFormat === "dashboard/v1") {
      const raw = this.sources.get("_blobs/" + id + ".json"); if (raw) return JSON.parse(new TextDecoder().decode(raw)).contentType;
    }
    return artifactMime(asset ?? path);
  }
  private syncFiles() {
    this.editorSources = new Map(this.sources);
    if (this.version.manifest.system) {
      const files = [...this.sources].map(([path, data]) => ({ path, data }));
      this.editorSources = new Map([...systemEditorProjection(readCanonicalSystem(this.version.manifest, files), this.version.manifest, files)].map(([path, data]) => [path.slice(8), data]));
      const comments = this.sources.get("comments.json"); if (comments) this.editorSources.set("comments.json", comments);
      for (const [path, saved] of this.editorSerializations) {
        const current = this.editorSources.get(path);
        if (designDigest(current ?? "") === saved.canonicalDigest) this.editorSources.set(path, saved.bytes);
        else this.editorSerializations.delete(path);
      }
    }
    for (const path of this.files.keys()) if (path.startsWith("editor/project/") || path.startsWith("editor/_blob/")) this.files.delete(path);
    const runtime = this.files.get("editor/support.js");
    if (runtime && !this.sources.has("support.js")) this.files.set("editor/project/support.js", runtime);
    for (const [path, data] of this.editorSources) this.files.set("editor/project/" + path, data);
    for (const [path, data] of this.sources) {
      const blob = /^_blobs\/([a-f0-9]{32})$/.exec(path);
      if (blob) this.files.set("editor/_blob/" + blob[1], data);
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
      if (!latest || latest.artifactId !== this.version.artifactId || documents.store.unsupportedBlocks(authority, this.version.manifest.documentId) || documents.store.blocking().some(operation => operation.revision.authority.ownerId === authority.ownerId && operation.revision.manifest.documentId === this.version.manifest.documentId)) return false;
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
      files: Object.fromEntries([...this.editorSources].filter(([path]) => this.completeFileList || this.version.manifest.contentFormat === "slides/v4" || !path.startsWith("assets/")).map(([path, bytes]) => ["project/" + path, { sha256: designDigest(bytes).slice(7), size: bytes.length, contentType: artifactMime(path) }])) });
    if (route === "__deck/session" && ["GET", "HEAD"].includes(method)) return json(200, { canEdit: await this.canWrite(nonce), revision: this.version.revision, snapshotRef: this.version.snapshotRef, savedAt: this.version.createdAt });
    if (!["__deck/publish", "__deck/assets", "__deck/download", "__deck/comment-result", "__deck/presentation", "__deck/adopt", "__deck/dashboard", "__deck/dashboard-write", "__deck/source", "__deck/preview"].includes(route)) return null;
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
      if (route === "__deck/source") {
        admit(); const target = z.object({ revision: z.number().int().positive(), snapshotRef: z.string() }).strict().parse(JSON.parse((await this.body(request, 1024)).toString("utf8")));
        if (target.revision !== this.version.revision || target.snapshotRef !== this.version.snapshotRef) throw new Error("The displayed source changed before its fixed projection was read");
        return json(200, { ...target, version: this.version.readSetDigest, files: this.editorSnapshot().map(file => ({ path: file.path, base64: Buffer.from(file.data).toString("base64") })) });
      }
      if (route === "__deck/preview") {
        this.guard(); const target = z.object({ artifactId: z.string().uuid(), revision: z.number().int().positive(), boardId: z.string().max(64).optional(), scope: z.literal("board").optional() }).strict().parse(JSON.parse((await this.body(request, 1024)).toString("utf8")));
        const snapshot = await designDocuments().readRevision(this.input.chatId, this.input.incarnationId, this.version.manifest.documentId, target.revision);
        if (snapshot.version.artifactId !== target.artifactId || snapshot.version.manifest.format !== this.version.manifest.format || snapshot.version.manifest.contentFormat !== this.version.manifest.contentFormat) throw new Error("The fixed historical identity or format is not supported by this editor");
        const prepared = await (await import("../../../design/documents/rendering")).prepareDesignSnapshot(snapshot, target.boardId); this.guard();
        const html = (await import("../../../design/documents/resources/html")).inlineDesignTextResources(new TextDecoder("utf-8", { fatal: true }).decode(prepared.html));
        const { designFrameHtml, designPreviewPayloadSchema } = await import("@ai-chat/cloud-protocol/artifacts/design/frame");
        const identity = { id: randomUUID(), nonce: randomUUID(), generation: this.input.generation!, boardId: prepared.metadata.boardId, boardDigest: prepared.metadata.boardDigest, navigation: prepared.metadata.navigation };
        const wrapped = designFrameHtml(html, identity, prepared.metadata.contentFormat === "canvas-dc/v3");
        if (target.scope === "board") return json(200, designPreviewPayloadSchema.parse({ html: wrapped, identity }));
        return { status: 200, body: Buffer.from(wrapped), mime: "text/html" };
      }
      if (route === "__deck/dashboard") {
        this.guard(); if (this.version.manifest.contentFormat !== "dashboard/v1") throw new Error("This editor is not a Dashboard");
        const raw = await this.body(request, 1024); z.object({}).strict().parse(JSON.parse(raw.toString("utf8")));
        const material = await (await import("../../../design/dashboard/requests")).dashboardEditorMaterial(this.snapshot().files, this.version.manifest.documentId, await nativeEditorAssets("dashboard/v1"));
        this.guard(); return json(200, { ...material, revision: this.version.revision, snapshotRef: this.version.snapshotRef });
      }
      if (route === "__deck/comment-result") return await this.commentResult(id, await this.body(request));
      if (route === "__deck/adopt") return await this.adoptChat(await this.body(request, 1024));
      const body = await this.body(request), digest = designDigest(JSON.stringify([route, request.headers["content-type"] ?? "", designDigest(body)])), documents = designDocuments();
      const acknowledged = this.noEffects.get(id);
      if (acknowledged) return acknowledged.digest === digest ? acknowledged.reply : json(409, { code: "conflict", message: "Native request ID was used with different bytes" });
      const existing = documents.store.operation(requestKey(this.version.authority, id));
      if (existing) {
        const input = existing.sourceEdit?.input;
        if (!input || input.action !== "native-publish" || input.sourceDigest !== digest || existing.revision.manifest.documentId !== this.version.manifest.documentId)
          return json(409, { code: "conflict", message: "Native request ID was used with different bytes" });
        return this.finish(await documents.operationStatus(input, true), route, body);
      }
      admit();
      if (!await this.canWrite(nonce)) return json(409, { code: "conflict", message: "The source or editor lifetime changed. Reopen the current document." });
      const files = new Map(route === "__deck/publish" ? this.editorSources : this.sources);
      if (route === "__deck/dashboard-write") {
        if (this.version.manifest.contentFormat !== "dashboard/v1") throw new Error("This editor is not a Dashboard");
        try {
          const next = await (await import("../../../design/dashboard/requests")).dashboardWrite(this.snapshot().files, JSON.parse(body.toString("utf8")), this.version.manifest.documentId);
          files.clear(); for (const file of next) files.set(file.path, file.data);
        } catch (cause) { return json(400, { code: "invalid_content", message: cause instanceof Error ? cause.message.slice(0, 500) : "Invalid Dashboard document batch" }); }
      } else if (route === "__deck/publish") {
        const batch = batchSchema.parse(JSON.parse(body.toString("utf8"))).files;
        if (Object.keys(batch).length > designFileLimit(this.snapshot().files)) throw new Error("Native publish exceeds the file budget");
        if (this.version.manifest.contentFormat === "dashboard/v1" && Object.keys(batch).some(path => path !== "project/comments.json")) throw new Error("Dashboard documents require their bounded atomic batch capability");
        let total = 0;
        for (const [key, value] of Object.entries(batch)) {
          if (!key.startsWith("project/")) throw new Error("Native publication requires a project path");
          const path = sourcePath.parse(key.slice(8));
          if (path.startsWith("assets/") && !this.version.manifest.system) throw new Error("Native assets must use the upload capability");
          const previous = files.get(path), actual = previous ? designDigest(previous).slice(7) : null;
          if (value && value.ifMatch !== undefined && value.ifMatch !== actual)
            return json(409, { code: "conflict", live: this.version.readSetDigest, paths: [{ path: key, actual, expected: value.ifMatch }] });
          if (value === null || "delete" in value) files.delete(path);
          else { const bytes = Buffer.from(value.base64, "base64"); total += bytes.length;
            if (bytes.toString("base64") !== value.base64 || total > 16 * 1024 * 1024) throw new Error("Native publication has invalid or oversized content");
            files.set(path, bytes); }
        }
      } else {
        if (this.version.manifest.contentFormat === "dashboard/v1") throw new Error("Use the atomic Dashboard attachment capability");
        const { path } = this.asset(body, request.headers["content-type"] ?? ""); files.set(path, body);
      }
      const input: WorkspaceCommand = { action: "native-publish", chatId: this.input.chatId, incarnationId: this.input.incarnationId,
        artifactId: this.version.artifactId, documentId: this.version.manifest.documentId, generation: this.input.generation,
        requestId: id, expectedRevision: this.version.revision, readSetDigest: this.version.readSetDigest, sourceDigest: digest };
      let desired = [...files].map(([path, data]) => ({ path, data }));
      if (route === "__deck/publish" && this.version.manifest.system) {
        const canonical = [...this.sources].map(([path, data]) => ({ path, data })), projected = new Map([...files].filter(([path]) => path !== "comments.json").map(([path, data]) => ["project/" + path, data]));
        desired = applySystemEditorProjection(readCanonicalSystem(this.version.manifest, canonical), this.version.manifest, canonical, projected).files.filter(file => file.path !== "comments.json");
        const comments = files.get("comments.json"); if (comments) desired.push({ path: "comments.json", data: comments });
        if (desired.length === this.sources.size && desired.every(file => this.sources.has(file.path) && designDigest(this.sources.get(file.path)!) === designDigest(file.data))) {
          if (this.noEffects.size >= 64) throw new Error("Reopen the System editor before acknowledging more derived saves");
          this.acknowledgeSystemSerialization(body); const reply = json(200, this.savedMetadata(this.version, id));
          this.noEffects.set(id, { digest, reply, commentsDigest: designDigest(JSON.stringify(readNativeComments(desired))) }); return reply;
        }
      }
      const receipt = await documents.edit(input, this.version, async () => desired, admit, nonce ? { kind: "native-final-flush", assert: admit } : undefined);
      return this.finish(receipt, route, body, request.headers["content-type"] ?? "");
    } catch (cause) { return json(409, { code: "conflict", message: cause instanceof Error ? cause.message.slice(0, 500) : "Native save failed" }); }
  }
  private async adoptChat(body: Uint8Array) {
    this.guard(); assertArtifactGeneration(this.input.generation);
    if (!this.editable) throw new Error("A read-only editor cannot adopt a writable head");
    const target = z.object({ revision: z.number().int().positive(), snapshotRef: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict().parse(JSON.parse(Buffer.from(body).toString("utf8")));
    const documents = designDocuments(), authority = documents.authority(this.input.chatId, this.input.incarnationId);
    if (JSON.stringify(authority) !== JSON.stringify(this.version.authority)) throw new Error("The editor authority changed");
    const latest = documents.store.latest(authority.ownerId, this.version.manifest.documentId, authority);
    if (!latest || latest.revision !== target.revision || latest.snapshotRef !== target.snapshotRef) throw new Error("The confirmed Chat result is no longer current");
    const operation = documents.store.operation(requestKey(authority, latest.requestId)), input = operation?.sourceEdit?.input;
    if (operation?.state !== "complete" || input?.action !== "native-chat-apply" || input.expectedRevision !== this.version.revision ||
      input.readSetDigest !== this.version.readSetDigest || input.baselineSnapshotRef !== this.version.snapshotRef ||
      latest.manifest.contentFormat !== this.version.manifest.contentFormat || documents.store.blocking().some(item => item.revision.authority.ownerId === authority.ownerId && item.revision.manifest.documentId === latest.manifest.documentId) || documents.store.unsupportedBlocks(authority, latest.manifest.documentId)) throw new Error("This source change requires an explicit comparison");
    if ((await readDesignSet(authority.workspace, latest.path)).readSetDigest !== latest.readSetDigest) throw new Error("The source has unsaved external changes");
    const files = unpackArtifactArchive(await documents.store.read(latest.snapshotRef), 512);
    this.guard(); assertArtifactGeneration(this.input.generation);
    if (documents.store.latest(authority.ownerId, latest.manifest.documentId, authority)?.artifactId !== latest.artifactId) throw new Error("The source changed while adopting the Chat result");
    this.version = latest; this.sources = new Map(files.map(file => [file.path, file.data])); this.syncFiles();
    return json(200, { revision: latest.revision, snapshotRef: latest.snapshotRef, fence: latest.fence });
  }
  private async commentResult(id: string, body: Uint8Array) {
    const { digest } = z.object({ digest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict().parse(JSON.parse(Buffer.from(body).toString("utf8")));
    const documents = designDocuments(), operation = documents.store.operation(requestKey(this.version.authority, id)), input = operation?.sourceEdit?.input;
    const unchanged = this.noEffects.get(id);
    if (unchanged) {
      if (unchanged.commentsDigest !== digest) throw new Error("Original unchanged comment save has different bytes");
      return json(200, { ...JSON.parse(Buffer.from(unchanged.reply.body).toString("utf8")), comments: readNativeComments([...this.sources].map(([path, data]) => ({ path, data }))) });
    }
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
    if (route === "__deck/publish" && committed.manifest.system) this.acknowledgeSystemSerialization(body);
    const common = this.savedMetadata(committed, receipt.requestId);
    if (route === "__deck/assets") { const id = designDigest(body).slice(7, 39); return json(200, { ...common, id, url: `/_blob/${id}`, sizeBytes: body.length, ...(mime ? { contentType: mime } : {}) }); }
    return json(200, route === "__deck/comment-result" ? { ...common, comments: readNativeComments(files) } : common);
  }
  private savedMetadata(version: DesignRevision, requestId: string) {
    return { version: version.readSetDigest, revision: version.revision, fence: version.fence, requestId,
      shas: Object.fromEntries([...this.editorSources].map(([path, data]) => ["project/" + path, designDigest(data).slice(7)])) };
  }
  private acknowledgeSystemSerialization(body: Uint8Array) {
    // Derived editor bytes are disposable acknowledgements, never a second saved source.
    const batch = batchSchema.parse(JSON.parse(Buffer.from(body).toString("utf8"))).files;
    for (const [key, value] of Object.entries(batch)) {
      const path = key.slice(8);
      if (value && "base64" in value && (this.editorSources.has(path) || /^(?:api\/|manifest\.json$)/.test(path))) {
        const bytes = Buffer.from(value.base64, "base64"), canonicalDigest = this.editorSerializations.get(path)?.canonicalDigest ?? designDigest(this.editorSources.get(path) ?? "");
        this.editorSerializations.set(path, { canonicalDigest, bytes }); this.editorSources.set(path, bytes);
      } else if (value === null || value && "delete" in value) { this.editorSources.delete(path); this.editorSerializations.delete(path); }
    }
    for (const path of this.files.keys()) if (path.startsWith("editor/project/")) this.files.delete(path);
    for (const [path, data] of this.editorSources) this.files.set("editor/project/" + path, data);
  }

}
