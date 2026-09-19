/**
 * [INPUT]: Depends on BaseStore mutation plans, existing causal enqueue and scoped tool receipts.
 * [OUTPUT]: Provides exact local replay checks and atomic tool provenance/outbox preparation.
 * [POS]: Pure tool transitions inside the existing BaseStore writer, without a second journal.
 */
import { sameScope } from "../../../../../shared/local-storage/contracts";
import type { StoredBase, BaseStoreMutation } from "../../base-store-model";
import { baseSyncEnvelopeSchema, type BaseSyncEnvelope } from "../sync/model";
import { enqueueBaseMutation } from "../sync/queue";
import { fieldKey, baseOperationFitsBudget } from "@ai-chat/cloud-protocol";
import { toolBatchReceiptSchema, type BaseToolIdentity } from "./model";

export function toolEvidence(sync: BaseSyncEnvelope, operationId: string) {
  const receipt = sync.receipts.find(item => item.operationId === operationId);
  const candidate = sync.conflictCandidates.find(item => item.operation.operationId === operationId);
  return structuredClone({ receipts: receipt ? [receipt] : [], conflictCandidates: candidate ? [candidate] : [] });
}

export function replayTool(state: StoredBase, identity: BaseToolIdentity) {
  const receipt = state.sync.toolBatches.find(item => item.operationId === identity.operationId);
  if (!receipt) return null;
  if (receipt.requestHash !== identity.requestHash || receipt.batchId !== identity.batchId) throw new Error("BASE_TOOL_PAYLOAD_CHANGED");
  if (receipt.scope && (!state.sync.scope || !sameScope(receipt.scope, state.sync.scope))) throw new Error("BASE_TOOL_SCOPE_CHANGED");
  return receipt;
}

export function prepareTool(state: StoredBase, mutation: BaseStoreMutation, identity: BaseToolIdentity,
  rejection: { status: "rejected" | "conflicted"; reason: string } | null) {
  if (state.sync.promotionExport) throw new Error("BASE_PROMOTION_IN_PROGRESS");
  let envelope: BaseSyncEnvelope = rejection ? state.sync : enqueueBaseMutation(state, mutation, false);
  const operation = envelope.pendingOperations.find(item => item.operationId === identity.operationId);
  if (operation && !baseOperationFitsBudget(operation)) throw Object.assign(new Error("Base tool atomic group exceeds its budget"), { status: 413, code: "atomic_group_budget" });
  const receipt = toolBatchReceiptSchema.parse({ ...identity, scope: state.sync.scope,
    targets: operation?.patches.map(fieldKey) ?? mutation.syncIntent?.patches?.map(fieldKey) ?? identity.targets ?? [],
    status: rejection?.status ?? "saved", reason: rejection?.reason ?? null, cloudOperation: Boolean(operation),
    revision: mutation.meta.revision, rowCount: mutation.rows.length });
  envelope = baseSyncEnvelopeSchema.parse({ ...envelope, toolBatches: [...envelope.toolBatches, receipt] });
  return { envelope, receipt };
}
