/**
 * [INPUT]: Depends on Node request/response streams, the shared wire budget, the strict mutation envelopes, crypto, the Base GUI live binding, and the injected GuiBasePort
 * [OUTPUT]: Provides the row insert/patch/delete handlers with per-App and global admission plus a bounded, timed body reader
 * [POS]: Mutation half of apps/base-gui/api; the router settles token and capability, and Bases owns the domain semantics
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { BaseGuiLiveBinding } from "../../../../../shared/apps-ipc";
import {
  BASE_DELETE_LIMIT,
  BASE_INSERT_LIMIT,
  BASE_WIRE_BYTE_LIMIT,
} from "../../../../../shared/bases-ipc";
import type { GuiBasePort } from "./router";
import {
  deleteEnvelopeSchema,
  envelopeIssue,
  insertEnvelopeSchema,
  patchEnvelopeSchema,
} from "./envelopes";
import { apiError, respondJson, respondMappedError } from "./errors";

export const GUI_MUTATION_BODY_TIMEOUT_MS = 5_000;

export class MutationAdmission {
  private global = 0;
  private readonly apps = new Set<string>();

  acquire(appId: string) {
    if (this.global >= 4 || this.apps.has(appId)) return null;
    this.global += 1;
    this.apps.add(appId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.global -= 1;
      this.apps.delete(appId);
    };
  }
}

export async function mutateRows(input: {
  kind: "insert" | "patch" | "delete";
  appId: string;
  binding: BaseGuiLiveBinding;
  request: IncomingMessage;
  response: ServerResponse;
  port: GuiBasePort;
  admission: MutationAdmission;
  bodyTimeoutMs: number;
}) {
  const release = input.admission.acquire(input.appId);
  if (!release) {
    input.response.setHeader("retry-after", "1");
    respondMappedError(input.response, apiError(429, "mutation_busy", "Base mutation 正忙"), "write");
    return;
  }
  try {
    if (!/^application\/json(?:\s*;|$)/i.test(input.request.headers["content-type"] ?? "")) {
      throw apiError(415, "unsupported_media_type", "只接受 application/json");
    }
    const raw = await readBoundedBody(
      input.request,
      BASE_WIRE_BYTE_LIMIT,
      input.bodyTimeoutMs
    );
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw.toString("utf8"));
    } catch {
      throw apiError(400, "invalid_json", "请求正文不是合法 JSON");
    }
    const schema =
      input.kind === "insert"
        ? insertEnvelopeSchema
        : input.kind === "patch"
          ? patchEnvelopeSchema
          : deleteEnvelopeSchema;
    const parsed = schema.safeParse(decoded);
    if (!parsed.success) {
      const key = input.kind === "insert" ? "rows" : input.kind === "patch" ? "patches" : "rowIds";
      const items = (decoded as Record<string, unknown> | null)?.[key];
      const limit = input.kind === "delete" ? BASE_DELETE_LIMIT : BASE_INSERT_LIMIT;
      const tooMany = Array.isArray(items) && items.length > limit;
      throw apiError(
        tooMany ? 413 : 400,
        tooMany ? "batch_too_large" : "invalid_envelope",
        tooMany ? `单批最多处理 ${limit} 行` : `请求正文不符合 row ${input.kind} 合同`,
        parsed.error.issues.slice(0, 20).map(envelopeIssue)
      );
    }
    const common = { binding: input.binding, ...parsed.data };
    const result =
      input.kind === "insert"
        ? await input.port.insertRows(common as Parameters<GuiBasePort["insertRows"]>[0])
        : input.kind === "patch"
          ? await input.port.patchRows(common as Parameters<GuiBasePort["patchRows"]>[0])
          : await input.port.deleteRows(common as Parameters<GuiBasePort["deleteRows"]>[0]);
    respondJson(input.response, 200, result);
  } catch (cause) {
    respondMappedError(input.response, cause, "write");
  } finally {
    release();
  }
}

function readBoundedBody(request: IncomingMessage, limit: number, timeoutMs: number) {
  return new Promise<Buffer>((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      operation();
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > limit) {
        request.pause();
        finish(() => reject(apiError(413, "body_too_large", "请求正文超过 1 MiB")));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => finish(() => resolvePromise(Buffer.concat(chunks)));
    const onAbort = () => finish(() => reject(apiError(499, "client_aborted", "客户端已中断请求")));
    const onError = () => finish(() => reject(apiError(400, "invalid_envelope", "请求正文读取失败")));
    const cleanup = () => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("aborted", onAbort);
      request.off("error", onError);
    };
    const timer = setTimeout(
      () => finish(() => reject(apiError(408, "body_read_timeout", "请求正文读取超时"))),
      timeoutMs
    );
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("aborted", onAbort);
    request.once("error", onError);
  });
}
