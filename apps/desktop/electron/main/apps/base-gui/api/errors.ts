/**
 * [INPUT]: Depends on Node HTTP responses and the status/code/outcome/issues/currentRevision carried by main-side errors
 * [OUTPUT]: Provides apiError, JSON and raw-byte responses, and route-aware (read versus write) error mapping that never leaks host detail
 * [POS]: The response boundary of apps/base-gui/api; every other module only throws structured errors at it
 */

import type { ServerResponse } from "node:http";

type GuiApiError = Error & {
  status: number;
  code: string;
  outcome: "not-committed" | "unknown";
  issues?: unknown[];
  currentRevision?: number;
};

export function apiError(
  status: number,
  code: string,
  message: string,
  issues?: unknown[]
): GuiApiError {
  return Object.assign(new Error(message), {
    status,
    code,
    outcome: status >= 500 ? ("unknown" as const) : ("not-committed" as const),
    ...(issues ? { issues } : {}),
  });
}

/* 读路由与写路由的 5xx 语义不同：写请求「结果未知」必须让 App 用同一
   requestId 重试确认；读请求什么都没提交，说「mutation 结果未知」是谎话。
   路由类型是调用方的一等事实，不做猜测。 */
type GuiApiRoute = "read" | "write";

export function respondMappedError(
  response: ServerResponse,
  cause: unknown,
  route: GuiApiRoute = "read"
) {
  const error = cause as Partial<GuiApiError>;
  const status =
    typeof error.status === "number" && error.status >= 400 && error.status < 600
      ? error.status
      : 500;
  const uncertain = status >= 500 && route === "write";
  const code =
    typeof error.code === "string"
      ? error.code
      : status >= 500
        ? uncertain ? "commit_uncertain" : "read_failed"
        : "internal_error";
  respondError(
    response,
    status === 499 ? 400 : status,
    code,
    status < 500
      ? error.message ?? "Base API 请求失败"
      : uncertain
        ? "Base mutation 结果未知"
        : "Base 读取失败，请稍后重试",
    error.outcome ?? (status >= 500 ? "unknown" : "not-committed"),
    error.issues,
    error.currentRevision
  );
}

export function respondError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
  outcome: "not-committed" | "unknown" = "not-committed",
  issues?: unknown[],
  currentRevision?: number
) {
  respondJson(response, status, {
    error: {
      code,
      message,
      outcome,
      ...(typeof currentRevision === "number" ? { currentRevision } : {}),
      ...(issues?.length ? { issues: issues.slice(0, 20) } : {}),
    },
  });
}

export function respondJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headOnly = false
) {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(headOnly ? undefined : JSON.stringify(body));
}

export function respondBytes(
  response: ServerResponse,
  body: Buffer,
  mediaType: string,
  filename: string,
  headOnly = false
) {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = 200;
  response.setHeader("content-type", mediaType);
  response.setHeader("content-length", String(body.byteLength));
  response.setHeader("cache-control", "no-store");
  response.setHeader(
    "content-disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  response.end(headOnly ? undefined : body);
}
