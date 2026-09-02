/**
 * [INPUT]: Depends on generation-bound handler context, opaque token registry, active-generation fencing, legacy Base reads, durable pre-copy Query snapshot descriptors with live identity checks, compiled Query V1, mutation handlers and owner-scoped attachment port
 * [OUTPUT]: Provides GUIBasePort, pre-copy query source/current-identity contract, client-disconnect AbortSignal plumbing, BaseGuiApi factory and strict token/method/capability/generation routing for legacy and compiled Base GUI endpoints
 * [POS]: The root of the apps/base-gui/api combination; token→binding→method→capability→active-write fence→handler
 */

import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
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
  apiError,
  respondBytes,
  respondError,
  respondJson,
  respondMappedError,
} from "./errors";
import { readQueryRequest } from "./query-v1";
import type { BaseGuiQueryRequestV1 } from "../../../../../shared/app-gui/query";
import { z } from "zod";

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
  /* querySnapshot 与 queryV1 在产品装配里是必备的（gui-runtime-service 注入）。
     类型上保持可选只是为了不强迫上游装配体重复声明；缺失时 query-v1 路由
     以 query_unavailable 收场，绝不在 main 线程上冒充执行器。 */
  querySnapshot?(appId: string): Promise<BaseGuiQuerySnapshotSource | null>;
  isActiveBinding?(binding: BaseGuiLiveBinding): boolean;
  queryV1?(input: {
    source: BaseGuiQuerySnapshotSource;
    request: BaseGuiQueryRequestV1;
    cursorKey: Uint8Array;
    surfaceId: string;
    signal: AbortSignal;
  }): Promise<unknown>;
  readPreferences?(input: { binding: BaseGuiLiveBinding }): Promise<unknown>;
  writePreferences?(input: {
    binding: BaseGuiLiveBinding;
    expectedRevision: number;
    value?: unknown;
    reset: boolean;
  }): Promise<unknown>;
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

export type BaseGuiQuerySnapshotSource = Readonly<{
  baseInstanceId: string;
  revision: number;
  expectedRowsBytes: number;
  copy(): Promise<BaseSnapshot>;
  currentIdentity(): Promise<Readonly<{ baseInstanceId: string; revision: number }> | null>;
}>;

type TokenVerifier = {
  verify(appId: string, surfaceId: string, candidate: string): GuiTokenClaims | null;
};

export function createBaseGuiApi(
  tokens: TokenVerifier,
  port: GuiBasePort,
  options: { bodyTimeoutMs?: number } = {}
): BaseGuiApiHandler {
  const admission = new MutationAdmission();
  const queryCursorKey = randomBytes(32);
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
        : endpoint.kind === "query-v1"
          ? ["POST"]
        : endpoint.kind === "preferences"
          ? ["GET", "POST"]
          : ["GET", "HEAD"];
    response.setHeader("allow", allowed.join(", "));
    if (!allowed.includes(method)) {
      respondError(response, 405, "method_not_allowed", "请求方法不受支持");
      return;
    }
    const capability = endpoint.kind === "rows"
      ? method === "POST"
        ? "row-insert"
        : method === "PATCH"
          ? "row-patch"
          : method === "DELETE"
            ? "row-delete"
            : null
      : endpoint.kind === "attachment"
        ? "attachment-read"
        : null;
    if (capability && !binding.baseCapabilities.includes(capability)) {
      respondError(response, 403, "capability_not_granted", `缺少 ${capability} capability`);
      return;
    }
    const writesState =
      (endpoint.kind === "rows" && ["POST", "PATCH", "DELETE"].includes(method)) ||
      (endpoint.kind === "preferences" && method === "POST");
    if (writesState && port.isActiveBinding && !port.isActiveBinding(binding)) {
      respondError(
        response,
        409,
        "generation_draining",
        "The previous App generation is read-only while it drains"
      );
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
    if (endpoint.kind === "query-v1") {
      const aborts = abortOnDisconnect(request, response);
      try {
        const querySnapshot = port.querySnapshot;
        const queryV1 = port.queryV1;
        if (!querySnapshot || !queryV1) {
          throw apiError(503, "query_unavailable", "Query V1 executor is not configured");
        }
        const query = await readQueryRequest(request);
        const source = await querySnapshot(appId);
        if (!source) {
          respondError(response, 404, "base_not_found", "该 App 没有可读的 Base");
          return;
        }
        respondJson(response, 200, await queryV1({
          source,
          request: query,
          cursorKey: queryCursorKey,
          surfaceId: binding.surfaceId,
          signal: aborts.signal,
        }));
      } catch (cause) {
        respondMappedError(response, cause);
      } finally {
        aborts.release();
      }
      return;
    }
    if (endpoint.kind === "preferences") {
      try {
        if (method === "GET") {
          if (!port.readPreferences) throw apiError(404, "preferences_unavailable", "App preferences are unavailable");
          respondJson(response, 200, await port.readPreferences({ binding }));
        } else {
          if (!port.writePreferences) throw apiError(404, "preferences_unavailable", "App preferences are unavailable");
          const body = await readPreferenceWrite(request);
          respondJson(response, 200, await port.writePreferences({ binding, ...body }));
        }
      } catch (cause) {
        respondMappedError(response, cause, method === "GET" ? "read" : "write");
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

/* 客户端断开必须立刻传导到执行器：否则一个已经没人读的查询仍会占着快照
   预留与 worker 槽位，直到 500 ms 墙钟自己烧完。IncomingMessage 的 "close"
   在正常读完时也会触发，所以真正的中断信号取自 response 侧未写完的关闭。 */
function abortOnDisconnect(request: IncomingMessage, response: ServerResponse) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const onResponseClose = () => {
    if (!response.writableEnded) abort();
  };
  request.once("aborted", abort);
  response.once("close", onResponseClose);
  return {
    signal: controller.signal,
    release: () => {
      request.off("aborted", abort);
      response.off("close", onResponseClose);
    },
  };
}

function endpointFor(pathname: string) {
  if (pathname === "/_api/base/meta") return { kind: "meta" as const };
  if (pathname === "/_api/base/rows") return { kind: "rows" as const };
  if (pathname === "/_api/base/query-v1") return { kind: "query-v1" as const };
  if (pathname === "/_api/preferences") return { kind: "preferences" as const };
  const match = /^\/_api\/base\/attachments\/(attachment_[a-f0-9]{24})$/.exec(pathname);
  return match ? { kind: "attachment" as const, attachmentId: match[1]! } : null;
}

const preferenceWriteSchema = z.union([
  z.object({ expectedRevision: z.number().int().nonnegative(), value: z.unknown() }).strict()
    .transform((value) => ({ ...value, reset: false as const })),
  z.object({ expectedRevision: z.number().int().nonnegative(), reset: z.literal(true) }).strict()
    .transform((value) => ({ expectedRevision: value.expectedRevision, reset: true as const })),
]);

async function readPreferenceWrite(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 70 * 1024) throw apiError(413, "preference_limit", "Preference request exceeds its byte budget");
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw apiError(400, "preference_invalid", "Preference request must be valid JSON");
  }
  const parsed = preferenceWriteSchema.safeParse(value);
  if (!parsed.success) throw apiError(400, "preference_invalid", "Preference request is invalid", parsed.error.issues);
  return parsed.data;
}

export function sameGuiBinding(claims: GuiTokenClaims, binding: BaseGuiLiveBinding) {
  return claims.appId === binding.appId &&
    claims.contentLayoutVersion === binding.contentLayoutVersion &&
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
