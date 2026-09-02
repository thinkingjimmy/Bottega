/**
 * [INPUT]: Depends on the typed SQLite client, immutable import normalization, AbortSignal, and array or AsyncIterable external source batches
 * [OUTPUT]: Replays, resumes, reports durable progress, cancels the run between receipts on abort or failure, and finalizes one deterministic external-history generation carrying the parser\u2019s own incompleteTail verdict, with one byte/count-bounded batch policy and backpressure
 * [POS]: Main-process import pump between parser and DB workers; it never buffers the complete normalized source
 */

import { createHash } from "node:crypto";
import type { ForeignHistoryBlock } from "../../../../shared/history-import-ipc";
import type { ChatDatabaseClient } from "../sqlite/database-client";
import type {
  DatabaseResults,
  HistoryImportSource,
  PreparedHistoryImportBatch,
} from "../sqlite/database-protocol";
import {
  boundedHistoryImportBatches,
  normalizeHistoryBlocks,
} from "../sqlite/import/normalization";
import {
  advanceImportDigest,
  EMPTY_IMPORT_DIGEST,
} from "../sqlite/repository/imports";
import type { HistoryImportEntryInput } from "../sqlite/database-protocol";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

type HistoryImportRun = NonNullable<DatabaseResults["get-history-import-run"]>;
type HistorySyncInput = Parameters<typeof syncExternalHistory>[0];

function requireCommitted<T>(
  outcome: import("../sqlite/database-protocol").MutationOutcome<T>
) {
  if (outcome.status === "committed") return outcome.receipt.result;
  if (outcome.status === "outcome_unknown") {
    throw Object.assign(new Error(outcome.reason), {
      status: outcome.status,
      operationId: outcome.operationId,
    });
  }
  throw new Error(outcome.failure.message);
}

export async function syncExternalHistory(input: {
  database: ChatDatabaseClient;
  deviceId: string;
  source: HistoryImportSource;
  blocks:
    | readonly ForeignHistoryBlock[]
    | AsyncIterable<readonly ForeignHistoryBlock[] | PreparedHistoryImportBatch>;
  signal?: AbortSignal;
  clock?: () => number;
  onProgress?(value: Readonly<{
    committedEntryCount: number;
    committedBytes: number;
    committedBatches: number;
    transactionDurationMs: number;
    batchRoundTripMs: number;
  }>): void;
}) {
  input.signal?.throwIfAborted();
  const clock = input.clock ?? performance.now.bind(performance);
  const sourceKey = digest({
    version: 1,
    sourceKind: input.source.sourceKind,
    storageFingerprint: input.source.storageFingerprint,
    canonicalNativeId: input.source.canonicalNativeId,
    historyRevision: input.source.historyRevision,
  }).slice(0, 40);
  const beginCommand = {
    kind: "begin-history-import" as const,
    operationId: `history_begin_${sourceKey}`,
    deviceId: input.deviceId,
    source: input.source,
  };
  const begun = requireCommitted(await input.database.execute({
    ...beginCommand,
    requestHash: digest(beginCommand),
  }));
  input.signal?.throwIfAborted();
  const run = await input.database.execute({
    kind: "get-history-import-run",
    runId: begun.runId,
  });
  input.signal?.throwIfAborted();
  if (!run) throw new Error("History import run disappeared after begin receipt");
  if (run.state === "cancelled" || run.state === "failed") {
    throw new Error(`History import run is ${run.state}`);
  }
  if (run.state === "completed") {
    return {
      runId: run.runId,
      chatId: run.chatId,
      generationId: begun.generationId,
      supersededGenerationId: null,
    };
  }
  /* begin 之后、finalize 之前的任何一次失败都必须把 run 收掉：留一条
     running 的 run 在账本里，FTS 的 automerge 就被永远按在 0，而下一次
     扫描只会撞上「另一个版本正在导入」。崩溃那一路由启动 reaper 兜底。 */
  try {
    return await pumpBatches(input, run, clock, sourceKey);
  } catch (cause) {
    await cancelRun(input.database, run.runId, cause);
    throw cause;
  }
}

async function cancelRun(
  database: ChatDatabaseClient,
  runId: string,
  cause: unknown
) {
  const command = {
    kind: "cancel-history-import" as const,
    operationId: `history_cancel_${runId}`,
    runId,
    reason: (cause instanceof Error ? cause.message : String(cause)).slice(0, 500),
  };
  // 收尸失败不改判死因：原来的错误才是要报给上层的那一个。
  await database.execute({ ...command, requestHash: digest(command) })
    .catch(() => undefined);
}

async function pumpBatches(
  input: HistorySyncInput,
  run: HistoryImportRun,
  clock: () => number,
  sourceKey: string
) {
  const nextBatch = run.cursor === null ? 0 : Number(run.cursor);
  if (!Number.isSafeInteger(nextBatch) || nextBatch < 0) {
    throw new Error("History import cursor is invalid for the current source batches");
  }
  let rollingDigest = EMPTY_IMPORT_DIGEST;
  let committedEntryCount = 0;
  let committedBytes = 0;
  let index = 0;
  let lastDeliverySeq = 0;
  let checkpointVerified = false;
  const verifyCheckpoint = () => {
    if (
      rollingDigest !== run.rollingDigest ||
      committedEntryCount !== run.committedEntryCount ||
      committedBytes !== run.committedBytes
    ) {
      throw new Error("History import checkpoint does not match normalized source data");
    }
    checkpointVerified = true;
  };
  /* 手动驱动而不是 for await：解析器把整条源读完之后的那句判词就藏在
     generator 的返回值里，for await 会把它连同 done 一起丢掉——扫描期抽读
     几 KB 得出的猜测于是永远压过真正读完的人。 */
  const batches = normalizedBatches(input.blocks, input.signal);
  let parserIncompleteTail: boolean | null = null;
  try {
    for (;;) {
      const next = await batches.next();
      if (next.done) {
        parserIncompleteTail = next.value;
        break;
      }
      const batch = next.value;
      input.signal?.throwIfAborted();
      const firstSeq = batch[0]?.deliverySeq ?? lastDeliverySeq;
      if (firstSeq <= lastDeliverySeq) {
        throw new Error("History source delivery sequence changed across parser batches");
      }
      lastDeliverySeq = batch.at(-1)?.deliverySeq ?? lastDeliverySeq;
      if (index < nextBatch) {
        rollingDigest = advanceImportDigest(rollingDigest, batch);
        committedEntryCount += batch.length;
        committedBytes += batch.reduce(
          (sum, entry) => sum + Buffer.byteLength(entry.content, "utf8"),
          0
        );
        index += 1;
        continue;
      }
      if (!checkpointVerified) verifyCheckpoint();
      const command = {
        kind: "append-history-import-batch" as const,
        operationId: `history_batch_${sourceKey}_${index + 1}`,
        runId: run.runId,
        sourceRevision: input.source.historyRevision,
        expectedCursor: index === 0 ? null : String(index),
        expectedRollingDigest: rollingDigest,
        nextCursor: String(index + 1),
        entries: batch,
      };
      const startedAt = clock();
      const response = await input.database.execute({
        ...command,
        requestHash: digest(command),
      });
      const batchRoundTripMs = clock() - startedAt;
      const appended = requireCommitted(response);
      const durationMs = response.transactionDurationMs ?? batchRoundTripMs;
      ({ rollingDigest, committedEntryCount, committedBytes } = appended);
      index += 1;
      input.onProgress?.({
        committedEntryCount,
        committedBytes,
        committedBatches: index,
        transactionDurationMs: durationMs,
        batchRoundTripMs,
      });
      input.signal?.throwIfAborted();
    }
  } finally {
    await batches.return(null).catch(() => undefined);
  }
  if (index < nextBatch) {
    throw new Error("History import cursor exceeds the current source batches");
  }
  if (!checkpointVerified) verifyCheckpoint();
  input.signal?.throwIfAborted();
  const finalizeCommand = {
    kind: "finalize-history-import" as const,
    operationId: `history_finalize_${sourceKey}`,
    runId: run.runId,
    expectedEntryCount: committedEntryCount,
    expectedByteSize: committedBytes,
    expectedRollingDigest: rollingDigest,
    ...(parserIncompleteTail === null ? {} : { incompleteTail: parserIncompleteTail }),
  };
  const finalized = requireCommitted(await input.database.execute({
    ...finalizeCommand,
    requestHash: digest(finalizeCommand),
  }));
  return finalized;
}

/* 返回值是解析器读完整条源之后的 incompleteTail 判词；数组来源没有解析器，
   自然也没有判词，返回 null。 */
async function* normalizedBatches(
  blocks:
    | readonly ForeignHistoryBlock[]
    | AsyncIterable<readonly ForeignHistoryBlock[] | PreparedHistoryImportBatch>,
  signal?: AbortSignal
): AsyncGenerator<HistoryImportEntryInput[], boolean | null, void> {
  signal?.throwIfAborted();
  if (!isAsyncBlocks(blocks)) {
    for (const batch of boundedHistoryImportBatches(normalizeHistoryBlocks(blocks))) {
      signal?.throwIfAborted();
      yield batch;
    }
    return null;
  }
  const source = blocks[Symbol.asyncIterator]();
  try {
    for (;;) {
      signal?.throwIfAborted();
      const next = await source.next();
      if (next.done) return typeof next.value === "boolean" ? next.value : null;
      const entries = isPreparedBatch(next.value)
        ? next.value.entries
        : normalizeHistoryBlocks(next.value);
      for (const batch of boundedHistoryImportBatches(entries)) {
        signal?.throwIfAborted();
        yield batch;
      }
    }
  } finally {
    await source.return?.(null);
  }
}

function isPreparedBatch(
  value: readonly ForeignHistoryBlock[] | PreparedHistoryImportBatch
): value is PreparedHistoryImportBatch {
  return !Array.isArray(value) &&
    (value as PreparedHistoryImportBatch).kind === "prepared-history-import";
}

function isAsyncBlocks(
  value: readonly ForeignHistoryBlock[] |
    AsyncIterable<readonly ForeignHistoryBlock[] | PreparedHistoryImportBatch>
): value is AsyncIterable<readonly ForeignHistoryBlock[] | PreparedHistoryImportBatch> {
  return typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator]
    === "function";
}
