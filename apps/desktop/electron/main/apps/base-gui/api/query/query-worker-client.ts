/**
 * [INPUT]: Depends on Node worker_threads, crypto request identities, per-request AbortSignals, and the shared API error factory
 * [OUTPUT]: Provides the lazy Query V1 worker transport: bounded FIFO, queue/wall deadlines, strict reply envelopes, abort-driven undispatch, and terminating custody that tells its owner when the cache must be dropped
 * [POS]: Transport leaf of api/query/ under query-executor.ts; it owns the worker thread and pending requests, never snapshots or byte budgets
 */

import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { apiError } from "../errors";

const MAX_PENDING = 32;

type Pending = {
  resolve(value: unknown): void;
  reject(cause: unknown): void;
  timer: NodeJS.Timeout;
  deadlineAt: number;
  allowStarted: boolean;
  started: boolean;
  validate(value: unknown): unknown;
  dispose(): void;
};

type WorkerReply = Readonly<{
  requestId: string;
  ok: boolean;
  started?: boolean;
  result?: unknown;
  error?: Readonly<{
    message: string;
    status?: number;
    code?: string;
    outcome?: "not-committed" | "unknown";
    issues?: unknown[];
  }>;
}>;

export class QueryWorkerClient {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, Pending>();
  private closing = false;

  /* onReset 在 worker 死掉或被关闭时触发：快照缓存的所有权在执行器那边，
     transport 只负责如实报告「你钉在 worker 里的东西已经不存在了」。 */
  constructor(
    private readonly entry: string,
    private readonly onReset: (cause: unknown) => void
  ) {}

  get closed() {
    return this.closing;
  }

  send(
    message: Record<string, unknown>,
    timeoutMs: number,
    queueTimeoutMs: number | undefined,
    allowStarted: boolean,
    validate: (value: unknown) => unknown,
    signal?: AbortSignal
  ) {
    if (this.closing) {
      return Promise.reject(apiError(503, "query_executor_closed", "Query executor is closed"));
    }
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.pending.size >= MAX_PENDING) {
      return Promise.reject(apiError(429, "query_queue_full", "Query worker queue is full"));
    }
    const worker = this.ensureWorker();
    const requestId = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => queueTimeoutMs
        ? this.rejectQueued(requestId)
        : this.fail(apiError(408, "query_timeout", "Query worker exceeded its wall budget")),
      queueTimeoutMs ?? timeoutMs);
      /* 客户端断开时立刻放弃这条 pending：worker 迟到的回复会因为找不到
         requestId 被 receive 丢弃，不需要也不应该 terminate worker。 */
      const onAbort = () => this.rejectRequest(requestId, abortError());
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(requestId, {
        resolve,
        reject,
        timer,
        deadlineAt: Date.now() + timeoutMs,
        allowStarted,
        started: false,
        validate,
        dispose: () => signal?.removeEventListener("abort", onAbort),
      });
      worker.postMessage({
        ...message,
        requestId,
        ...(queueTimeoutMs ? { queueDeadlineAt: Date.now() + queueTimeoutMs } : {}),
      });
    });
  }

  /** 无需回执的通知（evict）：worker 还没起来就没有东西要驱逐。 */
  notify(message: Record<string, unknown>) {
    this.worker?.postMessage(message);
  }

  fail(cause: unknown) {
    const worker = this.worker;
    this.worker = null;
    this.rejectAll(cause);
    this.onReset(cause);
    if (worker) void worker.terminate();
  }

  async close() {
    this.closing = true;
    const worker = this.worker;
    this.worker = null;
    const cause = apiError(503, "query_executor_closed", "Query executor is closed");
    this.rejectAll(cause);
    this.onReset(cause);
    if (worker) await worker.terminate();
  }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(this.entry);
    worker.unref();
    worker.on("message", (reply: unknown) => this.receive(reply));
    worker.on("error", (cause) => this.fail(cause));
    worker.on("exit", (code) => {
      if (this.worker === worker && code !== 0) {
        this.fail(apiError(503, "query_worker_exit", `Query worker exited with code ${code}`));
      }
    });
    this.worker = worker;
    return worker;
  }

  private receive(value: unknown) {
    let reply: WorkerReply;
    try {
      reply = parseWorkerReply(value);
    } catch (cause) {
      this.fail(cause);
      return;
    }
    const pending = this.pending.get(reply.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    if (reply.started) {
      if (!pending.allowStarted) {
        this.fail(apiError(503, "query_worker_invalid", "Query worker sent an unexpected started envelope"));
        return;
      }
      pending.started = true;
      const remaining = pending.deadlineAt - Date.now();
      if (remaining <= 0) {
        this.fail(apiError(408, "query_timeout", "Query worker exceeded its 500 ms wall budget"));
        return;
      }
      pending.timer = setTimeout(() => {
        this.fail(apiError(408, "query_timeout", "Query worker exceeded its 500 ms wall budget"));
      }, remaining);
      return;
    }
    if (reply.ok) {
      try {
        const result = pending.validate(reply.result);
        this.pending.delete(reply.requestId);
        pending.dispose();
        pending.resolve(result);
      } catch (cause) {
        pending.reject(cause);
        this.pending.delete(reply.requestId);
        pending.dispose();
        this.fail(cause);
      }
      return;
    }
    this.pending.delete(reply.requestId);
    pending.dispose();
    pending.reject(Object.assign(new Error(reply.error?.message ?? "Query worker failed"), {
      status: reply.error?.status ?? 500,
      code: reply.error?.code ?? "query_worker_failed",
      outcome: reply.error?.outcome ?? "unknown",
      ...(reply.error?.issues ? { issues: reply.error.issues } : {}),
    }));
  }

  private rejectQueued(requestId: string) {
    const pending = this.pending.get(requestId);
    if (!pending || pending.started) return;
    this.rejectRequest(
      requestId,
      apiError(429, "query_queue_timeout", "Query worker queue exceeded 100 ms")
    );
  }

  private rejectRequest(requestId: string, cause: unknown) {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.dispose();
    pending.reject(cause);
  }

  private rejectAll(cause: unknown) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.dispose();
      pending.reject(cause);
    }
    this.pending.clear();
  }
}

export function abortError() {
  return apiError(499, "client_aborted", "Query client aborted the request");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function parseWorkerReply(value: unknown): WorkerReply {
  if (!isRecord(value) || typeof value.requestId !== "string" || typeof value.ok !== "boolean") {
    throw apiError(503, "query_worker_invalid", "Query worker envelope is invalid");
  }
  if (value.started === true) {
    if (value.ok !== true || !exactKeys(value, ["requestId", "ok", "started"])) {
      throw apiError(503, "query_worker_invalid", "Query worker started envelope is invalid");
    }
    return value as WorkerReply;
  }
  if (value.ok === true) {
    if (!exactKeys(value, ["requestId", "ok", "result"])) {
      throw apiError(503, "query_worker_invalid", "Query worker success envelope is invalid");
    }
    return value as WorkerReply;
  }
  if (!exactKeys(value, ["requestId", "ok", "error"]) || !validWorkerError(value.error)) {
    throw apiError(503, "query_worker_invalid", "Query worker error envelope is invalid");
  }
  return value as WorkerReply;
}

function validWorkerError(value: unknown) {
  if (!isRecord(value) || typeof value.message !== "string" || value.message.length > 4_096) return false;
  if (!Object.keys(value).every((key) => ["message", "status", "code", "outcome", "issues"].includes(key))) return false;
  if (value.status !== undefined && (!Number.isInteger(value.status) || Number(value.status) < 400 || Number(value.status) > 599)) return false;
  if (value.code !== undefined && (typeof value.code !== "string" || value.code.length > 120)) return false;
  if (value.outcome !== undefined && value.outcome !== "not-committed" && value.outcome !== "unknown") return false;
  return value.issues === undefined || Array.isArray(value.issues);
}
