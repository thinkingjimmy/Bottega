/**
 * [INPUT]: Depends on worker_threads/path, the closed database protocol, ChatSqliteConnection, ChatRepository, and typed schema errors
 * [OUTPUT]: Provides the sole node:sqlite/blob owner, startup reaping of interrupted imports, and the serial narrow-query/mutation dispatcher whose committed receipt is posted before cadence-bounded WAL/FTS maintenance runs on the same serial tail
 * [POS]: Process isolation boundary between Electron main and synchronous SQLite; it never accepts SQL text
 */

import type { MessagePort } from "node:worker_threads";
import { parentPort } from "node:worker_threads";
import { dirname } from "node:path";
import { ChatRepository } from "./chat-repository";
import { ChatSqliteConnection } from "./connection";
import {
  parseDatabaseRequest,
  type DatabaseCommand,
  type DatabaseRequest,
  type DatabaseResponse,
} from "./database-protocol";
import { failureOf } from "./failure";
import { chatImportBlobsRoot } from "./paths";

/* WAL 高水位探测要两次 stat() 加 pragma。每条提交都问一遍，代价就压在
   每一次 turn 上；32 次一问，水位离 64 MiB 仍有几个数量级的余地。 */
const WAL_PROBE_MUTATIONS = 32;
const IMPORT_MAINTENANCE_BATCHES = 16;

class DatabaseWorkerRuntime {
  private connection: ChatSqliteConnection | null = null;
  private repository: ChatRepository | null = null;
  private importBatchesSinceCheckpoint = 0;
  private mutationsSinceWalProbe = 0;
  private pendingMaintenance: (() => Promise<void>) | null = null;

  /* 回执先走，维护后跑：维护仍串在 worker 的 tail 上（下一条命令排在它
     之后），只是不再由它替一次已提交的 turn 扛住客户端超时。 */
  takeMaintenance() {
    const maintenance = this.pendingMaintenance;
    this.pendingMaintenance = null;
    return maintenance;
  }

  private deferAfterCommit(
    outcome: { status?: unknown },
    label: string,
    run: () => void | Promise<unknown>
  ) {
    if (outcome.status !== "committed") return;
    this.pendingMaintenance = async () => {
      try { await run(); }
      catch (cause) { console.warn(`[chat-sqlite] deferred ${label}`, cause); }
    };
  }

  private mutated<T extends { status?: unknown }>(outcome: T): T {
    if (outcome.status !== "committed") return outcome;
    this.mutationsSinceWalProbe += 1;
    if (this.mutationsSinceWalProbe < WAL_PROBE_MUTATIONS) return outcome;
    this.mutationsSinceWalProbe = 0;
    this.deferAfterCommit(outcome, "WAL checkpoint", () => this.connection!.maybeCheckpoint());
    return outcome;
  }

  async execute(command: DatabaseCommand): Promise<unknown> {
    if (command.kind === "initialize") {
      if (this.connection) throw new Error("database worker is already initialized");
      const startedAt = performance.now();
      this.connection = await ChatSqliteConnection.open(command.databasePath, command.mode);
      this.repository = new ChatRepository(this.connection.database, Date.now, {
        importBlobsRoot: chatImportBlobsRoot(dirname(command.databasePath)),
      });
      const version = this.connection.database
        .prepare("SELECT sqlite_version() version")
        .get() as { version: string };
      const compileOptions = this.connection.database
        .prepare("PRAGMA compile_options")
        .all()
        .map((row) => String(Object.values(row as Record<string, unknown>)[0]));
      /* 收尸先于开门：上一次运行留下的 running/building 残骸会让整库投影
         抛错，也会把 FTS 的 automerge 永远按在 0。 */
      this.repository.reapInterruptedHistoryImports();
      this.connection.startupGate();
      return {
        sqliteVersion: version.version,
        compileOptions,
        startupMs: performance.now() - startedAt,
      };
    }
    if (!this.connection || !this.repository) {
      throw new Error("database worker is not initialized");
    }
    const repository = this.repository;
    switch (command.kind) {
      case "list-metadata": return repository.listMetadata(command.deviceId, command.chatId);
      case "get-record": return repository.getRecord(command.chatId, command.deviceId);
      case "get-native-message": return repository.getNativeMessage(command);
      case "get-native-messages": return repository.getNativeMessages(command);
      case "get-native-subagents": return repository.getNativeSubagents(command);
      case "get-timeline-page": return repository.getTimelinePage(command.input, command.deviceId);
      case "get-timeline-around": return repository.getTimelineAround(command.input, command.deviceId);
      case "get-outline-page": return repository.getOutlinePage(command.chatId, command.cursor, command.limit, command.deviceId);
      case "find-messages": return repository.findMessages(command);
      case "upsert-record": return this.mutated(repository.upsertRecord(command));
      case "update-chat-facts": return this.mutated(repository.updateChatFacts(command));
      case "append-message": return this.mutated(repository.appendMessage(command));
      case "commit-turn": return this.mutated(repository.commitTurn(command));
      case "update-readonly-presentation": return this.mutated(repository.updateReadonlyPresentation(command));
      case "remove-record": return this.mutated(repository.removeRecord(command));
      case "get-operation-receipt": return repository.getOperationReceipt(command.operationId);
      case "list-attachment-ids": return repository.listAttachmentIds();
      case "has-attachment-reference": return repository.hasAttachmentReference(command.chatId, command.attachmentId, command.deviceId);
      case "get-attachment-reference": return repository.getAttachmentReference(command.chatId, command.attachmentId, command.deviceId);
      case "list-memory-summaries": return repository.listMemorySummaries(command.deviceId);
      case "get-memory-native-segment": return repository.getMemoryNativeSegment(command);
      case "search-documents": return repository.searchDocuments(command);
      case "begin-history-import": return repository.beginHistoryImport(command);
      case "append-history-import-batch": {
        const result = repository.appendHistoryImportBatch(command);
        this.importBatchesSinceCheckpoint += 1;
        if (this.importBatchesSinceCheckpoint >= IMPORT_MAINTENANCE_BATCHES) {
          this.importBatchesSinceCheckpoint = 0;
          this.deferAfterCommit(result, "bounded FTS merge and WAL checkpoint", async () => {
            repository.mergeHistoryImportSearchIndex(256);
            await this.connection!.maybeCheckpoint();
          });
        }
        return result;
      }
      case "finalize-history-import": {
        const result = repository.finalizeHistoryImport(command);
        this.importBatchesSinceCheckpoint = 0;
        this.mutationsSinceWalProbe = 0;
        this.deferAfterCommit(result, "final WAL checkpoint", () => this.connection!.checkpoint("TRUNCATE"));
        return result;
      }
      case "cancel-history-import": return repository.cancelHistoryImport(command);
      case "mark-import-source-status": return repository.markImportSourceStatus(command);
      case "get-history-import-run": return repository.getHistoryImportRun(command.runId);
      case "begin-continuation-saga": return repository.beginContinuationSaga(command);
      case "mark-continuation-home-preparing": return repository.markContinuationHomePreparing(command);
      case "record-continuation-home-committed": return repository.recordContinuationHomeCommitted(command);
      case "finalize-continuation-saga": return repository.finalizeContinuationSaga(command);
      case "fail-continuation-precommit": return repository.failContinuationPrecommit(command);
      case "isolate-continuation-orphan": return repository.isolateContinuationOrphan(command);
      case "list-reconcilable-continuations": return repository.listReconcilableContinuations();
      case "maintenance-gate": {
        repository.mergeHistoryImportSearchIndex(4_096);
        const sourceProjection = repository.validateSearchProjection();
        const result = { ...this.connection.maintenanceGate(), sourceProjection };
        await this.connection.checkpoint("TRUNCATE");
        return result;
      }
      case "close": {
        await this.connection.closeAndFlush();
        this.connection = null;
        this.repository = null;
        return { closed: true };
      }
      default: {
        command satisfies never;
        throw new Error("Unknown database command");
      }
    }
  }
}

export function installDatabaseWorker(port: MessagePort) {
  const runtime = new DatabaseWorkerRuntime();
  let tail = Promise.resolve();
  port.on("message", (raw: unknown) => {
    tail = tail.then(async () => {
      let request: DatabaseRequest;
      try {
        request = parseDatabaseRequest(raw);
      } catch (cause) {
        const requestId = typeof raw === "object" && raw && "requestId" in raw
          ? String((raw as { requestId: unknown }).requestId)
          : "invalid";
        port.postMessage({
          protocolVersion: 1,
          requestId,
          ok: false,
          failure: { kind: "protocol", message: cause instanceof Error ? cause.message : String(cause) },
        } satisfies DatabaseResponse);
        return;
      }
      try {
        const result = await runtime.execute(request.command);
        port.postMessage({ protocolVersion: 1, requestId: request.requestId, ok: true, result } satisfies DatabaseResponse);
        if (request.command.kind === "close") port.close();
      } catch (cause) {
        runtime.takeMaintenance();
        port.postMessage({
          protocolVersion: 1,
          requestId: request.requestId,
          ok: false,
          failure: failureOf(cause),
        } satisfies DatabaseResponse);
        return;
      }
      await runtime.takeMaintenance()?.();
    });
  });
  port.start();
}

if (parentPort) installDatabaseWorker(parentPort);
