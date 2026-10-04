/**
 * [INPUT]: Depends on node:crypto, the canonical JSON form and the Base synchronization envelope
 * [OUTPUT]: Provides RECEIPT_RETENTION and retainBaseReceipts, which folds proven-successful, unreferenced receipts and saved tool batches outside the replay window into a counted, digest-chained compaction proof
 * [POS]: OPT-16's retention set, run inside the Store writer after receipts are applied; before it, receipts and tool batches only grew until the envelope cap made every commit fail
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "../../../../../shared/local-storage/contracts";
import type { BaseSyncEnvelope } from "./model";

/** Compaction starts at `high` and keeps the newest `keep`; everything referenced is kept regardless of age. */
export const RECEIPT_RETENTION = Object.freeze({ receipts: { high: 4_000, keep: 2_000 }, toolBatches: { high: 8_000, keep: 4_000 } });

const successful = (receipt: BaseSyncEnvelope["receipts"][number]) => receipt.results.every(result => ["applied", "converged"].includes(result.status));

/**
 * Kept: every receipt a pending operation or a conflict candidate still depends on, every receipt that is not a proven
 * success (unknown and failed are never folded into a "satisfied" watermark), receipts behind a kept tool batch, and the
 * newest window. Kept tool batches: anything not saved, anything whose operation is still pending or in a candidate, and
 * the newest window (the replay deadline for a retried request). The proof counts what left and chains a digest of it.
 */
export function retainBaseReceipts(envelope: BaseSyncEnvelope, limits = RECEIPT_RETENTION): BaseSyncEnvelope {
  if (envelope.receipts.length <= limits.receipts.high && envelope.toolBatches.length <= limits.toolBatches.high) return envelope;
  const live = new Set([
    ...envelope.pendingOperations.flatMap(operation => [operation.operationId, ...operation.dependsOnOperationIds]),
    ...envelope.conflictCandidates.flatMap(candidate => [candidate.operation.operationId, ...candidate.operation.dependsOnOperationIds,
      ...(candidate.resolutionOperationId ? [candidate.resolutionOperationId] : [])]),
  ]);
  const toolBatches = envelope.toolBatches.length <= limits.toolBatches.high ? envelope.toolBatches : envelope.toolBatches.filter((batch, index) =>
    batch.status !== "saved" || live.has(batch.operationId) || index >= envelope.toolBatches.length - limits.toolBatches.keep);
  const keptTools = new Set(toolBatches.map(batch => batch.operationId));
  const receipts = envelope.receipts.length <= limits.receipts.high && toolBatches.length === envelope.toolBatches.length ? envelope.receipts
    : envelope.receipts.filter((receipt, index) => !successful(receipt) || live.has(receipt.operationId) || keptTools.has(receipt.operationId) ||
      index >= envelope.receipts.length - limits.receipts.keep);
  const droppedReceipts = envelope.receipts.filter(receipt => !receipts.includes(receipt));
  const droppedTools = envelope.toolBatches.filter(batch => !toolBatches.includes(batch));
  if (!droppedReceipts.length && !droppedTools.length) return envelope;
  const previous = envelope.receiptCompaction;
  const digest = createHash("sha256").update(canonicalJson([previous?.digest ?? null,
    droppedReceipts.map(receipt => [receipt.operationId, receipt.payloadHash, receipt.cloudRevision]), droppedTools.map(batch => batch.operationId)])).digest("hex");
  return { ...envelope, receipts, toolBatches, receiptCompaction: {
    receipts: (previous?.receipts ?? 0) + droppedReceipts.length, toolBatches: (previous?.toolBatches ?? 0) + droppedTools.length,
    throughCloudRevision: Math.max(previous?.throughCloudRevision ?? 0, ...droppedReceipts.map(receipt => receipt.cloudRevision)), digest } };
}
