/**
 * [INPUT]: Depends on confirmed field versions, pending column declarations, receipt-revision baselines and immutable hashes.
 * [OUTPUT]: Provides causal enqueue/compaction, sealed retries, exact predecessor rebasing and candidate recovery.
 * [POS]: Pure state transitions called only while BaseStore owns its leaf queue.
 */
import { randomUUID } from "node:crypto";
import type { BaseStoreMutation, StoredBase } from "../../base-store-model";
import { canonicalJson } from "../../../../../shared/local-storage/contracts";
import { baseReceiptSchema, baseSyncEnvelopeSchema, fieldKey, operationHash, pendingOperationSchema,
  type BaseOperationReceipt, type BasePatch, type BaseSyncEnvelope, type ConfirmedBase, type PendingBaseOperation } from "./model";
import { applyPatches, diffBase, projectBase, readPatchValue } from "./projection";

function columnsOf(patch: BasePatch): string[] {
  if ("target" in patch) return [patch.target.columnId];
  if (patch.kind === "create-row") return Object.keys(patch.row.values);
  if (patch.kind === "put-column") return [patch.column.id];
  if (patch.kind === "delete-column") return [patch.columnId];
  return [];
}
function changesColumn(patch: BasePatch) { return patch.kind === "put-column" || patch.kind === "delete-column"; }
function dependsOn(patch: BasePatch, previous: BasePatch) {
  return fieldKey(previous) === fieldKey(patch) ||
    columnsOf(previous).some(column => columnsOf(patch).includes(column)) && (changesColumn(previous) || changesColumn(patch)) ||
    "target" in patch && fieldKey(previous) === `row:${patch.target.rowId}` ||
    patch.kind === "set-order" && (patch.field === "columns" ? changesColumn(previous) : previous.kind === "put-view" || previous.kind === "delete-view");
}
export function enqueueBaseMutation(current: StoredBase, mutation: BaseStoreMutation, allowCompression = true): BaseSyncEnvelope {
  const source = current.sync;
  if (source.cloudState === "local-only") return source;
  if (source.tombstones.includes("base")) throw new Error("BASE_DELETED");
  if (source.cloudState === "mirror") throw new Error("Base is still preparing its local snapshot");
  if (mutation.operation === "app-data-migration") throw new Error("APP_MIGRATION_REQUIRES_ATOMIC_CLOUD_RECEIPT");
  const patches = mutation.syncIntent?.patches ?? diffBase(current, mutation);
  if (!patches.length) return source;
  const projected = applyPatches({ meta: current.meta, rows: current.rows }, patches, source.tombstones);
  if (canonicalJson(projected.rows) !== canonicalJson(mutation.rows) ||
      canonicalJson({ columns: projected.meta.columns, views: projected.meta.views, name: projected.meta.name, activeViewId: projected.meta.activeViewId }) !==
      canonicalJson({ columns: mutation.meta.columns, views: mutation.meta.views, name: mutation.meta.name, activeViewId: mutation.meta.activeViewId })) throw new Error("Base intent does not describe the committed mutation");
  const envelope = structuredClone(source);
  const confirmed = envelope.confirmed!;
  const dependencies = new Set<string>();
  const createdColumns = new Set([...patches, ...envelope.pendingOperations.filter(item => item.state === "queued").flatMap(item => item.patches)]
    .flatMap(item => item.kind === "put-column" ? [item.column.id] : []));
  const operation: PendingBaseOperation = {
    operationId: mutation.syncIntent?.operationId ?? randomUUID(), baseId: envelope.baseId,
    payloadHash: "", patches, schemaRevision: confirmed.schemaRevision, baseFieldVersions: {}, baseValues: {}, baseColumnSchemaVersions: {},
    dependsOnOperationIds: [], atomicGroup: mutation.syncIntent?.atomicGroup ?? null, batchId: mutation.syncIntent?.batchId ?? null,
    actor: mutation.actor === "agent" ? "agent" : mutation.actor === "system" ? "system" : "user",
    sealed: false, attempts: 0, state: "queued",
  };
  for (const patch of patches) {
    const key = fieldKey(patch);
    operation.baseFieldVersions[key] = confirmed.fieldVersions[key] ?? 0;
    operation.baseValues[key] = JSON.parse(JSON.stringify(readPatchValue(confirmed, patch)));
    for (const columnId of columnsOf(patch)) {
      const version = confirmed.columnSchemaVersions[columnId];
      if (version === undefined && patch.kind !== "put-column" && !createdColumns.has(columnId)) throw new Error("COLUMN_BASELINE_REQUIRED");
      operation.baseColumnSchemaVersions[columnId] = version ?? 0;
    }
    for (const previous of envelope.pendingOperations) {
      const related = previous.patches.some(item => dependsOn(patch, item));
      if (related) dependencies.add(previous.operationId);
    }
  }
  const previous = envelope.pendingOperations.at(-1);
  if (allowCompression && patches.length === 1 && ["set", "unset"].includes(patches[0]!.kind) && previous &&
      !previous.sealed && !previous.atomicGroup && !operation.atomicGroup && previous.patches.length === 1 &&
      previous.actor === operation.actor && previous.batchId === operation.batchId &&
      ["set", "unset"].includes(previous.patches[0]!.kind) && fieldKey(patches[0]!) === fieldKey(previous.patches[0]!) &&
      !envelope.pendingOperations.some(item => item.dependsOnOperationIds.includes(previous.operationId))) {
    previous.patches = patches;
    previous.payloadHash = operationHash(previous);
    return baseSyncEnvelopeSchema.parse(envelope);
  }
  operation.dependsOnOperationIds = [...dependencies];
  operation.payloadHash = operationHash(operation);
  if (envelope.pendingOperations.some(item => item.operationId === operation.operationId) || envelope.receipts.some(item => item.operationId === operation.operationId) ||
    envelope.conflictCandidates.some(item => item.operation.operationId === operation.operationId)) throw new Error("BASE_OPERATION_ID_REUSED");
  envelope.pendingOperations.push(pendingOperationSchema.parse(operation));
  return baseSyncEnvelopeSchema.parse(envelope);
}
export function sealBaseOperation(source: BaseSyncEnvelope, operationId: string) {
  const envelope = structuredClone(source);
  const operation = envelope.pendingOperations.find(item => item.operationId === operationId);
  if (!operation || operation.state !== "queued") throw new Error("Base operation is unavailable");
  if (operation.dependsOnOperationIds.some(id => !envelope.receipts.some(receipt => receipt.operationId === id && receipt.results.every(result => ["applied", "converged"].includes(result.status))))) throw new Error("BASE_CAUSAL_RECEIPT_REQUIRED");
  operation.sealed = true;
  operation.attempts += 1;
  return baseSyncEnvelopeSchema.parse(envelope);
}
export function reconcileBase(source: BaseSyncEnvelope, confirmed: ConfirmedBase, receipts: BaseOperationReceipt[], tombstones: string[], cursor: string) {
  if (!source.confirmed || confirmed.cloudRevision < source.confirmed.cloudRevision ||
    confirmed.meta.ownerInstanceId !== source.confirmed.meta.ownerInstanceId ||
    canonicalJson(confirmed.meta.owner) !== canonicalJson(source.confirmed.meta.owner)) throw new Error("BASE_CLOUD_REVISION_STALE");
  if (confirmed.cloudRevision === source.confirmed.cloudRevision && canonicalJson(confirmed) !== canonicalJson(source.confirmed)) throw new Error("BASE_CLOUD_REVISION_CONFLICT");
  if (source.pendingOperations.some(operation => operation.sealed && !receipts.some(receipt => receipt.operationId === operation.operationId) &&
    operation.patches.some(patch => patch.kind === "increment" && (confirmed.fieldVersions[fieldKey(patch)] ?? 0) !== (source.confirmed!.fieldVersions[fieldKey(patch)] ?? 0)))) {
    throw new Error("BASE_RECEIPT_REQUIRED_FOR_SEALED_INCREMENT");
  }
  const envelope = structuredClone(source);
  envelope.confirmed = structuredClone(confirmed);
  envelope.tombstones = [...new Set([...envelope.tombstones, ...tombstones])];
  envelope.cursor = cursor;
  for (const raw of receipts) {
    const receipt = baseReceiptSchema.parse(raw);
    const previous = envelope.receipts.find(item => item.operationId === receipt.operationId);
    if (previous) {
      if (canonicalJson(previous) !== canonicalJson(receipt)) throw new Error("BASE_RECEIPT_CHANGED");
      continue;
    }
    const operation = envelope.pendingOperations.find(item => item.operationId === receipt.operationId);
    if (!operation || !operation.sealed || operation.payloadHash !== receipt.payloadHash || receipt.cloudRevision > confirmed.cloudRevision ||
        receipt.results.length !== operation.patches.length || receipt.results.some((result, index) => result.index !== index)) throw new Error("BASE_RECEIPT_IDENTITY_MISMATCH");
    const successful = receipt.results.every(result => ["applied", "converged"].includes(result.status));
    const unsuccessful = receipt.results.every(result => ["conflicted", "rejected"].includes(result.status));
    if (operation.atomicGroup && !successful && !unsuccessful) throw new Error("BASE_ATOMIC_GROUP_PARTIAL_RECEIPT");
    envelope.receipts.push(receipt);
    envelope.pendingOperations = envelope.pendingOperations.filter(item => item !== operation);
    if (!successful) {
      envelope.conflictCandidates.push({ operation, receipt, blockedReason: null, state: "unresolved", resolutionOperationId: null,
        currentValues: Object.fromEntries(operation.patches.map(patch => [fieldKey(patch), JSON.parse(JSON.stringify(readPatchValue(confirmed, patch)))])) });
    }
    for (const dependent of envelope.pendingOperations) {
      if (!dependent.dependsOnOperationIds.includes(operation.operationId)) continue;
      if (!successful) { dependent.state = "blocked"; continue; }
      if (dependent.sealed) throw new Error("Causal successor was sent before its predecessor settled");
      // Only a snapshot at the receipt revision can stand in for its frozen result evidence.
      const baseline = receipt.baseline ?? (receipt.cloudRevision === confirmed.cloudRevision ? {
        schemaRevision: confirmed.schemaRevision, fieldVersions: confirmed.fieldVersions, columnSchemaVersions: confirmed.columnSchemaVersions,
        values: Object.fromEntries(dependent.patches.map(patch => [fieldKey(patch), readPatchValue(confirmed, patch)])),
      } : null);
      if (!baseline) throw new Error("BASE_RECEIPT_BASELINE_REQUIRED");
      for (const patch of dependent.patches) {
        const key = fieldKey(patch);
        if (operation.patches.some(item => fieldKey(item) === key || "target" in patch && item.kind === "create-row" && item.row.id === patch.target.rowId)) {
          if (!Object.hasOwn(baseline.values, key) || receipt.baseline && !Object.hasOwn(baseline.fieldVersions, key)) throw new Error("BASE_RECEIPT_BASELINE_REQUIRED");
          dependent.baseFieldVersions[key] = baseline.fieldVersions[key] ?? 0;
          dependent.baseValues[key] = JSON.parse(JSON.stringify(baseline.values[key]));
        }
        for (const column of columnsOf(patch)) {
          if (operation.patches.some(item => columnsOf(item).includes(column) && changesColumn(item))) {
            if (!Object.hasOwn(baseline.columnSchemaVersions, column)) throw new Error("BASE_RECEIPT_BASELINE_REQUIRED");
            dependent.baseColumnSchemaVersions[column] = baseline.columnSchemaVersions[column]!;
          }
        }
      }
      if (operation.patches.some(changesColumn)) dependent.schemaRevision = Math.max(dependent.schemaRevision, baseline.schemaRevision);
      dependent.payloadHash = operationHash(dependent);
    }
    for (const candidate of envelope.conflictCandidates) {
      if (candidate.resolutionOperationId === receipt.operationId && successful) candidate.state = "applied";
    }
  }
  for (const pending of envelope.pendingOperations) {
    if (envelope.tombstones.includes("base") || pending.patches.some(patch => envelope.tombstones.includes(fieldKey(patch)) || "target" in patch &&
      (envelope.tombstones.includes(`row:${patch.target.rowId}`) || envelope.tombstones.includes(`column:${patch.target.columnId}`)))) pending.state = "blocked";
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const pending of envelope.pendingOperations) if (pending.state !== "blocked" && pending.dependsOnOperationIds.some(id => envelope.pendingOperations.some(item => item.operationId === id && item.state === "blocked"))) {
      pending.state = "blocked"; changed = true;
    }
  }
  // Unsent successors need a recoverable local candidate, not a fabricated cloud rejection.
  for (const operation of envelope.pendingOperations.filter(item => item.state === "blocked" && !item.sealed)) {
    envelope.conflictCandidates.push({ operation, receipt: null, state: "unresolved", resolutionOperationId: null,
      blockedReason: operation.dependsOnOperationIds.length ? "dependency" : "tombstone",
      currentValues: Object.fromEntries(operation.patches.map(patch => [fieldKey(patch), JSON.parse(JSON.stringify(readPatchValue(confirmed, patch)))])) });
  }
  envelope.pendingOperations = envelope.pendingOperations.filter(item => item.state !== "blocked" || item.sealed);
  return baseSyncEnvelopeSchema.parse(envelope);
}
export function restoreBaseCandidate(source: StoredBase, candidateOperationId: string, operationId: string) {
  const candidate = source.sync.conflictCandidates.find(item => item.operation.operationId === candidateOperationId);
  if (!candidate || candidate.state !== "unresolved" || candidate.resolutionOperationId) throw new Error("Base candidate is unavailable");
  const patches = candidate.operation.patches.filter((_, index) => !candidate.receipt || ["conflicted", "rejected"].includes(candidate.receipt.results[index]!.status));
  if (patches.some(patch => source.sync.tombstones.includes(fieldKey(patch)) || "target" in patch && (
    source.sync.tombstones.includes(`row:${patch.target.rowId}`) || source.sync.tombstones.includes(`column:${patch.target.columnId}`)))) throw new Error("Deleted Base data cannot be restored in place");
  const projected = applyPatches({ meta: source.meta, rows: source.rows }, patches, source.sync.tombstones);
  const envelope = enqueueBaseMutation(source, { ...projected, changedRowIds: "all", syncIntent: { operationId, patches }, actor: "renderer" }, false);
  envelope.conflictCandidates.find(item => item.operation.operationId === candidateOperationId)!.resolutionOperationId = operationId;
  return { envelope, projected: projectBase(envelope) };
}
