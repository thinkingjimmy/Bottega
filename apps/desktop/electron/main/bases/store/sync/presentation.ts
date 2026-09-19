/**
 * [INPUT]: Depends on the existing immutable Base envelope, confirmed field values and shared bounded presentation schemas.
 * [OUTPUT]: Projects source-aware candidate summaries, discovery completeness, copy destinations and paged before/current/proposed comparisons without cloning the full Base.
 * [POS]: Read-only BaseStore leaf; operation bodies and attachment custody remain with the existing writer.
 */
import { baseCandidateDetailSchema, baseCandidateSummarySchema } from "@ai-chat/base-ui/sync/model";
import type { BasePatch } from "@ai-chat/cloud-protocol";
import { candidatePatchIndexes, fieldKey, isBasePatchDeleted, type BaseSyncEnvelope } from "./model";
import { readPatchValue } from "./projection";
type Candidate = BaseSyncEnvelope["conflictCandidates"][number];
const failedIndexes = candidatePatchIndexes;
function summary(envelope: BaseSyncEnvelope, candidate: Candidate) {
  const indexes = failedIndexes(candidate), waiting = candidate.resolutionOperationId !== null;
  const removed = indexes.some(index => isBasePatchDeleted(envelope.tombstones, candidate.operation.patches[index]!));
  const protectedStructure = envelope.confirmed?.meta.navigation.kind === "internal-app" && indexes.some(index =>
    ["put-column", "delete-column", "set-column-field"].includes(candidate.operation.patches[index]!.kind));
  return baseCandidateSummarySchema.parse({ operationId: candidate.operation.operationId, payloadHash: candidate.operation.payloadHash,
    fieldCount: indexes.length, actor: candidate.operation.actor, waiting, blocked: removed ? "tombstone" : protectedStructure ? "app-structure" : candidate.blockedReason,
    canCopy: removed && !waiting && !!candidate.recoveryContext && !candidate.copiedTo && !envelope.promotionExport,
    ...(candidate.recoveryContext ? { copyName: candidate.copyRequest?.name ?? candidate.recoveryContext.meta.name.slice(0, 100), copyRequested: !!candidate.copyRequest } : {}),
    ...(candidate.copiedTo ? { copiedTo: { ownerKey: `project:${candidate.copiedTo.projectId}`, baseId: candidate.copiedTo.baseId } } : {}),
    canRestore: !waiting && !removed && !protectedStructure && !envelope.promotionExport, sourceDeviceId: candidate.origin?.deviceId ?? null,
    sourceDeviceName: candidate.origin?.deviceName ?? null, createdAt: candidate.origin?.createdAt ?? null });
}
export function projectBaseSyncReview(envelope: BaseSyncEnvelope, afterId: string | null) {
  const candidates = envelope.conflictCandidates.filter(item => item.state === "unresolved");
  const page = candidates.filter(item => afterId === null || item.operation.operationId > afterId)
    .sort((a, b) => a.operation.operationId < b.operation.operationId ? -1 : 1).slice(0, 11);
  const pending = envelope.pendingOperations.length + (envelope.tombstones.includes("base") ? 0 :
    envelope.conflictCandidates.filter(item => item.state === "discarded" && item.receipt && !item.remoteResolved).length);
  return { baseId: envelope.baseId, state: envelope.tombstones.includes("base") ? "deleted" as const :
    envelope.promotionExport ? "moving" as const :
    candidates.some(item => !item.resolutionOperationId) ? "conflicted" as const : pending ? "pending" as const : "synced" as const,
    pending, conflicts: candidates.length, complete: envelope.candidateDiscovery?.complete ?? false, items: page.slice(0, 10).map(item => summary(envelope, item)),
    cursor: page.length > 10 ? page[9]!.operation.operationId : null };
}
function display(value: unknown) {
  if (value === undefined || value === null) return { text: "—", truncated: false };
  const text = typeof value === "string" ? value : JSON.stringify(value), chars = Array.from(text);
  return { text: chars.slice(0, 512).join(""), truncated: chars.length > 512 };
}
function proposed(patch: BasePatch, original: unknown) {
  if ("value" in patch) return patch.value;
  if (patch.kind === "increment") return typeof original === "number" ? original + patch.amount : null;
  if (patch.kind === "put-column") return patch.column;
  if (patch.kind === "put-view") return patch.view;
  if (patch.kind === "create-row") return patch.row;
  if (patch.kind === "set-order") return patch.ids;
  return null;
}
export function projectBaseCandidate(envelope: BaseSyncEnvelope, operationId: string, offset: number) {
  const candidate = envelope.conflictCandidates.find(item => item.operation.operationId === operationId && item.state === "unresolved");
  if (!candidate || !envelope.confirmed) throw new Error("BASE_CANDIDATE_UNAVAILABLE");
  const indexes = failedIndexes(candidate);
  if (offset < 0 || offset >= indexes.length && offset !== 0) throw new Error("BASE_CANDIDATE_CURSOR_INVALID");
  const fields = indexes.slice(offset, offset + 20).map(index => {
    const patch = candidate.operation.patches[index]!, key = fieldKey(patch);
    const columnId = "target" in patch ? patch.target.columnId : "columnId" in patch ? patch.columnId : "column" in patch ? patch.column.id : null;
    const viewId = "viewId" in patch ? patch.viewId : "view" in patch ? patch.view.id : null;
    const label = envelope.confirmed!.meta.columns.find(column => column.id === columnId)?.name ??
      envelope.confirmed!.meta.views.find(view => view.id === viewId)?.name ?? "";
    return { index, label: label.slice(0, 256), rowId: "target" in patch ? patch.target.rowId : "rowId" in patch ? patch.rowId : "row" in patch ? patch.row.id : null,
      original: display(candidate.operation.baseValues[key]), current: display(readPatchValue(envelope.confirmed!, patch)),
      proposed: display(proposed(patch, candidate.operation.baseValues[key])) };
  });
  return baseCandidateDetailSchema.parse({ candidate: summary(envelope, candidate), fields, offset,
    nextOffset: offset + fields.length < indexes.length ? offset + fields.length : null });
}
