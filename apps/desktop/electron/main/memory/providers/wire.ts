/**
 * [INPUT]: Depends on fetch/AbortSignal and MemoryProviderError
 * [OUTPUT]: Provides loopback JSON clients (hard overtime, pre-abort gate, 256KB flow budget, redirect/credential disabling, canonical error-packed network security diagnosis) and object/text/integer assertors
 * [POS]: The main/memory adapter is the public base; Openviking and everos write their own wire parsing, without each implementing HTTP
 */

import { MemoryProviderError } from "../core/provider";

const RESPONSE_LIMIT = 256 * 1024;

export type JsonObject = Record<string, unknown>;

export function object(value: unknown, context: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MemoryProviderError("protocol", `${context} 响应不是对象`);
  }
  return value as JsonObject;
}

export function text(value: unknown, context: string) {
  if (typeof value !== "string" || !value) {
    throw new MemoryProviderError("protocol", `${context} 缺少字符串字段`);
  }
  return value;
}

export function integer(value: unknown, context: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new MemoryProviderError("protocol", `${context} 缺少非负整数`);
  }
  return value as number;
}

/** wire 枚举严格化：枚举外的值一律 protocol 错误，绝不当作「大概是成功」。 */
export function literal<T extends string>(
  value: unknown,
  allowed: readonly T[],
  context: string
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new MemoryProviderError(
      "protocol",
      `${context} 返回枚举外的值：${JSON.stringify(value ?? null)}`
    );
  }
  return value as T;
}

async function readLimitedBody(response: Response, label: string) {
  const header = response.headers.get("content-length");
  const declared = header === null ? Number.NaN : Number(header);
  if (Number.isFinite(declared) && declared > RESPONSE_LIMIT) {
    throw new MemoryProviderError("protocol", `${label} 响应超过 256 KB`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > RESPONSE_LIMIT) {
        await reader.cancel().catch(() => {});
        throw new MemoryProviderError("protocol", `${label} 响应超过 256 KB`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

/* 只认后端公开的 canonical error envelope，不把任意错误正文塞进状态：
   FastAPI validation body 可能回显请求 input，而请求里正是聊天正文。 */
function canonicalHttpError(raw: string) {
  if (!raw) return "";
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return "";
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const envelope = value as JsonObject;
  if (!envelope.error || typeof envelope.error !== "object") return "";
  const error = envelope.error as JsonObject;
  const clean = (input: unknown, limit: number) =>
    typeof input === "string"
      ? input
          .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1<redacted>")
          .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "<redacted>")
          .split("")
          .map((character) => {
            const code = character.charCodeAt(0);
            return code < 32 || code === 127 ? " " : character;
          })
          .join("")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, limit)
      : "";
  const code = clean(error.code, 80);
  const message = clean(error.message, 300);
  const requestId = clean(envelope.request_id, 80);
  const facts = [code, message, requestId ? `request_id=${requestId}` : ""].filter(Boolean);
  return facts.length > 0 ? `：${facts.join("；")}` : "";
}

export type JsonRequest = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
  acceptedStatuses?: number[];
};

export class LoopbackJsonClient {
  constructor(
    readonly baseUrl: string,
    private readonly label: string,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async request(path: string, options: JsonRequest): Promise<unknown> {
    if (options.signal?.aborted) {
      throw new MemoryProviderError("timeout", `${this.label} 请求已取消`);
    }
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);
    timeout.unref?.();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        redirect: "error",
        credentials: "omit",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
          ...options.headers,
        },
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      });
      const raw = await readLimitedBody(response, this.label);
      if (
        !response.ok &&
        !options.acceptedStatuses?.includes(response.status)
      ) {
        throw new MemoryProviderError(
          "http",
          `${this.label} HTTP ${response.status}${canonicalHttpError(raw)}`
        );
      }
      if (!raw) return {};
      try {
        return JSON.parse(raw) as unknown;
      } catch (cause) {
        throw new MemoryProviderError(
          "protocol",
          `${this.label} 返回了无效 JSON`,
          { cause }
        );
      }
    } catch (cause) {
      if (cause instanceof MemoryProviderError) throw cause;
      if (controller.signal.aborted) {
        throw new MemoryProviderError(
          "timeout",
          timedOut ? `${this.label} 请求超时` : `${this.label} 请求已取消`,
          { cause }
        );
      }
      throw new MemoryProviderError("network", `无法连接 ${this.label}`, {
        cause,
      });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}
