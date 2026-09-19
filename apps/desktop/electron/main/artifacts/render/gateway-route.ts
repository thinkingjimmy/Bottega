/**
 * [INPUT]: Authorized immutable snapshots, exact caller window IDs and the existing loopback gateway origin factory.
 * [OUTPUT]: Revocable per-artifact origins, read-only resource serving, CSP and bounded Range responses.
 * [POS]: Artifact HTTP boundary; never resolves request paths against a workspace or filesystem root.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { unpackArtifactArchive } from "@ai-chat/cloud-protocol/artifacts/archive";
import { artifactViewerShell, ARTIFACT_FRAGMENT_CSP, artifactDirectoryCsp } from "@ai-chat/cloud-protocol/artifacts/viewer-shell";
import type { ArtifactRef, ArtifactLease } from "../../../../shared/artifact-ipc";
import { artifactMime } from "../admission";
import type { ArtifactService } from "../service";
type Lease = { lease: ArtifactLease; ref: ArtifactRef; windowId: number; source: Awaited<ReturnType<ArtifactService["resolve"]>>;
  files: Map<string, Uint8Array>; entry: string };
export class ArtifactGateway {
  private readonly leases = new Map<string, Lease>();
  private origin: ((id: string) => string) | null = null;
  constructor(private readonly service: ArtifactService) {}
  configure(origin: (id: string) => string) { this.origin = origin; }
  private purge() { for (const [id, value] of this.leases) if (value.lease.expiresAt <= Date.now()) this.leases.delete(id); }
  async issue(ref: ArtifactRef, windowId: number) {
    this.purge();
    if (!this.origin || this.leases.size >= 8) throw new Error("artifact-lease-budget");
    const source = await this.service.resolve(ref);
    this.service.assert(ref);
    const retained = [...this.leases.values()].reduce((total, value) => total + value.source.data.length, 0);
    if (this.leases.size >= 8 || retained + source.data.length > 256 * 1024 * 1024) throw new Error("artifact-lease-budget");
    const id = randomUUID(), origin = this.origin("art-" + id), fence = source.record.fence;
    const entry = fence.kind === "static-site" ? fence.entry! : "snapshot" + (({ "html-fragment": ".html", "html-document": ".html", svg: ".svg", markdown: ".md", pdf: ".pdf" } as Record<string, string>)[fence.kind] ?? "");
    const lease: ArtifactLease = { id, origin, expiresAt: Date.now() + 30 * 60_000,
      url: `${origin}/_artifact/${id}/${entry}`, sandbox: fence.kind === "static-site" ? "allow-scripts allow-same-origin" : "allow-scripts" };
    const files = new Map(fence.kind === "static-site" ? unpackArtifactArchive(source.data).map(file => [file.path, file.data]) : [[entry, source.data]]);
    if (!files.has(entry)) throw new Error("artifact-entry-missing");
    this.leases.set(id, { lease, ref, source, files, entry, windowId }); return lease;
  }
  release(id: string, windowId: number) { if (this.leases.get(id)?.windowId === windowId) this.leases.delete(id); }
  releaseWindow(windowId: number) { for (const [id, value] of this.leases) if (value.windowId === windowId) this.leases.delete(id); }
  allowsDocument(value: string, windowId?: number) {
    try {
      const url = new URL(value), id = url.pathname.split("/")[2], lease = id ? this.leases.get(id) : null;
      if (!lease || (windowId !== undefined && lease.windowId !== windowId) || lease.lease.expiresAt <= Date.now()) return false;
      this.service.assert(lease.ref);
      return url.origin === lease.lease.origin && url.pathname === new URL(lease.lease.url).pathname &&
        [...url.searchParams].every(([key, value]) => key === "theme" && ["light", "dark"].includes(value));
    } catch { return false; }
  }
  ownsOrigin(value: string) { try { const origin = new URL(value).origin; return [...this.leases.values()].some(value => value.lease.origin === origin); } catch { return false; } }
  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    if (!/^art-[a-f0-9-]+\.localhost:\d+$/.test(request.headers.host ?? "")) return false;
    this.purge();
    const deny = (status: number) => { response.writeHead(status, { "Cache-Control": "no-store" }); response.end(); return true; };
    if (!["GET", "HEAD"].includes(request.method ?? "")) return deny(405);
    let url: URL, path: string;
    try { url = new URL(request.url ?? "/", "http://" + request.headers.host); path = decodeURIComponent(url.pathname); } catch { return deny(400); }
    const [, prefix, id, ...segments] = path.split("/"), lease = id ? this.leases.get(id) : undefined;
    if (prefix !== "_artifact" || !lease || url.origin !== lease.lease.origin || path.includes("\\") || segments.some(value => !value || value === "." || value === "..")) return deny(404);
    try { await this.service.validate(lease.ref); } catch { this.leases.delete(id!); return deny(410); }
    const filename = segments.join("/"), bytes = lease.files.get(filename);
    if (!bytes) return deny(404);
    const fence = lease.source.record.fence, directory = fence.kind === "static-site";
    let body = bytes, mime = directory ? artifactMime(filename) : fence.mime!;
    const csp = directory ? artifactDirectoryCsp(lease.lease.origin) : ARTIFACT_FRAGMENT_CSP;
    const shell = mime === "text/html" || fence.kind === "svg";
    if (shell) {
      body = new TextEncoder().encode(artifactViewerShell({ html: new TextDecoder().decode(bytes), title: fence.title,
        document: directory || fence.kind === "html-document", directoryOrigin: directory ? lease.lease.origin : undefined,
        theme: url.searchParams.get("theme") === "dark" ? "dark" : "light" }));
      mime = "text/html";
    }
    /* Lease IDs are per-lease UUIDs over immutable snapshot bytes, so only the generated shells must stay uncached. */
    const headers: Record<string, string> = { "Content-Type": mime + (mime.startsWith("text/") ? "; charset=utf-8" : ""),
      "Cache-Control": directory && !shell ? "private, max-age=1800, immutable" : "no-store",
      "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes",
      "Content-Security-Policy": csp + (fence.kind === "pdf" ? "" : "; sandbox " + lease.lease.sandbox),
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), payment=()" };
    const origin = request.headers.origin;
    if (origin === "null" || (origin && /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin))) headers["Access-Control-Allow-Origin"] = origin;
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
