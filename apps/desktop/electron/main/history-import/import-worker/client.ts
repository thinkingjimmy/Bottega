/**
 * [INPUT]: Depends on worker_threads, crypto/path/url, the closed import-worker protocol, and adapter entries
 * [OUTPUT]: Provides an abortable AsyncIterable of precomputed history-import batches with race-free wakeups and one-batch look-ahead backpressure
 * [POS]: Main-side parser transport; one lazily spawned worker serves every request of this client's lifetime and is terminated in close()
 */

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { AdapterEntry } from "../adapter";
import type { PreparedHistoryImportBatch } from "../../chats/sqlite/database-protocol";
import {
  parseImportWorkerResponse,
  type ImportWorkerAck,
  type ImportWorkerCancel,
  type ImportWorkerRequest,
  type ImportWorkerResponse,
} from "./protocol";

const workerEntry = () => {
  const current = fileURLToPath(import.meta.url);
  return current.endsWith(".ts")
    ? new URL("./worker.ts", import.meta.url)
    : join(dirname(current), "history-import-worker-entry.js");
};

function createWorker() {
  const entry = workerEntry();
  if (entry instanceof URL) {
    const loader = createRequire(import.meta.url).resolve("tsx/cjs");
    return new Worker([
      'const { workerData } = require("node:worker_threads");',
      "require(workerData.loader);",
      "require(workerData.entry);",
    ].join("\n"), {
      eval: true,
      execArgv: process.execArgv.filter((argument) => !argument.startsWith("--input-type")),
      workerData: { loader, entry: fileURLToPath(entry) },
    });
  }
  return new Worker(entry);
}

/* ── 一个客户端一个 worker ────────────────────────────────────────
 * 每条外源都重开一次线程，代价是启动扫描里 N 次 spawn + N 次 terminate；
 * 而这个 worker 是无状态的纯解析器，重开换不来任何隔离。改为惰性开一次、
 * close() 时终止；请求串行排队，因为同一条 port 上并发的两次 parse 只会
 * 让 ack 认错主人。
 * 中途放弃时不再 terminate，而是发一枚 cancel：worker 立刻从 ack 等待里
 * 脱身，下一条请求无须等它超时。
 * ────────────────────────────────────────────────────────── */
export class HistoryImportWorkerClient {
  private worker: Worker | null = null;
  private queue: Promise<void> = Promise.resolve();

  async *parseBatches(
    home: string,
    entry: AdapterEntry,
    signal?: AbortSignal
  ): AsyncGenerator<PreparedHistoryImportBatch, boolean, void> {
    signal?.throwIfAborted();
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous.catch(() => undefined);
    try {
      return yield* this.parseOnWorker(home, entry, signal);
    } finally {
      release();
    }
  }

  async close() {
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate();
  }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = createWorker();
    /* 复用意味着这条线程活得比一次解析长：unref 之后它不再替进程续命。
       忘记 close() 从此只是浪费一条空闲线程，而不是把宿主进程钉在退出的
       门口——一次跑完的测试进程曾因此永远停在 0% CPU 上。 */
    worker.unref();
    this.worker = worker;
    /* worker 自己没了就不能再被复用：清掉句柄，下一条请求重新开一个。 */
    const forget = () => {
      if (this.worker === worker) this.worker = null;
    };
    worker.on("error", forget);
    worker.on("exit", forget);
    return worker;
  }

  private async *parseOnWorker(
    home: string,
    entry: AdapterEntry,
    signal?: AbortSignal
  ): AsyncGenerator<PreparedHistoryImportBatch, boolean, void> {
    signal?.throwIfAborted();
    const requestId = randomUUID();
    const worker = this.ensureWorker();
    const queue: ImportWorkerResponse[] = [];
    let wake: (() => void) | null = null;
    let failure: unknown;
    let finished = false;
    const notify = () => { wake?.(); wake = null; };
    /* 复用一条 port 的代价：被放弃的上一条请求还会吐出它的尾音（batch 或
       cancel 引发的 failure）。按 requestId 认领，认不出的一律丢弃——那不是
       协议违规，只是别人的回声。 */
    const onMessage = (raw: unknown) => {
      if (!raw || typeof raw !== "object") return;
      if ((raw as { requestId?: unknown }).requestId !== requestId) return;
      try { queue.push(parseImportWorkerResponse(raw, requestId)); }
      catch (cause) { failure = cause; }
      notify();
    };
    const onFailure = (cause: unknown) => { failure = cause; notify(); };
    const onExit = (code: number) => {
      if (code !== 0 && !failure) onFailure(new Error(`History import worker exited (${code})`));
      else notify();
    };
    const onAbort = () => onFailure(signal?.reason ?? new Error("History import aborted"));
    worker.on("message", onMessage);
    worker.on("messageerror", onFailure);
    worker.on("error", onFailure);
    worker.on("exit", onExit);
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.postMessage({
      version: 1,
      kind: "parse",
      requestId,
      home,
      entry,
    } satisfies ImportWorkerRequest);
    try {
      let expectedBatch = 0;
      while (true) {
        if (failure) throw failure;
        const response = queue.shift();
        if (!response) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            if (queue.length || failure) notify();
          });
          continue;
        }
        if (response.kind === "failure") throw new Error(response.message);
        if (response.kind === "done") {
          finished = true;
          return response.incompleteTail;
        }
        if (response.batchIndex !== expectedBatch) {
          throw new Error("History import worker batch order changed");
        }
        worker.postMessage({
          version: 1,
          kind: "ack",
          requestId,
          batchIndex: expectedBatch,
        } satisfies ImportWorkerAck);
        expectedBatch += 1;
        yield { kind: "prepared-history-import", entries: response.entries };
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      worker.off("message", onMessage);
      worker.off("messageerror", onFailure);
      worker.off("error", onFailure);
      worker.off("exit", onExit);
      if (!finished && this.worker === worker) {
        worker.postMessage({
          version: 1,
          kind: "cancel",
          requestId,
        } satisfies ImportWorkerCancel);
      }
    }
  }
}
