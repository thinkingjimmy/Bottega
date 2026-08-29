/**
 * [INPUT]: Depends on generation-bound handler context, opaque token registry, Base read/query kernel, mutation handlers and owner-scoped attachment port
 * [OUTPUT]: Provides GUIBasePort, BaseGuiApi plant and static method/capability routing for all Base GUI HTTP endpoints
 * [POS]: The root of the apps/base-gui/api combination; token→binding→method→capability→handler
 */

import type { IncomingMessage } from "node:http";
import type { BaseGuiApiHandler } from "../../app-gateway";
import type { BaseGuiLiveBinding } from "../../../../../shared/apps-ipc";
import type {
  BaseRow,
  BaseRowPatch,
  BaseSnapshot,
} from "../../../../../shared/bases-ipc";
import {
  queryBase,
  BASE_QUERY_ENVELOPE_RESERVE,
  BASE_QUERY_RESULT_BYTE_LIMIT,
} from "../../../bases/base-read";
import type { GuiTokenClaims } from "../../gui-api";
import {
  GUI_MUTATION_BODY_TIMEOUT_MS,
  MutationAdmission,
  mutateRows,
} from "./mutations";
import {
  respondBytes,
  respondError,
  respondJson,
  respondMappedError,
} from "./errors";

const ROWS_DEFAULT_LIMIT = 200;
const ROWS_MAX_LIMIT = 500;

type MutationResult = Readonly<{
  baseInstanceId: string;
  revision: number;
  rowCount: number;
  replayed: boolean;
}>;

export type GuiBasePort = {
  snapshot(appId: string): Promise<BaseSnapshot | null>;
  insertRows(input: {
    binding: BaseGuiLiveBinding;
    expectedBaseInstanceId: string;
    expectedRevision: number;
    rows: BaseRow[];
  }): Promise<MutationResult & { rowIds: string[] }>;
  patchRows(input: {
    binding: BaseGuiLiveBinding;
    expectedBaseInstanceId: string;
    expectedRevision: number;
    patches: Array<{ rowId: string; patch: BaseRowPatch }>;
  }): Promise<MutationResult & { rowIds: string[] }>;
  deleteRows(input: {
    binding: BaseGuiLiveBinding;
    expectedBaseInstanceId: string;
    expectedRevision: number;
    rowIds: string[];
  }): Promise<MutationResult & { removedRowIds: string[]; missingRowIds: string[] }>;
  readAttachment(input: {
    binding: BaseGuiLiveBinding;
    attachmentId: string;
  }): Promise<{ bytes: Buffer; filename: string; mediaType: string }>;
};

type TokenVerifier = {
  verify(appId: string, surfaceId: string, candidate: string): GuiTokenClaims | null;
};

export function createBaseGuiApi(
  tokens: TokenVerifier,
  port: GuiBasePort,
  options: { bodyTimeoutMs?: number } = {}
): BaseGuiApiHandler {
  const admission = new MutationAdmission();
  const bodyTimeoutMs = options.bodyTimeoutMs ?? GUI_MUTATION_BODY_TIMEOUT_MS;
  return async (context, pathname, request, response) => {
    const { appId, binding } = context;
    const method = request.method ?? "GET";
    const claims = tokens.verify(appId, binding.surfaceId, bearerToken(request));
    if (!claims || !sameGuiBinding(claims, binding)) {
      respondError(response, 401, "invalid_token", "Base API token 无效");
      return;
    }
    const endpoint = endpointFor(pathname);
    if (!endpoint) {
      respondError(response, 404, "endpoint_not_found", "未知的 Base API 端点");
      return;
    }
    const allowed = endpoint.kind === "meta"
      ? ["GET", "HEAD"]
      : endpoint.kind === "rows"
        ? ["GET", "HEAD", "POST", "PATCH", "DELETE"]
        : ["GET", "HEAD"];
    response.setHeader("allow", allowed.join(", "));
    if (!allowed.includes(method)) {
      respondError(response, 405, "method_not_allowed", "请求方法不受支持");
      return;
    }
    const capability = method === "POST"
      ? "row-insert"
      : method === "PATCH"
        ? "row-patch"
        : method === "DELETE"
          ? "row-delete"
          : endpoint.kind === "attachment"
            ? "attachment-read"
            : null;
    if (capability && !binding.baseCapabilities.includes(capability)) {
      respondError(response, 403, "capability_not_granted", `缺少 ${capability} capability`);
      return;
    }
    if (endpoint.kind === "attachment") {
      try {
        const artifact = await port.readAttachment({
          binding,
          attachmentId: endpoint.attachmentId,
        });
        respondBytes(response, artifact.bytes, artifact.mediaType, artifact.filename, method === "HEAD");
      } catch (cause) {
        respondMappedError(response, cause);
      }
      return;
    }
    if (method === "POST" || method === "PATCH" || method === "DELETE") {
      await mutateRows({
        kind: method === "POST" ? "insert" : method === "PATCH" ? "patch" : "delete",
        appId,
        binding,
        request,
        response,
        port,
        admission,
        bodyTimeoutMs,
      });
      return;
    }
    const snapshot = await port.snapshot(appId);
    if (!snapshot) {
      respondError(response, 404, "base_not_found", "该 App 没有可读的 Base");
      return;
    }
    try {
      respondJson(response, 200, project(snapshot, endpoint.kind, request, binding), method === "HEAD");
    } catch (cause) {
      respondMappedError(response, cause);
    }
  };
}

function project(snapshot: BaseSnapshot, endpoint: "meta" | "rows", request: IncomingMessage, binding: BaseGuiLiveBinding) {
  if (endpoint === "meta") {
    return {
      name: snapshot.meta.name,
      columns: snapshot.meta.columns,
      views: snapshot.meta.views.map((view) => ({ id: view.id, name: view.name, type: view.config.type })),
      revision: snapshot.meta.revision,
      rowCount: snapshot.rows.length,
      baseInstanceId: snapshot.meta.ownerInstanceId,
      capabilities: {
        rowInsert: binding.baseCapabilities.includes("row-insert"),
        rowPatch: binding.baseCapabilities.includes("row-patch"),
        rowDelete: binding.baseCapabilities.includes("row-delete"),
        attachmentRead: binding.baseCapabilities.includes("attachment-read"),
      },
    };
  }
  const query = new URL(request.url ?? "/", "http://localhost").searchParams;
  return queryBase(snapshot, {
    limit: parseLimit(query.get("limit")),
    ...(query.get("cursor") ? { cursor: query.get("cursor")! } : {}),
  }, BASE_QUERY_RESULT_BYTE_LIMIT - BASE_QUERY_ENVELOPE_RESERVE);
}

function endpointFor(pathname: string) {
  if (pathname === "/_api/base/meta") return { kind: "meta" as const };
  if (pathname === "/_api/base/rows") return { kind: "rows" as const };
  const match = /^\/_api\/base\/attachments\/(attachment_[a-f0-9]{24})$/.exec(pathname);
  return match ? { kind: "attachment" as const, attachmentId: match[1]! } : null;
}

export function sameGuiBinding(claims: GuiTokenClaims, binding: BaseGuiLiveBinding) {
  return claims.appId === binding.appId &&
    claims.generationId === binding.generationId &&
    claims.contentDigest === binding.contentDigest &&
    claims.lifecycleRevision === binding.lifecycleRevision &&
    sameCapabilities(claims.baseCapabilities, binding.baseCapabilities) &&
    sameCapabilities(claims.hostActions, binding.hostActions) &&
    claims.workspaceReadScope === binding.workspaceReadScope &&
    claims.surfaceId === binding.surfaceId &&
    claims.appSurfaceLeaseId === binding.appSurfaceLeaseId &&
    claims.capabilityDecisionId === binding.capabilityDecisionId &&
    claims.capabilityRevision === binding.capabilityRevision;
}

function sameCapabilities(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function parseLimit(raw: string | null) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return ROWS_DEFAULT_LIMIT;
  return Math.min(parsed, ROWS_MAX_LIMIT);
}

export function bearerToken(request: IncomingMessage) {
  const header = request.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}
