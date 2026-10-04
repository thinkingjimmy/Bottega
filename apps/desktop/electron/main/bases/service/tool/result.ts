/**
 * [INPUT]: Depends on local tool commit evidence and the same Base pending/candidate/cloud receipts.
 * [OUTPUT]: Provides truthful per-field Agent outcomes, counts and failed-only recovery identities.
 * [POS]: Tool result projection; local durability never substitutes for a successful cloud receipt.
 */
import type { BaseSyncEnvelope } from "../../store/sync/model";
import type { BaseToolReceipt } from "../../store/tool/model";

export type ToolFieldStatus = "applied" | "converged" | "conflicted" | "rejected" | "pending-sync" | "local-only";
export function projectToolItem(local: BaseToolReceipt, sync: Pick<BaseSyncEnvelope, "receipts" | "conflictCandidates">) {
  const receipt = sync.receipts.find(item => item.operationId === local.operationId);
  const candidate = sync.conflictCandidates.find(item => item.operation.operationId === local.operationId);
  const fields = receipt ? receipt.results.map(result => ({ index: result.index,
    target: local.targets[result.index] ?? null, status: result.status as ToolFieldStatus, reason: result.reason })) :
    (local.targets.length ? local.targets : [null]).map((target, index) => ({ index, target,
      status: (local.status !== "saved" ? local.status : candidate ? "conflicted" : local.cloudOperation ? "pending-sync" : "local-only") as ToolFieldStatus,
      reason: local.reason ?? candidate?.blockedReason ?? null }));
  return { operationId: local.operationId, fields };
}
export function toolBatchResult(batchId: string, items: ReturnType<typeof projectToolItem>[], revision: number, rowCount: number) {
  const counts: Record<ToolFieldStatus, number> = { applied: 0, converged: 0, conflicted: 0, rejected: 0, "pending-sync": 0, "local-only": 0 };
  for (const item of items) for (const field of item.fields) counts[field.status] += 1;
  return { batchId, revision, rowCount, counts, items,
    cloudConfirmed: items.length > 0 && counts.applied + counts.converged === Object.values(counts).reduce((a, b) => a + b, 0),
    needsReviewOperationIds: items.filter(item => item.fields.some(field => ["conflicted", "rejected"].includes(field.status))).map(item => item.operationId),
    pendingOperationIds: items.filter(item => item.fields.some(field => field.status === "pending-sync")).map(item => item.operationId) };
}

export function boundedToolBatch(result: ReturnType<typeof toolBatchResult>, batchKey: string, offset: number, budget: number) {
  const page = { ...result, batchKey, items: [] as typeof result.items, resultOffset: offset,
    nextResultOffset: null as number | null, fieldCount: result.items.reduce((sum, item) => sum + item.fields.length, 0) };
  let index = 0;
  for (const item of result.items) {
    const projected = { operationId: item.operationId, fields: [] as typeof item.fields };
    for (const field of item.fields) {
      if (index++ < offset) continue;
      if (!projected.fields.length) page.items.push(projected);
      projected.fields.push(field); page.nextResultOffset = index < page.fieldCount ? index : null;
      if (Buffer.byteLength(JSON.stringify(page), "utf8") > budget) {
        projected.fields.pop(); if (!projected.fields.length) page.items.pop();
        if (!page.items.length) throw new Error("Base tool result exceeds its minimum page budget");
        page.nextResultOffset = index - 1; return page;
      }
    }
  }
  return page;
}
