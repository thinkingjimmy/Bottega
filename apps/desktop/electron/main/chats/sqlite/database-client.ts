/**
 * [INPUT]: Depends on worker_threads, crypto/path/url, and the closed database protocol
 * [OUTPUT]: Provides the main-owned worker client, separate read and mutation/maintenance request deadlines, single-flight safe-read restart, trusted-exit fencing, receipt reconciliation, and graceful close
 * [POS]: Only main-process access path to Chat SQLite; transport uncertainty never becomes an assumed rollback
 */

import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseDatabaseResponse,
  type ChatDatabaseFailure,
  type DatabaseCommand,
  type DatabaseRequest,
  type DatabaseResults,
  type MutationOutcome,
  type MutationReceipt,
} from "./database-protocol";

type WorkerLike = Pick<Worker, "on" | "postMessage" | "terminate"> & { unref?(): void };
type WorkerFactory = () => WorkerLike;
type Initialization = Extract<DatabaseCommand, { kind: "initialize" }>;
type MutationCommand = Extract<DatabaseCommand, { operationId: string; requestHash: string }>;

const RETRYABLE_READS = new Set<DatabaseCommand["kind"]>([
  "list-metadata",
  "get-record",
  "get-native-message",
  "get-native-messages",
  "get-native-subagents",
  "get-timeline-page",
  "get-timeline-around",
  "get-outline-page",
  "find-messages",
  "get-operation-receipt",
  "list-attachment-ids",
  "has-attachment-reference",
  "get-attachment-reference",
  "list-memory-summaries",
  "get-memory-native-segment",
  "search-documents",
  "get-history-import-run",
  "list-reconcilable-continuations",
  "maintenance-gate",
]);

/* 读与写不该共用一条秒表：读是可重试的投影，写是一次已提交的 turn。
   提交后的 WAL/FTS 维护现在排在回执之后，但一次 TRUNCATE 仍可能比任何
   读都久——用读的 15 秒去裁决它，就是把已落盘的结果判成 outcome_unknown。 */
const READ_REQUEST_TIMEOUT_MS = 15_000;
const MUTATION_REQUEST_TIMEOUT_MS = 60_000;

/* 维护闸门要走一遍 integrity_check、FTS 合并与一次 TRUNCATE：它没有
   operationId，却比任何一次提交都慢，用读的秒表裁决它只会杀掉 worker。 */
const usesMutationDeadline = (command: DatabaseCommand) =>
  "operationId" in command || command.kind === "maintenance-gate";

type Pending = {
  kind: DatabaseCommand["kind"];
  resolve(value: unknown): void;
  reject(cause: unknown): void;
  timer: ReturnType<typeof setTimeout>;
};

export class ChatDatabaseError extends Error {
  override name = "ChatDatabaseError";
  constructor(readonly failure: ChatDatabaseFailure) {
    super(failure.message);
  }
}

const defaultWorkerEntry = () => {
  const current = fileURLToPath(import.meta.url);
  return current.endsWith(".ts")
    ? new URL("./database-worker.ts", import.meta.url)
    : join(dirname(current), "chat-database-worker-entry.js");
};

const createDefaultWorker = () => {
  const entry = defaultWorkerEntry();
  if (entry instanceof URL && entry.pathname.endsWith(".ts")) {
    const loader = createRequire(import.meta.url).resolve("tsx/cjs");
    const source = [
      'const { workerData } = require("node:worker_threads");',
      "require(workerData.loader);",
      "require(workerData.entry);",
    ].join("\n");
    return new Worker(source, {
      eval: true,
      execArgv: process.execArgv.filter((argument) => !argument.startsWith("--input-type")),
      workerData: {
        loader,
        entry: fileURLToPath(entry),
      },
    });
  }
  return new Worker(entry);
};

export class ChatDatabaseClient {
  private worker: WorkerLike | null = null;
  private pending = new Map<string, Pending>();
  private terminating: Promise<void> | null = null;
  private restarting: Promise<void> | null = null;
  private initialization: Initialization | null = null;
  private closed = false;

  constructor(
    private readonly options: {
      requestTimeoutMs?: number;
      mutationTimeoutMs?: number;
      workerFactory?: WorkerFactory;
    } = {}
  ) {}

  async initialize(command: Initialization) {
    if (this.closed) throw new Error("database client is closed");
    if (this.initialization) throw new Error("database client is already initialized");
    this.initialization = structuredClone(command);
    this.spawn();
    try {
      return await this.request(command);
    } catch (cause) {
      await this.terminate(cause);
      this.initialization = null;
      throw cause;
    }
  }

  async execute<K extends Exclude<DatabaseCommand["kind"], "initialize">>(
    command: Extract<DatabaseCommand, { kind: K }>
  ): Promise<DatabaseResults[K]> {
    const typedCommand = command as DatabaseCommand;
    if ("operationId" in command && "requestHash" in command) {
      return this.mutate(command as MutationCommand) as Promise<DatabaseResults[K]>;
    }
    if (RETRYABLE_READS.has(typedCommand.kind)) {
      return this.read(typedCommand) as Promise<DatabaseResults[K]>;
    }
    return this.request(command) as Promise<DatabaseResults[K]>;
  }

  private async read(command: DatabaseCommand) {
    try {
      return await this.request(command);
    } catch (cause) {
      if (cause instanceof ChatDatabaseError) throw cause;
      await this.restart();
      return this.request(command);
    }
  }

  private spawn() {
    if (this.worker || this.terminating) throw new Error("database worker ownership is not clear");
    const factory = this.options.workerFactory ?? createDefaultWorker;
    const worker = factory();
    this.worker = worker;
    worker.on("message", (value: unknown) => this.onMessage(worker, value));
    worker.on("messageerror", (cause: Error) => void this.terminate(cause));
    worker.on("error", (cause: Error) => void this.terminate(cause));
    worker.on("exit", (code: number) => this.onExit(worker, code));
    worker.unref?.();
  }

  private request<K extends DatabaseCommand["kind"]>(
    command: Extract<DatabaseCommand, { kind: K }>
  ): Promise<DatabaseResults[K]> {
    if (this.closed && command.kind !== "close") return Promise.reject(new Error("database client is closed"));
    if (!this.worker || this.terminating) return Promise.reject(new Error("database worker is unavailable"));
    const requestId = randomUUID();
    const request = { protocolVersion: 1, requestId, command } satisfies DatabaseRequest;
    return new Promise<DatabaseResults[K]>((resolve, reject) => {
      const timer = setTimeout(() => {
        void this.terminate(new Error(`database request timed out: ${command.kind}`));
      }, usesMutationDeadline(command)
        ? this.options.mutationTimeoutMs ?? MUTATION_REQUEST_TIMEOUT_MS
        : this.options.requestTimeoutMs ?? READ_REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { kind: command.kind, resolve, reject, timer });
      try {
        this.worker!.postMessage(request);
      } catch (cause) {
        void this.terminate(cause);
      }
    });
  }

  private onMessage(owner: WorkerLike, value: unknown) {
    if (owner !== this.worker || this.terminating) return;
    const requestId = typeof value === "object" && value && "requestId" in value
      ? String((value as { requestId: unknown }).requestId)
      : "";
    const pending = this.pending.get(requestId);
    if (!pending) {
      void this.terminate(new Error("database response requestId mismatch"));
      return;
    }
    try {
      const response = parseDatabaseResponse(value, requestId, pending.kind);
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new ChatDatabaseError(response.failure));
    } catch (cause) {
      void this.terminate(cause);
    }
  }

  private onExit(owner: WorkerLike, code: number) {
    if (owner !== this.worker) return;
    this.worker = null;
    if (!this.terminating) {
      this.rejectPending(new Error(`database worker exited unexpectedly (${code})`));
    }
  }

  private rejectPending(cause: unknown) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(cause);
    }
    this.pending.clear();
  }

  private terminate(cause: unknown) {
    if (this.terminating) return this.terminating;
    const worker = this.worker;
    this.rejectPending(cause);
    if (!worker) return Promise.resolve();
    this.terminating = Promise.resolve(worker.terminate()).then(() => {
      if (this.worker === worker) this.worker = null;
      this.terminating = null;
    });
    return this.terminating;
  }

  private restart() {
    if (this.restarting) return this.restarting;
    const restarting = this.restartOnce();
    const flight = restarting.finally(() => {
      if (this.restarting === flight) this.restarting = null;
    });
    this.restarting = flight;
    return flight;
  }

  private async restartOnce() {
    if (this.terminating) await this.terminating;
    if (this.worker) await this.terminate(new Error("database worker restart"));
    const initialization = this.initialization;
    if (!initialization) throw new Error("database client is not initialized");
    this.spawn();
    await this.request(initialization);
  }

  private async mutate(command: MutationCommand): Promise<MutationOutcome<unknown>> {
    try {
      return await this.request(command);
    } catch (cause) {
      if (cause instanceof ChatDatabaseError) throw cause;
      try {
        await this.restart();
        const receipt = await this.request({
          kind: "get-operation-receipt",
          operationId: command.operationId,
        }) as MutationReceipt<unknown> | null;
        if (receipt) {
          if (receipt.requestHash !== command.requestHash) {
            throw new Error("operation receipt hash mismatch");
          }
          return { status: "committed", receipt };
        }
        return await this.request(command);
      } catch (recoveryCause) {
        return {
          status: "outcome_unknown",
          operationId: command.operationId,
          reason: recoveryCause instanceof Error
            ? recoveryCause.message
            : String(recoveryCause),
        };
      }
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    const worker = this.worker;
    if (!worker) {
      if (this.terminating) await this.terminating;
      return;
    }
    try {
      await this.request({ kind: "close" });
    } finally {
      await this.terminate(new Error("database client closed"));
    }
  }
}
