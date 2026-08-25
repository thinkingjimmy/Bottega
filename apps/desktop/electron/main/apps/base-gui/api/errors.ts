/**
 * [INPUT]: Depends on Node HTTP response and status/code/outcome/issues/currentRevision of errors in the main domain
 * [OUTPUT]: Provides apiError, JSON/original byte response and unified de-sensitive error mapping
 * [POS]: The HTTP result boundary of apps/base-gui/api; Business leaves only throwing out structural errors
 */

import type { ServerResponse } from "node:http";

export type GuiApiError = Error & {
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

export function respondMappedError(response: ServerResponse, cause: unknown) {
  const error = cause as Partial<GuiApiError>;
  const status =
    typeof error.status === "number" && error.status >= 400 && error.status < 600
      ? error.status
      : 500;
  const code =
    typeof error.code === "string"
      ? error.code
      : status >= 500
        ? "commit_uncertain"
        : "internal_error";
  respondError(
    response,
    status === 499 ? 400 : status,
    code,
    status >= 500 ? "Base mutation 结果未知" : error.message ?? "Base API 请求失败",
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
