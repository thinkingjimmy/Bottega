/**
 * [INPUT]: Authorized immutable snapshots, native source sessions, exact caller windows/generation, trusted editor form events with blocked navigation, prepared design HTML and existing loopback origin factory.
 * [OUTPUT]: Revalidates prepared-preview metadata without rereading source bytes, admits only closed theme/native-locale navigation, pins generation/window lifetime and budgets unique backing stores with bounded release diagnostics and exact-view native download saving and pending-nonce remote final-save admission.
 * [POS]: Artifact HTTP boundary; never resolves request paths against a workspace or filesystem root.
 */
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { NativeEditorSession, NativeEditorOptions } from "./native/session";
import type { DesignRevision } from "../../design/documents/store";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { unpackArtifactArchive } from "@ai-chat/cloud-protocol/artifacts/archive";
import { ARTIFACT_FRAGMENT_CSP, artifactDirectoryCsp } from "@ai-chat/cloud-protocol/artifacts/frame-security";
import type { ArtifactRef, ArtifactLease } from "../../../../shared/ipc/apps/artifact-ipc";
import { artifactMime } from "../admission/files";
import type { ArtifactService } from "../core/service";
import { assertArtifactAdmission, artifactGeneration, artifactEnabled } from "../admission/state";
import { designFramePolicy } from "@ai-chat/cloud-protocol/artifacts/design/frame";
type Lease = { lease: ArtifactLease; ref: ArtifactRef; windowId: number; source: { record: Awaited<ReturnType<ArtifactService["resolve"]>>["record"]; data?: Uint8Array };
  files: Map<string, Uint8Array>; entry: string; generation?: string; prepared?: boolean; nativeRuntime?: "canvas-dc/v3" | "slides/v4" | "dashboard/v1"; native?: NativeEditorSession; finalFlush?: (nonce: string) => void };
export class ArtifactGateway {
  private readonly leases = new Map<string, Lease>();
  private readonly lifetimes = new Map<number, number>();
  private epoch = 0;
  private released = { caller: 0, window: 0, expired: 0, revoked: 0, invalid: 0 };
  private remove(id: string, reason: keyof ArtifactGateway["released"]) { const native = this.leases.get(id)?.native; if (this.leases.delete(id)) { native?.close(); this.released[reason]++; } }
  private origin: ((id: string) => string) | null = null;
  constructor(private readonly service: ArtifactService) {}
  configure(origin: (id: string) => string) { this.origin = origin; }
  revokeAll() { this.epoch++; for (const id of this.leases.keys()) this.remove(id, "revoked"); }
  private lifetime(windowId: number) {
    const life = this.lifetimes.get(windowId), epoch = this.epoch, generation = artifactGeneration();
    return () => { if (this.lifetimes.get(windowId) !== life || this.epoch !== epoch || artifactGeneration() !== generation) throw new Error("Artifact view expired"); };
  }
  guard(windowId: number) {
    const lifetime = this.lifetime(windowId); return () => { assertArtifactAdmission(); lifetime(); };
  }
  private retainedBytes(extra?: Lease) {
    const stores = new Set<ArrayBufferLike>(); let bytes = 0;
    for (const lease of [...this.leases.values(), ...(extra ? [extra] : [])]) for (const data of [...lease.files.values(), ...(lease.source.data ? [lease.source.data] : [])]) {
      if (stores.has(data.buffer)) continue; stores.add(data.buffer); bytes += data.buffer.byteLength;
    }
    return bytes;
  }
  private admit(candidate: Lease) {
    if (this.leases.size >= 8 || this.retainedBytes(candidate) > 256 * 1024 * 1024) throw new Error("artifact-lease-budget");
    this.leases.set(candidate.lease.id, candidate);
  }
  facts() { this.purge(); return { count: this.leases.size, released: { ...this.released }, bytes: this.retainedBytes(), leases: [...this.leases.values()].map(value => ({ id: value.lease.id,
    windowId: value.windowId, chatId: value.ref.chatId, artifactId: value.ref.artifactId, generation: value.generation,
    archiveBytes: value.source.data?.byteLength ?? 0, fileBytes: [...value.files.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0), prepared: Boolean(value.prepared) })) }; }
  async issuePrepared(ref: ArtifactRef, windowId: number, id: string, html: string, nativeRuntime?: "canvas-dc/v3" | "slides/v4" | "dashboard/v1") {
    assertArtifactAdmission(); this.purge();
    const generation = artifactGeneration(), check = this.guard(windowId);
    if (!this.origin || this.leases.size >= 8) throw new Error("artifact-lease-budget");
    const record = await this.service.metadata(ref), bytes = new TextEncoder().encode(html);
    check(); this.service.assert(ref);
    if (nativeRuntime && record.fence.design?.contentFormat !== nativeRuntime && record.fence.design?.format !== "bottega-design-system") throw new Error("Prepared native runtime requires its verified source format");
    if (generation !== artifactGeneration()) throw new Error("Artifact generation expired");
    const origin = this.origin("art-" + id), entry = "board.html";
    const lease: ArtifactLease = { id, origin, expiresAt: Date.now() + 30 * 60_000, url: `${origin}/_artifact/${id}/${entry}`, sandbox: "allow-scripts" };
    this.admit({ lease, ref, windowId, source: { record }, files: new Map([[entry, bytes]]), entry, generation, prepared: true, nativeRuntime });
    return lease;
  }
  async issueNative(input: WorkspaceCommand, windowId: number, snapshot: { version: DesignRevision; files: { path: string; data: Uint8Array }[]; editable: boolean }, options?: NativeEditorOptions) {
    assertArtifactAdmission(); this.purge();
    if (!this.origin || this.leases.size >= 8) throw new Error("artifact-lease-budget");
    const guard = this.guard(windowId), lifetime = this.lifetime(windowId), generation = artifactGeneration(), id = randomUUID(); let issued = false;
    const check = () => { guard(); if (issued && (!this.leases.has(id) || this.leases.get(id)!.lease.expiresAt <= Date.now())) throw new Error("Native editor lease expired"); };
    const { NativeEditorSession } = await import("./native/session");
    const { artifactWorkspace } = await import("../workspace/runtime");
    const checkpoints = artifactWorkspace().checkpoints;
    const finalFlush = (nonce: string) => {
      lifetime();
      if (!artifactEnabled() || !input.viewId || !input.documentId || !checkpoints.allowsFinalFlush(windowId, nonce, input.viewId, checkpoints.key(input.chatId, input.incarnationId, input.documentId)) ||
        issued && (!this.leases.has(id) || this.leases.get(id)!.lease.expiresAt <= Date.now())) throw new Error("Native final save admission expired");
    };
    const native = await NativeEditorSession.create(input, snapshot, check, finalFlush, windowId, options); check();
    const ref = { chatId: input.chatId, incarnationId: input.incarnationId, artifactId: input.artifactId! };
    const record = await this.service.metadata(ref); check();
    const origin = this.origin("art-" + id), entry = "editor/index.html";
    const lease: ArtifactLease = { id, origin, expiresAt: Date.now() + 30 * 60_000, url: `${origin}/_artifact/${id}/${entry}`, sandbox: "allow-scripts allow-same-origin allow-forms" };
    this.admit({ lease, ref, windowId, source: { record }, files: native.files, entry, generation, native, finalFlush }); issued = true;
    return { ...lease, nativeToken: native.token };
  }
  nativeSession(id: string, windowId: number, nonce?: string) {
    const entry = this.leases.get(id);
    if (!entry?.native || entry.windowId !== windowId || !this.allowsDocument(entry.lease.url, windowId)) throw new Error("Native editor lease expired");
    if (nonce) { if (!entry.finalFlush) throw new Error("Native final save is unavailable"); entry.finalFlush(nonce); }
    else this.guard(windowId)();
    return entry.native;
  }
  async saveNativeDownload(input: WorkspaceCommand, windowId: number, save: (result: { data: string; filename: string; [key: string]: unknown }, guard: () => void) => Promise<unknown>) {
    const entry = this.leases.get(input.nonce!);
    if (!entry?.native || entry.windowId !== windowId || entry.ref.chatId !== input.chatId || entry.ref.incarnationId !== input.incarnationId || entry.ref.artifactId !== input.artifactId)
      throw new Error("Native download belongs to another view");
    const guard = () => { if (!this.allowsDocument(entry.lease.url, windowId)) throw new Error("Native download view expired"); assertArtifactAdmission(); };
    guard(); return entry.native.downloads.save(input, result => save(result, guard));
  }
  private purge() { for (const [id, value] of this.leases) if (value.lease.expiresAt <= Date.now()) this.remove(id, "expired"); }
  async issue(ref: ArtifactRef, windowId: number) {
    assertArtifactAdmission();
    this.purge();
    if (!this.origin || this.leases.size >= 8) throw new Error("artifact-lease-budget");
    const check = this.guard(windowId), generation = artifactGeneration();
    const source = await this.service.resolve(ref);
    check(); this.service.assert(ref);
    const id = randomUUID(), origin = this.origin("art-" + id), fence = source.record.fence;
    const entry = fence.kind === "static-site" ? fence.entry! : "snapshot" + (({ "html-fragment": ".html", "html-document": ".html", svg: ".svg", markdown: ".md", pdf: ".pdf" } as Record<string, string>)[fence.kind] ?? "");
    const lease: ArtifactLease = { id, origin, expiresAt: Date.now() + 30 * 60_000,
      url: `${origin}/_artifact/${id}/${entry}`, sandbox: fence.kind === "static-site" ? "allow-scripts allow-same-origin" : "allow-scripts" };
    const files = new Map(fence.kind === "static-site" ? unpackArtifactArchive(source.data).map(file => [file.path, file.data]) : [[entry, source.data]]);
    if (!files.has(entry)) throw new Error("artifact-entry-missing");
    this.admit({ lease, ref, source, files, entry, windowId, generation }); return lease;
  }
  release(id: string, windowId: number) { if (this.leases.get(id)?.windowId === windowId) this.remove(id, "caller"); }
  releaseWindow(windowId: number) { this.lifetimes.set(windowId, (this.lifetimes.get(windowId) ?? 0) + 1); for (const [id, value] of this.leases) if (value.windowId === windowId) this.remove(id, "window"); }
  allowsDocument(value: string, windowId?: number) {
    try {
      const url = new URL(value), id = url.pathname.split("/")[2], lease = id ? this.leases.get(id) : null;
      if (!lease || (windowId !== undefined && lease.windowId !== windowId) || lease.lease.expiresAt <= Date.now()) return false;
      if (lease.generation && lease.generation !== artifactGeneration()) return false;
      this.service.assert(lease.ref);
      return url.origin === lease.lease.origin && url.pathname === new URL(lease.lease.url).pathname &&
        [...url.searchParams].every(([key, value]) => key === "theme" && ["light", "dark"].includes(value) || key === "lang" && Boolean(lease.native) && ["en", "zh-CN", "ja", "es", "fr"].includes(value));
    } catch { return false; }
  }
  ownsOrigin(value: string) { try { const origin = new URL(value).origin; return [...this.leases.values()].some(value => value.lease.origin === origin); } catch { return false; } }
  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    if (!/^art-[a-f0-9-]+\.localhost:\d+$/.test(request.headers.host ?? "")) return false;
    this.purge();
    const deny = (status: number) => { response.writeHead(status, { "Cache-Control": "no-store" }); response.end(); return true; };
    let url: URL, path: string;
    try { url = new URL(request.url ?? "/", "http://" + request.headers.host); path = decodeURIComponent(url.pathname); } catch { return deny(400); }
    const [, prefix, requestedId, ...segments] = path.split("/");
    const alias = prefix !== "_artifact" ? [...this.leases.values()].find(value => value.native && value.lease.origin === url.origin) : undefined;
    const id = alias?.lease.id ?? requestedId, lease = alias ?? (id ? this.leases.get(id) : undefined);
    if (!lease || url.origin !== lease.lease.origin || path.includes("\\") || segments.some(value => !value || value === "." || value === "..") || (!alias && prefix !== "_artifact")) return deny(404);
    try { await this.service.validate(lease.ref); } catch { this.remove(id!, "invalid"); return deny(410); }
    const valid = () => this.leases.get(id!) === lease && lease.lease.expiresAt > Date.now() && lease.generation === artifactGeneration();
    if (!valid()) return deny(410);
    const filename = alias ? "editor" + path : segments.join("/");
    if (lease.native) {
      const reply = await lease.native.handle(request, alias ? path : filename, lease.lease.origin);
      if (reply) {
        if (!valid()) return deny(410);
        response.writeHead(reply.status, { "Content-Type": reply.mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
        response.end(request.method === "HEAD" ? undefined : reply.body); return true;
      }
    }
    if (!["GET", "HEAD"].includes(request.method ?? "")) return deny(405);
    const bytes = lease.files.get(filename);
    if (!bytes) return deny(404);
    const fence = lease.source.record.fence, directory = fence.kind === "static-site";
    let body = bytes, mime = directory || lease.native ? artifactMime(filename) : fence.mime!;
    if (lease.native) mime = lease.native.mime(filename);
    const csp = lease.native ? "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'self' 'unsafe-inline' data: blob:; img-src 'self' data: blob:; font-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' data: blob:; frame-src 'self' data: blob:; worker-src 'self' blob:; form-action 'none'; base-uri 'self'" : lease.prepared ? designFramePolicy(lease.nativeRuntime === "canvas-dc/v3" || lease.nativeRuntime === "slides/v4") : directory ? artifactDirectoryCsp(lease.lease.origin) : ARTIFACT_FRAGMENT_CSP;
    const shell = !lease.native && !lease.prepared && (mime === "text/html" || fence.kind === "svg");
    if (lease.prepared) mime = "text/html";
    if (shell) {
      /* Loaded on the first shell response, not with main's startup bundle (~60 KB of vendored viewer assets). */
      const { artifactViewerShell } = await import("@ai-chat/cloud-protocol/artifacts/viewer-shell");
      body = new TextEncoder().encode(artifactViewerShell({ html: new TextDecoder().decode(bytes), title: fence.title,
        document: directory || fence.kind === "html-document", directoryOrigin: directory ? lease.lease.origin : undefined,
        theme: url.searchParams.get("theme") === "dark" ? "dark" : "light" }));
      mime = "text/html";
    }
    /* Lease IDs are per-lease UUIDs over immutable snapshot bytes, so only the generated shells must stay uncached. */
    if (!valid()) return deny(410);
    const headers: Record<string, string> = { "Content-Type": mime + (mime.startsWith("text/") ? "; charset=utf-8" : ""),
      "Cache-Control": !lease.native && directory && !shell ? "private, max-age=1800, immutable" : "no-store",
      "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes",
      "Content-Security-Policy": csp + (fence.kind === "pdf" ? "" : "; sandbox " + lease.lease.sandbox),
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), payment=()" };
    const origin = request.headers.origin;
    if (!lease.native && (origin === "null" || (origin && /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin)))) headers["Access-Control-Allow-Origin"] = origin;
    if (lease.native && request.headers.origin === "null" && ["editor/project/", "editor/_blob/", "editor/artifact-type/"].some(prefix => filename.startsWith(prefix)))
      headers["Access-Control-Allow-Origin"] = "null";
    let status = 200;
    if (request.headers.range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
      if (!match) return deny(416);
      const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= body.length) return deny(416);
      headers["Content-Range"] = `bytes ${start}-${end}/${body.length}`; body = body.subarray(start, end + 1); status = 206;
    }
    headers["Content-Length"] = String(body.length); response.writeHead(status, headers); response.end(request.method === "HEAD" ? undefined : body); return true;
  }
}
