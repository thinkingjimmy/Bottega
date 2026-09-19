/**
 * [INPUT]: Depends on exact server candidate or receipt-only proof and the existing Base synchronization envelope.
 * [OUTPUT]: Imports account-authorized remote candidates and reconciles explicit cross-device dispositions without replaying successful fields.
 * [POS]: Pure BaseStore candidate transition; original payloads and superseded recovery attempts remain in the same generation.
 */
import { baseConflictLookupSchema, canonicalJson, fieldKey, type CloudBaseConflictLookup } from "@ai-chat/cloud-protocol";
import { baseSyncEnvelopeSchema, operationHash, type BaseSyncEnvelope, type PendingBaseOperation } from "../model";
import { captureCandidateContext } from "./context";
export function reconcileRemoteBaseCandidate(source: BaseSyncEnvelope, input: CloudBaseConflictLookup, resolutionOperationId: string | null) {
  const proof = baseConflictLookupSchema.parse(input);
  const existing = source.conflictCandidates.find(item => item.operation.operationId === proof.receipt.operationId);
  const original = proof.operation ?? existing?.operation;
  if (!original || !proof.operation && (!existing?.receipt || canonicalJson(existing.receipt) !== canonicalJson(proof.receipt))) throw new Error("BASE_REMOTE_CANDIDATE_INVALID");
  const operation: PendingBaseOperation = { ...original, sealed: true, attempts: 1, state: "queued" };
  const receipt = proof.receipt;
  if (!source.confirmed || operation.baseId !== source.baseId || operationHash(operation) !== operation.payloadHash ||
      receipt.operationId !== operation.operationId || receipt.payloadHash !== operation.payloadHash || receipt.results.length !== operation.patches.length ||
      receipt.results.some((result, index) => result.index !== index)) throw new Error("BASE_REMOTE_CANDIDATE_INVALID");
  if (receipt.cloudRevision > source.confirmed.cloudRevision || source.tombstones.includes("base") || source.promotionExport) return source;
  const indexes = proof.candidates.flatMap(candidate => candidate.indexes);
  if (new Set(indexes).size !== indexes.length || indexes.some(index => !operation.patches[index] || !["conflicted", "rejected"].includes(receipt.results[index]!.status))) {
    throw new Error("BASE_REMOTE_CANDIDATE_INVALID");
  }
  const localOnly = receipt.results.filter(result => ["conflicted", "rejected"].includes(result.status) && !indexes.includes(result.index));
  // Deleted targets retain their original local content; the server intentionally stores no candidate body for them.
  if (localOnly.some(result => result.reason !== "deleted")) throw new Error("BASE_REMOTE_CANDIDATE_INVALID");
  const remoteIndexes = proof.candidates.filter(candidate => candidate.state === "unresolved").flatMap(candidate => candidate.indexes);
  const unresolved = [...remoteIndexes, ...localOnly.map(result => result.index)].sort((a, b) => a - b);
  const envelope = structuredClone(source);
  const recorded = envelope.receipts.find(item => item.operationId === receipt.operationId);
  if (recorded && canonicalJson(recorded) !== canonicalJson(receipt)) throw new Error("BASE_RECEIPT_CHANGED");
  if (envelope.pendingOperations.some(item => item.operationId === operation.operationId)) return source;
  let candidate = envelope.conflictCandidates.find(item => item.operation.operationId === operation.operationId);
  if (!candidate) {
    if (!unresolved.length) return source;
    candidate = { operation, receipt, state: "unresolved", remoteResolved: false, blockedReason: null, currentValues: {}, resolutionOperationId: null, staleResolutions: [] };
    envelope.conflictCandidates.push(candidate);
  }
  if (candidate.operation.payloadHash !== operation.payloadHash || candidate.receipt && canonicalJson(candidate.receipt) !== canonicalJson(receipt)) throw new Error("BASE_REMOTE_CANDIDATE_INVALID");
  if (!candidate.recoveryContext && operation.patches.every(patch => !("target" in patch) || source.confirmed!.meta.columns.some(column => column.id === patch.target.columnId))) {
    try { candidate.recoveryContext = captureCandidateContext({ ...source, pendingOperations: [] }, operation); }
    catch { /* A rejected structural operation can lack the original schema; its exact candidate remains reviewable. */ }
  }
  if (resolutionOperationId !== candidate.resolutionOperationId) return source;
  if (candidate.resolutionOperationId && !proof.resolutionReceipt) {
    const pending = envelope.pendingOperations.find(item => item.operationId === candidate!.resolutionOperationId);
    if (pending && canonicalJson(pending.patches) !== canonicalJson(unresolved.map(index => operation.patches[index]))) {
      (candidate.staleResolutions ??= []).push(pending);
      envelope.pendingOperations = envelope.pendingOperations.filter(item => item !== pending);
      candidate.resolutionOperationId = null;
    }
  }
  if (!recorded) envelope.receipts.push(receipt);
  candidate.receipt = receipt; candidate.blockedReason = null;
  candidate.origin = { deviceId: proof.sourceDeviceId, deviceName: proof.sourceDeviceName, createdAt: proof.createdAt };
  candidate.unresolvedIndexes = unresolved;
  candidate.remoteResolved = remoteIndexes.length === 0;
  if (!unresolved.length && !candidate.resolutionOperationId) {
    candidate.remoteResolved = true;
    candidate.state = candidate.state === "discarded" ? "discarded" : proof.candidates.every(item => item.state === "applied") ? "applied" : "superseded";
  }
  for (const index of unresolved) candidate.currentValues[fieldKey(operation.patches[index]!)] ??= null;
  return baseSyncEnvelopeSchema.parse(envelope);
}
