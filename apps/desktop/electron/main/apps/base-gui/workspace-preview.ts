/**
 * [INPUT]: Depends on Base GUI surface binding/token claims, Node HTTP streams, a custody-aware Design workspace port, the injected selection bridge, and the shared source-line matcher
 * [OUTPUT]: Provides legacy authenticated workspace path routes and delegates compiled-v3 opaque refs/previews to the isolated compiled facade
 * [POS]: The Base GUI Design workspace-read composition boundary; legacy route parsing lives here, the browser bridge in design-selection-bridge.ts, and compiled trust-domain logic in compiled-workspace.ts
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AppGuiRuntimeErrorCode,
  BaseGuiLiveBinding,
} from "../../../../shared/apps-ipc";
import type { GuiTokenClaims } from "../generation/gui-api";
import { bearerToken, sameGuiBinding } from "./api/router";
import { CompiledWorkspaceFacade } from "./compiled-workspace";
import { DESIGN_SELECTION_BRIDGE } from "./design-selection-bridge";
import { workspaceSourceLine } from "./design-source-line";

const PREVIEW_CSP =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; img-src data:; frame-src 'self'; " +
  "frame-ancestors 'self' file: http://localhost:*; " +
  "base-uri 'none'; form-action 'none'; webrtc 'block'";

type WorkspaceVersion = Readonly<{
  versionId: string;
  canonicalRelativePath: string;
  digest: string;
  source: "ai" | "manual" | "restore";
  parentVersion: string | null;
  restoredFromVersion?: string;
  provenance: Readonly<Record<string, string | undefined>>;
  createdAt: number;
}>;

export type WorkspacePreviewPort = Readonly<{
  list(binding: BaseGuiLiveBinding): Promise<{
    files: readonly string[];
    canvases?: readonly Readonly<{
      file: string;
      digest: string;
      advisories: readonly Readonly<{
        ruleId: string;
        message: string;
        count: number;
      }>[];
    }>[];
    revision: number;
    drafting?: boolean;
  }>;
  read(
    binding: BaseGuiLiveBinding,
    canonicalRelativePath: string
  ): Promise<Buffer | string | null>;
  listVersions(
    binding: BaseGuiLiveBinding,
    canonicalRelativePath: string
  ): Promise<readonly WorkspaceVersion[]>;
  readVersion(binding: BaseGuiLiveBinding, versionId: string): Promise<{
    version: WorkspaceVersion;
    content: Buffer | string;
  }>;
}>;

type TokenVerifier = Readonly<{
  verify(
    appId: string,
    surfaceId: string,
    candidate: string
  ): GuiTokenClaims | null;
}>;

export type WorkspacePreviewHandler = ((
  context: Readonly<{ appId: string; binding: BaseGuiLiveBinding }>,
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse
) => Promise<boolean>) & Readonly<{
  resolveOpaqueOrigin(appId: string, handle: string): BaseGuiLiveBinding | null;
  serveOpaqueOrigin(
    appId: string,
    handle: string,
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void>;
}>;

export function createWorkspacePreviewHandler(
  tokens: TokenVerifier,
  port: WorkspacePreviewPort
): WorkspacePreviewHandler {
  const compiled = new CompiledWorkspaceFacade(port);
  const handler = async (context: Readonly<{
    appId: string;
    binding: BaseGuiLiveBinding;
  }>, pathname: string, request: IncomingMessage, response: ServerResponse) => {
    if (pathname.startsWith("/_api/workspace/")) {
      if (context.binding.contentLayoutVersion === 3) {
        const binding = authenticateWorkspace(tokens, context, request, response);
        if (binding) await compiled.api(context, pathname, request, response);
      } else {
        await workspaceApi(tokens, port, context, pathname, request, response);
      }
      return true;
    }
    if (!pathname.startsWith("/_preview/")) return false;
    if (context.binding.contentLayoutVersion === 3) {
      respond(response, 404, workspaceError("workspace_route_not_found", "Legacy preview is unavailable to compiled Apps"), "application/json");
      return true;
    }
    await previewWorkspaceFile(port, context, pathname, request, response);
    return true;
  };
  return Object.assign(handler, {
    resolveOpaqueOrigin: (appId: string, handle: string) =>
      compiled.resolveOpaqueOrigin(appId, handle),
    serveOpaqueOrigin: (
      appId: string,
      handle: string,
      request: IncomingMessage,
      response: ServerResponse
    ) => compiled.serveOpaqueOrigin(appId, handle, request, response),
  });
}

async function workspaceApi(
  tokens: TokenVerifier,
  port: WorkspacePreviewPort,
  context: Readonly<{ appId: string; binding: BaseGuiLiveBinding }>,
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse
) {
  const binding = authenticateWorkspace(tokens, context, request, response);
  if (!binding) return;
  if (pathname === "/_api/workspace/files") {
    await listWorkspaceFiles(port, binding, request, response);
    return;
  }
  if (pathname === "/_api/workspace/versions") {
    await listWorkspaceVersions(port, binding, request, response);
    return;
  }
  if (pathname === "/_api/workspace/source-line") {
    await resolveWorkspaceSourceLine(port, binding, request, response);
    return;
  }
  respond(response, 404, workspaceError("workspace_route_not_found", "Workspace route not found"), "application/json");
}

function authenticateWorkspace(
  tokens: TokenVerifier,
  context: Readonly<{ appId: string; binding: BaseGuiLiveBinding }>,
  request: IncomingMessage,
  response: ServerResponse
) {
  const { binding } = context;
  const claims = tokens.verify(context.appId, binding.surfaceId, bearerToken(request));
  if (!claims || !sameGuiBinding(claims, binding)) {
    respond(response, 401, workspaceError("invalid_token", "Workspace token is invalid or expired"), "application/json");
    return null;
  }
  if (
    binding.workspaceReadScope !== "design/" ||
    !binding.baseCapabilities.includes("workspace-read")
  ) {
    /* workspace 路由的 403 只有一个名字：workspaceFailureCode(403) 已经把
       下游拒绝映射成 workspace_forbidden，入口这道闸再叫 capability_not_granted，
       同一个「你没有这条 workspace 权限」就按抛出层级分裂成两个 code。 */
    respond(response, 403, workspaceError("workspace_forbidden", "workspace-read capability is not granted"), "application/json");
    return null;
  }
  return binding;
}

async function listWorkspaceFiles(
  port: WorkspacePreviewPort,
  binding: BaseGuiLiveBinding,
  request: IncomingMessage,
  response: ServerResponse
) {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    respond(response, 405, workspaceError("method_not_allowed", "Only GET and HEAD are supported"), "application/json");
    return;
  }
  let listing: Awaited<ReturnType<WorkspacePreviewPort["list"]>>;
  try {
    listing = await port.list(binding);
  } catch (cause) {
    const status = workspaceFailureStatus(cause);
    respond(
      response,
      status,
      workspaceError(workspaceFailureCode(status), workspaceFailureMessage(status)),
      "application/json",
      method === "HEAD"
    );
    return;
  }
  respond(
    response,
    200,
    {
      files: [...listing.files],
      canvases: [...(listing.canvases ?? [])],
      revision: listing.revision,
      drafting: listing.drafting === true,
    },
    "application/json",
    method === "HEAD"
  );
}

async function listWorkspaceVersions(
  port: WorkspacePreviewPort,
  binding: BaseGuiLiveBinding,
  request: IncomingMessage,
  response: ServerResponse
) {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return methodNotAllowed(response, "GET, HEAD");
  await withWorkspaceJson(response, async () => {
    const url = new URL(request.url ?? "/", "http://workspace.local");
    const versions = await port.listVersions(binding, requireDesignFile(url.searchParams.get("file")));
    return { versions: versions.map(publicVersion) };
  }, method === "HEAD");
}

async function resolveWorkspaceSourceLine(
  port: WorkspacePreviewPort,
  binding: BaseGuiLiveBinding,
  request: IncomingMessage,
  response: ServerResponse
) {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return methodNotAllowed(response, "GET, HEAD");
  await withWorkspaceJson(response, async () => {
    const url = new URL(request.url ?? "/", "http://workspace.local");
    const file = requireDesignFile(url.searchParams.get("file"));
    const hint = requireHtmlHint(url.searchParams.get("hint"));
    const content = await port.read(binding, file);
    if (content === null) throw Object.assign(new Error("Canvas not found"), { status: 404 });
    const source = Buffer.isBuffer(content) ? content.toString("utf8") : content;
    return { sourceLine: workspaceSourceLine(source, hint) };
  }, method === "HEAD");
}

async function previewWorkspaceFile(
  port: WorkspacePreviewPort,
  context: Readonly<{ appId: string; binding: BaseGuiLiveBinding }>,
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse
) {
  setPreviewHeaders(response);
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    response.setHeader("allow", "GET, HEAD");
    respond(response, 405, "Preview method not allowed", "text/plain");
    return;
  }
  const live = /^\/_preview\/([a-f0-9-]{36})\/design\/([^?#]+\.html)$/i.exec(pathname);
  const historical = /^\/_preview\/([a-f0-9-]{36})\/versions\/([a-f0-9-]{36})\.html$/i.exec(pathname);
  const leaseId = context.binding.appSurfaceLeaseId;
  const routeLeaseId = live?.[1] ?? historical?.[1];
  if (!routeLeaseId || !leaseId || routeLeaseId !== leaseId) {
    respond(response, 401, "Preview surface mismatch", "text/plain");
    return;
  }
  if (
    context.binding.workspaceReadScope !== "design/" ||
    !context.binding.baseCapabilities.includes("workspace-read")
  ) {
    respond(response, 403, "workspace-read capability not granted", "text/plain");
    return;
  }
  let body: Buffer | string | null;
  try {
    if (historical) {
      body = (await port.readVersion(context.binding, requireUuid(historical[2]))).content;
    } else {
      const relative = live?.[2] ?? "";
      if (!isTraversalSafePath(relative)) {
        respond(response, 400, "Preview path is invalid", "text/plain");
        return;
      }
      body = await port.read(context.binding, `design/${relative}`);
    }
  } catch (cause) {
    const status = workspaceFailureStatus(cause);
    respond(response, status, workspaceFailureMessage(status), "text/plain", method === "HEAD");
    return;
  }
  if (body === null) {
    respond(response, 404, "Preview file not found", "text/plain");
    return;
  }
  const html = Buffer.isBuffer(body) ? body.toString("utf8") : body;
  const rendered = injectSelectionBridge(html);
  response.statusCode = 200;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("content-length", String(Buffer.byteLength(rendered)));
  response.end(method === "HEAD" ? undefined : rendered);
}

function publicVersion(version: WorkspaceVersion) {
  return {
    versionId: version.versionId,
    file: version.canonicalRelativePath,
    digest: version.digest,
    source: version.source,
    parentVersion: version.parentVersion,
    ...(version.restoredFromVersion ? { restoredFromVersion: version.restoredFromVersion } : {}),
    provenance: version.provenance,
    createdAt: version.createdAt,
  };
}

function requireDesignFile(value: unknown) {
  if (typeof value !== "string" || !/^design\/[A-Za-z0-9][A-Za-z0-9._ -]{0,199}\.html$/i.test(value)) {
    throw Object.assign(new Error("Design file path is invalid"), { status: 400 });
  }
  return value;
}

function requireUuid(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) {
    throw Object.assign(new Error("Version identity is invalid"), { status: 400 });
  }
  return value;
}

function requireHtmlHint(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 180 ||
    !value.startsWith("<") ||
    !value.endsWith(">") ||
    value.includes("\0")
  ) {
    throw Object.assign(new Error("HTML source hint is invalid"), { status: 400 });
  }
  return value;
}

async function withWorkspaceJson(
  response: ServerResponse,
  operation: () => Promise<object>,
  head = false
) {
  try {
    respond(response, 200, await operation(), "application/json", head);
  } catch (cause) {
    const status = workspaceFailureStatus(cause);
    respond(
      response,
      status,
      workspaceError(workspaceFailureCode(status), workspaceFailureMessage(status)),
      "application/json",
      head
    );
  }
}

function methodNotAllowed(response: ServerResponse, allow: string) {
  response.setHeader("allow", allow);
  respond(response, 405, workspaceError("method_not_allowed", `Allowed methods: ${allow}`), "application/json");
}

/* 穿越安全检查（非画板命名语法）：拒前导斜杠/反斜杠/空字节/`.`/`..` 段。
   画板身份的 canonical 判定在 registry 的 isCanonicalDesignPath，勿与此混淆。 */
function isTraversalSafePath(value: string) {
  return value.length <= 512 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value.split("/").every((part) => part && part !== "." && part !== "..");
}

function injectSelectionBridge(html: string) {
  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${DESIGN_SELECTION_BRIDGE}`)
    : `${DESIGN_SELECTION_BRIDGE}${html}`;
}

function setPreviewHeaders(response: ServerResponse) {
  response.setHeader("content-security-policy", PREVIEW_CSP);
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
}

function workspaceFailureStatus(cause: unknown) {
  const status = Number((cause as { status?: unknown } | null)?.status);
  return [400, 401, 403, 404, 409, 410, 413, 415, 503].includes(status)
    ? status
    : 500;
}

function workspaceFailureCode(status: number) {
  if (status === 400) return "workspace_invalid_request";
  if (status === 410) return "surface_gone";
  if (status === 401 || status === 403) return "workspace_forbidden";
  if (status === 404) return "workspace_not_found";
  if (status === 413) return "workspace_file_too_large";
  if (status === 415) return "workspace_file_invalid";
  if (status === 503) return "workspace_unavailable";
  return status === 409 ? "workspace_changed" : "workspace_read_failed";
}

function workspaceFailureMessage(status: number) {
  return status === 410
    ? "Preview surface is gone"
    : status === 404
      ? "Preview file not found"
      : status === 409
        ? "Workspace changed during preview"
        : status === 400
          ? "Workspace request is invalid"
          : status === 413
            ? "Canvas exceeds the workspace size limit"
            : status === 415
              ? "Canvas is not a valid HTML document"
              : status === 503
                ? "Workspace is temporarily unavailable"
                : "Workspace preview failed";
}

/* code 收窄到共享联合体：wire code 原样透传给 App SDK，这里放宽成 string
   就等于允许产出一个联合体里没有的名字，契约当场退化成注释。 */
function workspaceError(code: AppGuiRuntimeErrorCode, message: string) {
  return { error: { code, message } };
}

function respond(
  response: ServerResponse,
  status: number,
  body: string | object,
  contentType: string,
  head = false
) {
  response.statusCode = status;
  response.setHeader("cache-control", "no-store");
  /* JSON 工作区 API 与错误响应也要防嗅探/防 Referer 泄露，与预览文档同规格。 */
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("content-type", `${contentType}; charset=utf-8`);
  const serialized = typeof body === "string" ? body : JSON.stringify(body);
  response.end(head ? undefined : serialized);
}
