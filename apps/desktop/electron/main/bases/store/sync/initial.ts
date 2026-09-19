/**
 * [INPUT]: Depends on an actual empty cloud baseline, current local Base data and the existing causal enqueue kernel.
 * [OUTPUT]: Captures initial records as bounded immutable-intent batches while preserving visible local data.
 * [POS]: Pure first-sync planner called under BaseStore's sole writer; no provisional cloud confirmation is fabricated.
 */
import { createHash } from "node:crypto";
import { baseOperationFitsBudget, canonicalJson, CLOUD_LIMITS, type BasePatch } from "@ai-chat/cloud-protocol";
import { logicalBaseSnapshot } from "@ai-chat/base-ui/metadata/logical-snapshot";
import type { StoredBase } from "../../base-store-model";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import { storageIdSchema } from "../../../../../shared/local-storage/contracts";
import { baseSyncEnvelopeSchema, nativeBaseOperation, type BaseSyncEnvelope, type ConfirmedBase } from "./model";
import { applyPatches, diffBase, projectBase } from "./projection";
import { enqueueBaseMutation } from "./queue";

export function captureInitialBase(current: StoredBase, confirmed: ConfirmedBase, scope: SyncScope, manifestId: string): BaseSyncEnvelope {
  storageIdSchema.parse(manifestId);
  if (confirmed.cloudRevision !== 0 || confirmed.rows.length || Object.keys(confirmed.rowVersions).length ||
    confirmed.meta.ownerInstanceId !== current.meta.ownerInstanceId || canonicalJson(confirmed.meta.owner) !== canonicalJson(current.meta.owner)) {
    throw new Error("BASE_INITIAL_CLOUD_IDENTITY_CONFLICT");
  }
  if (canonicalJson(confirmed.meta.navigation) !== canonicalJson(current.meta.navigation)) throw new Error("BASE_INITIAL_NAVIGATION_CHANGED");
  let envelope = baseSyncEnvelopeSchema.parse({ ...current.sync, cloudState: "synced", scope, confirmed });
  const relationColumns = new Set(current.meta.columns.filter(column => column.type === "relation").map(column => column.id));
  const deferred: BasePatch[] = [];
  const rows = current.rows.map(row => {
    const values = { ...row.values };
    for (const columnId of relationColumns) if (values[columnId] !== undefined) {
      deferred.push({ kind: "set", target: { rowId: row.id, columnId }, value: values[columnId]! }); delete values[columnId];
    }
    return { ...row, values };
  });
  const creation = diffBase({ meta: confirmed.meta, rowsById: new Map() }, { meta: current.meta, rows, changedRowIds: "all" });
  const patches = [...creation, ...deferred];
  const append = (batch: BasePatch[]) => {
    const before = projectBase(envelope), after = applyPatches(before, batch, []);
    const operationId = createHash("sha256").update(canonicalJson({ manifestId, baseId: envelope.baseId, batch: envelope.pendingOperations.length })).digest("hex");
    const next = enqueueBaseMutation({ ...before, rowsById: new Map(before.rows.map(row => [row.id, row])), sync: envelope }, {
      ...after, changedRowIds: "all", actor: "system", syncIntent: { operationId, batchId: manifestId, patches: batch },
    }, false);
    const wire = nativeBaseOperation(next.pendingOperations.at(-1)!);
    if (!baseOperationFitsBudget(wire)) {
      if (batch.length === 1) throw new Error("BASE_INITIAL_OPERATION_TOO_LARGE");
      const middle = Math.floor(batch.length / 2); append(batch.slice(0, middle)); append(batch.slice(middle)); return;
    }
    envelope = next;
  };
  let batch: BasePatch[] = [], fields = 0, bytes = 0;
  for (const [index, patch] of patches.entries()) {
    // Relation writes depend on durable creation receipts, including small first-sync batches.
    if (index === creation.length && batch.length) { append(batch); batch = []; fields = 0; bytes = 0; }
    const size = Buffer.byteLength(canonicalJson(patch)), count = patch.kind === "create-row" ? Math.max(1, Object.keys(patch.row.values).length) : 1;
    if (batch.length && (fields + count > CLOUD_LIMITS.maxOperationFields || bytes + size > CLOUD_LIMITS.maxOperationBytes / 2)) {
      append(batch); batch = []; fields = 0; bytes = 0;
    }
    batch.push(patch); fields += count; bytes += size;
  }
  if (batch.length) append(batch);
  if (canonicalJson(logicalBaseSnapshot(projectBase(envelope))) !== canonicalJson(logicalBaseSnapshot(current))) {
    throw new Error("BASE_INITIAL_PROJECTION_CHANGED");
  }
  return envelope;
}
