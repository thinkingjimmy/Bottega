/**
 * [INPUT]: Depends on generation/surface-bound Base GUI bindings, the custody-aware workspace port, Node HTTP streams, crypto, and strict shared workspace contracts
 * [OUTPUT]: Provides compiled-v3 POST-only opaque file/version/cursor/preview refs with per-binding ref quotas, digest-required listings, revision re-verified preview serving, and cross-origin iframe-only preview documents without exposing paths, tokens, URLs, or source
 * [POS]: The compiled workspace-read-v1 adapter; legacy path-shaped routes remain isolated in workspace-preview.ts
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { BaseGuiLiveBinding } from "../../../../shared/apps-ipc";
import type { WorkspacePreviewPort } from "./workspace-preview";

const TOKEN_TTL_MS = 5 * 60_000;
const TOKEN_LIMIT = 2_048;
const BINDING_TOKEN_LIMIT = 256;
const PAGE_LIMIT = 100;
const RESPONSE_LIMIT = 256 * 1024;
const BODY_LIMIT = 64 * 1024;
const HTML_LIMIT = 8 * 1024 * 1024;

const pageOptions = {
  limit: z.number().int().min(1).max(PAGE_LIMIT).optional(),
  cursor: z.string().uuid().optional(),
  critical: z.boolean().optional(),
};
const filesSchema = z.object(pageOptions).strict();
const versionsSchema = z.object({
  fileRef: z.string().uuid(),
  ...pageOptions,
}).strict();
const sourceLineSchema = z.object({
  fileRef: z.string().uuid(),
  htmlHint: z.string().min(3).max(180),
  critical: z.boolean().optional(),
}).strict();
const previewSchema = z.object({
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("live"), fileRef: z.string().uuid() }).strict(),
    z.object({ kind: z.literal("version"), versionRef: z.string().uuid() }).strict(),
  ]),
  critical: z.boolean().optional(),
}).strict();

type RefEntry = Readonly<{
  binding: BaseGuiLiveBinding;
  bindingKey: string;
  expiresAt: number;
}> & (
  | Readonly<{ kind: "file"; path: string; digest: string; revision: number }>
  | Readonly<{
      kind: "version";
      path: string;
      versionId: string;
      digest: string;
      revision: number;
    }>
  | Readonly<{
      kind: "cursor";
      operation: "files" | "versions";
      offset: number;
      revision: number;
      path: string | null;
    }>
  | Readonly<{
      kind: "preview";
      revision: number;
      target:
        | Readonly<{ kind: "live"; path: string }>
        | Readonly<{ kind: "version"; versionId: string }>;
    }>
);

export class CompiledWorkspaceFacade {
  private readonly refs = new Map<string, RefEntry>();

  constructor(private readonly port: WorkspacePreviewPort) {}

  async api(
    context: Readonly<{ appId: string; binding: BaseGuiLiveBinding }>,
    pathname: string,
    request: IncomingMessage,
    response: ServerResponse
  ) {
    if (request.method !== "POST") return failure(response, 405, "method_not_allowed");
    try {
      const body = await readJson(request);
      const result = pathname === "/_api/workspace/files"
        ? await this.files(context.binding, filesSchema.parse(body))
        : pathname === "/_api/workspace/versions"
          ? await this.versions(context.binding, versionsSchema.parse(body))
          : pathname === "/_api/workspace/source-line"
            ? await this.sourceLine(context.binding, sourceLineSchema.parse(body))
            : pathname === "/_api/workspace/preview"
              ? await this.preview(context.binding, previewSchema.parse(body))
              : null;
      if (result === null) return failure(response, 404, "workspace_route_not_found");
      respondJson(response, result);
    } catch (cause) {
      const status = statusOf(cause);
      failure(response, status, codeOf(cause, status));
    }
  }

  resolveOpaqueOrigin(appId: string, handle: string) {
    const entry = this.resolve(handle, "preview");
    return entry?.binding.appId === appId
      ? structuredClone(entry.binding)
      : null;
  }

  async serveOpaqueOrigin(
    appId: string,
    handle: string,
    request: IncomingMessage,
    response: ServerResponse
  ) {
    const entry = this.resolve(handle, "preview");
    if (!entry || entry.binding.appId !== appId) return failure(response, 404, "workspace_stale_ref");
    const pathname = new URL(request.url ?? "/", "http://preview.local").pathname;
    if (!["/", "/index.html"].includes(pathname)) return failure(response, 404, "preview_not_found");
    if (request.method !== "GET" && request.method !== "HEAD") {
      return failure(response, 405, "method_not_allowed");
    }
    if (request.headers["sec-fetch-dest"] !== "iframe") {
      return failure(response, 403, "preview_navigation_required");
    }
    try {
      /* handle 的 5 分钟 TTL 不是 revision 凭据：不重新验证就服务，等于用
         今天的注册表去解释昨天的引用——旧 ref 必须失败，绝不许被重新解读。
         这与 versions / sourceLine / preview 用的是同一条判等。 */
      const listing = await this.port.list(entry.binding);
      if (listing.revision !== entry.revision) return failure(response, 410, "workspace_changed");
      const body = entry.target.kind === "live"
        ? await this.port.read(entry.binding, entry.target.path)
        : (await this.port.readVersion(entry.binding, entry.target.versionId)).content;
      if (body === null) return failure(response, 404, "workspace_not_found");
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
      if (bytes.byteLength > HTML_LIMIT) return failure(response, 413, "workspace_file_too_large");
      const html = injectPreviewBridge(bytes.toString("utf8"), handle);
      previewHeaders(response, entry.binding, request);
      response.statusCode = 200;
      response.setHeader("content-length", String(Buffer.byteLength(html)));
      response.end(request.method === "HEAD" ? undefined : html);
    } catch (cause) {
      const status = statusOf(cause);
      failure(response, status, codeOf(cause, status));
    }
  }

  /* 编译版只认带 digest 的 canvases。opaque ref 的身份就是 digest：没有它
     就无法在不泄漏路径的前提下证明「你拿到的还是那一份」。真实 port
     （design/workspace-access.listResolved）随每次 listing 一并给出 digest，
     所以这里不再有「按请求整文件 sha256」的兜底分支。 */
  private async files(binding: BaseGuiLiveBinding, input: z.infer<typeof filesSchema>) {
    const listing = await this.port.list(binding);
    if (!listing.canvases) throw tagged(503, "workspace_unavailable");
    const offset = this.cursorOffset(binding, input.cursor, "files", listing.revision, null);
    const candidates = [...listing.canvases]
      .sort((left, right) => compareText(left.file, right.file));
    const limit = input.limit ?? 50;
    const page = candidates.slice(offset, offset + limit);
    const items = page.map((item) => ({
      fileRef: this.issue(binding, {
        kind: "file",
        path: item.file,
        digest: item.digest,
        revision: listing.revision,
      }),
      displayName: displayName(item.file),
      digest: item.digest,
      advisories: item.advisories,
    }));
    return bounded({
      workspaceRevision: listing.revision,
      items,
      nextCursor: offset + page.length < candidates.length
        ? this.issue(binding, {
            kind: "cursor",
            operation: "files",
            offset: offset + page.length,
            revision: listing.revision,
            path: null,
          })
        : null,
    });
  }

  private async versions(
    binding: BaseGuiLiveBinding,
    input: z.infer<typeof versionsSchema>
  ) {
    const file = this.requireRef(binding, input.fileRef, "file");
    const listing = await this.port.list(binding);
    if (listing.revision !== file.revision) throw tagged(409, "workspace_changed");
    const offset = this.cursorOffset(
      binding,
      input.cursor,
      "versions",
      listing.revision,
      file.path
    );
    const versions = [...await this.port.listVersions(binding, file.path)]
      .sort((left, right) => left.createdAt - right.createdAt || compareText(left.versionId, right.versionId));
    const limit = input.limit ?? 50;
    const page = versions.slice(offset, offset + limit);
    const items = page.map((version) => ({
      versionRef: this.issue(binding, {
        kind: "version",
        path: file.path,
        versionId: version.versionId,
        digest: version.digest,
        revision: listing.revision,
      }),
      digest: version.digest,
      source: version.source,
      parentVersionRef: version.parentVersion
        ? this.issue(binding, {
            kind: "version",
            path: file.path,
            versionId: version.parentVersion,
            digest: version.digest,
            revision: listing.revision,
          })
        : null,
      createdAt: version.createdAt,
    }));
    return bounded({
      workspaceRevision: listing.revision,
      items,
      nextCursor: offset + page.length < versions.length
        ? this.issue(binding, {
            kind: "cursor",
            operation: "versions",
            offset: offset + page.length,
            revision: listing.revision,
            path: file.path,
          })
        : null,
    });
  }

  private async sourceLine(
    binding: BaseGuiLiveBinding,
    input: z.infer<typeof sourceLineSchema>
  ) {
    const file = this.requireRef(binding, input.fileRef, "file");
    const listing = await this.port.list(binding);
    if (listing.revision !== file.revision) throw tagged(409, "workspace_changed");
    const body = await this.port.read(binding, file.path);
    if (body === null) throw tagged(404, "workspace_not_found");
    const source = Buffer.isBuffer(body) ? body.toString("utf8") : body;
    const matches = matchingOpeningTags(source, input.htmlHint);
    return { sourceLine: matches.length === 1
      ? source.slice(0, matches[0]).split("\n").length
      : null };
  }

  private async preview(
    binding: BaseGuiLiveBinding,
    input: z.infer<typeof previewSchema>
  ) {
    const target = input.target.kind === "live"
      ? this.requireRef(binding, input.target.fileRef, "file")
      : this.requireRef(binding, input.target.versionRef, "version");
    const listing = await this.port.list(binding);
    if (listing.revision !== target.revision) throw tagged(409, "workspace_changed");
    const handle = this.issue(binding, {
      kind: "preview",
      revision: listing.revision,
      target: target.kind === "file"
        ? { kind: "live", path: target.path }
        : { kind: "version", versionId: target.versionId },
    });
    return { handle, workspaceRevision: listing.revision };
  }

  private cursorOffset(
    binding: BaseGuiLiveBinding,
    cursor: string | undefined,
    operation: "files" | "versions",
    revision: number,
    path: string | null
  ) {
    if (!cursor) return 0;
    const ref = this.requireRef(binding, cursor, "cursor");
    if (
      ref.operation !== operation ||
      ref.revision !== revision ||
      ref.path !== path
    ) throw tagged(409, "workspace_cursor_invalid");
    return ref.offset;
  }

  private requireRef<K extends RefEntry["kind"]>(
    binding: BaseGuiLiveBinding,
    token: string,
    kind: K
  ): Extract<RefEntry, { kind: K }> {
    const ref = this.resolve(token, kind);
    if (!ref || ref.bindingKey !== bindingKey(binding)) throw tagged(410, "workspace_stale_ref");
    return ref;
  }

  private resolve<K extends RefEntry["kind"]>(token: string, kind: K) {
    this.prune();
    const entry = this.refs.get(token);
    return entry?.kind === kind
      ? entry as Extract<RefEntry, { kind: K }>
      : null;
  }

  private issue(binding: BaseGuiLiveBinding, value: Omit<RefEntry, keyof RefEntry>) {
    this.prune();
    const token = randomUUID();
    const key = bindingKey(binding);
    this.refs.set(token, {
      ...value,
      binding: structuredClone(binding),
      bindingKey: key,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    } as RefEntry);
    /* 先按 binding 配额淘汰，再收全局上限：只有全局 FIFO 时，一个 App 一路
       翻页就能把别的 App 仍在用的 ref 挤掉——回收压力必须留在制造它的人身上。 */
    this.evict((entry) => entry.bindingKey === key, BINDING_TOKEN_LIMIT);
    this.evict(() => true, TOKEN_LIMIT);
    return token;
  }

  private evict(match: (entry: RefEntry) => boolean, limit: number) {
    const owned = [...this.refs].filter(([, entry]) => match(entry));
    for (const [token] of owned.slice(0, Math.max(0, owned.length - limit))) {
      this.refs.delete(token);
    }
  }

  private prune() {
    const now = Date.now();
    for (const [token, entry] of this.refs) {
      if (entry.expiresAt <= now) this.refs.delete(token);
    }
  }

}

function bindingKey(binding: BaseGuiLiveBinding) {
  return JSON.stringify([
    binding.appId,
    binding.generationId,
    binding.contentDigest,
    binding.lifecycleRevision,
    binding.surfaceId,
    binding.appSurfaceLeaseId,
    binding.capabilityDecisionId,
    binding.capabilityRevision,
    binding.workspaceReadScope,
  ]);
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > BODY_LIMIT) throw tagged(413, "workspace_request_too_large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw tagged(400, "workspace_invalid_request");
  }
}

function bounded<T>(value: T) {
  if (Buffer.byteLength(JSON.stringify(value)) > RESPONSE_LIMIT) {
    throw tagged(413, "workspace_response_too_large");
  }
  return value;
}

function displayName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1).slice(0, 200);
}

function compareText(left: string, right: string) {
  return Buffer.compare(Buffer.from(left.normalize("NFC")), Buffer.from(right.normalize("NFC")));
}

function matchingOpeningTags(source: string, hint: string) {
  const exact = source.indexOf(hint);
  if (exact >= 0) return source.indexOf(hint, exact + hint.length) < 0
    ? [exact]
    : [exact, exact];
  const tag = /^<([a-z][a-z0-9:-]*)\b/i.exec(hint)?.[1];
  if (!tag) return [];
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...source.matchAll(new RegExp(`<${escaped}(?:\\s[^<>]*?)?>`, "gi"))]
    .map((match) => match.index);
}

function injectPreviewBridge(html: string, handle: string) {
  const script = `<script>(()=>{const handle=${JSON.stringify(handle)};const mode=new URLSearchParams(location.search).get("mode")||"browse";let last=0;let start=null;const clamp=(v,n)=>String(v||"").trim().slice(0,n);const send=selection=>{const now=performance.now();if(now-last<50)return;last=now;parent.postMessage({channel:"bottega:workspace-selection",handle,selection},"*")};const stop=event=>{event.preventDefault();event.stopPropagation()};const selector=node=>node.id?"#"+CSS.escape(node.id):node.tagName.toLowerCase();addEventListener("click",event=>{if(mode!=="element"||!(event.target instanceof Element))return;stop(event);const node=event.target;send({kind:"element",selector:clamp(selector(node),512),tagName:clamp(node.tagName.toLowerCase(),64),htmlHint:clamp((node.outerHTML.match(/^<[^>]+>/)||[""])[0],180),sourceLine:null})},true);addEventListener("pointerdown",event=>{if(mode!=="region"||event.button!==0)return;stop(event);start={x:Math.round(event.clientX),y:Math.round(event.clientY)}},true);addEventListener("pointerup",event=>{if(mode!=="region"||!start)return;stop(event);const end={x:Math.round(event.clientX),y:Math.round(event.clientY)};send({kind:"region",rect:{x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.max(1,Math.abs(end.x-start.x)),height:Math.max(1,Math.abs(end.y-start.y))}});start=null},true);requestAnimationFrame(()=>parent.postMessage({channel:"bottega:workspace-preview-ready",handle},"*"))})();</script>`;
  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${script}`)
    : `${script}${html}`;
}

function previewHeaders(
  response: ServerResponse,
  binding: BaseGuiLiveBinding,
  request: IncomingMessage
) {
  const ancestor = previewAncestor(binding, request.headers.referer);
  response.setHeader(
    "content-security-policy",
    `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-ancestors ${ancestor}; base-uri 'none'; form-action 'none'`
  );
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
}

function previewAncestor(binding: BaseGuiLiveBinding, referer: string | undefined) {
  const fallback = `http://${binding.surfaceId}.${binding.appId}.localhost:*`;
  try {
    const parsed = new URL(referer ?? "");
    const expectedHost = `${binding.surfaceId}.${binding.appId}.localhost`;
    return parsed.protocol === "http:" && parsed.hostname === expectedHost
      ? parsed.origin
      : fallback;
  } catch {
    return fallback;
  }
}

function respondJson(response: ServerResponse, body: unknown) {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(JSON.stringify(body));
}

function failure(response: ServerResponse, status: number, code: string) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(JSON.stringify({ error: { code, message: code } }));
}

function tagged(status: number, code: string) {
  return Object.assign(new Error(code), { status, code });
}

function statusOf(cause: unknown) {
  const status = Number((cause as { status?: unknown } | null)?.status);
  if ([400, 401, 403, 404, 405, 409, 410, 413, 415, 503].includes(status)) return status;
  return cause instanceof z.ZodError ? 400 : 500;
}

function codeOf(cause: unknown, status: number) {
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : status === 400
    ? "workspace_invalid_request"
    : "workspace_read_failed";
}
