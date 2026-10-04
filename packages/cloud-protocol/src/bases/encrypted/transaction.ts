/**
 * [INPUT]: One bounded encrypted state snapshot, immutable ciphertext commit and explicit file/dependency decisions.
 * [OUTPUT]: Deterministic field CAS results, deletion-dominant tombstones, persistent candidate plans and immutable receipts.
 * [POS]: Pure server transaction kernel; it never decrypts or interprets a Base value.
 */
import { assertCrypto } from "../../encryption";
import { encryptedBaseHeadSchema, encryptedBaseRowSchema, encryptedBaseReceiptSchema, type BaseCipherIntent, type EncryptedBaseCommit, type EncryptedBaseReceipt, type BaseCipherTarget } from "./model";
import { baseTargetKey, canonicalCipherJson } from "./wire";
import { projectEncryptedTarget, removeEncryptedTarget, replaceEncryptedField, targetDeleted, targetVersion, type EncryptedBaseState } from "./state";
type Patch = BaseCipherIntent["patches"][number];
type Outcome = EncryptedBaseReceipt["results"][number];
function structuralPatch(patch: Patch) {
  return ["put-column", "delete-column", "put-view", "delete-view"].includes(patch.kind) || patch.target.kind === "column-field" &&
    (patch.target.path[0] === "relation" || patch.target.path[0] === "options" && patch.target.path.length === 2);
}
function relevantCondition(patch: Patch, target: BaseCipherTarget) {
  const key = baseTargetKey(target), own = baseTargetKey(patch.target);
  return own.startsWith(`${key}:`) || patch.derivedTargets.some(derived => baseTargetKey(derived) === key);
}
function decide(state: EncryptedBaseState, commit: EncryptedBaseCommit, patch: Patch, reject?: Outcome["reason"]): Outcome {
  const result = (status: Outcome["status"], reason: Outcome["reason"] = null): Outcome => ({ index: patch.index, status, reason });
  const target = patch.target, deletion = patch.deletesTarget;
  if (targetDeleted(state, target)) return result(deletion ? "converged" : "rejected", "deleted");
  for (const derived of patch.derivedTargets) if (targetDeleted(state, derived) &&
    !patch.derivedDeletions.some(target => baseTargetKey(target) === baseTargetKey(derived))) {
    return result("rejected", derived.kind === "view" ? "deleted-view" : "deleted");
  }
  if (reject) return result("rejected", reject);
  if (state.head.authority.navigation.kind === "internal-app" && ["put-column", "delete-column", "set-column-field"].includes(patch.kind)) return result("rejected", "app-structure-readonly");
  if ((structuralPatch(patch) || patch.kind === "set-order") && commit.intent.structuralGeneration !== state.head.structuralGeneration) return result("conflicted", "structure-changed");
  if (commit.intent.preconditions.some(condition => relevantCondition(patch, condition.target) && targetVersion(state, condition.target) !== condition.version)) return result("conflicted", "field-changed");
  if (target.kind === "cell") {
    const row = state.rows.find(row => row.rowId === target.rowId);
    if (!row || !state.head.authority.columnIds.includes(target.columnId)) return result("rejected", "target-missing");
    if (row.lifeVersion !== patch.expectedRowVersion) return result("conflicted", "field-changed");
  }
  if ((target.kind === "column-field" && !state.head.authority.columnIds.includes(target.columnId)) ||
    target.kind === "view-field" && !state.head.authority.viewIds.includes(target.viewId)) return result("rejected", "target-missing");
  if (!deletion && "columnId" in target && patch.expectedColumnSchemaVersion !== (state.head.columnSchemaVersions[target.columnId] ?? 0)) return result("rejected", "schema-changed");
  if (patch.kind === "create-row") {
    if (targetVersion(state, target) !== 0) return result("conflicted", "identity-conflict");
    for (const field of commit.fields.filter(field => field.binding.patchIndex === patch.index && field.binding.target.kind === "cell")) {
      const cell = field.binding.target;
      assertCrypto(cell.kind === "cell");
      if (targetDeleted(state, cell)) return result("rejected", "deleted");
      if (!state.head.authority.columnIds.includes(cell.columnId) || field.binding.expectedColumnSchemaVersion !== state.head.columnSchemaVersions[cell.columnId]) return result("rejected", "schema-changed");
    }
  }
  if ((patch.kind === "put-column" || patch.kind === "put-view") && targetVersion(state, target) !== 0) return result("rejected", "metadata-fields-required");
  if (!deletion && targetVersion(state, target) !== patch.expectedFieldVersion) return result("conflicted", "field-changed");
  return result("applied");
}
function write(state: EncryptedBaseState, commit: EncryptedBaseCommit, patch: Patch) {
  const target = patch.target, key = baseTargetKey(target), fields = commit.fields.filter(field => field.binding.patchIndex === patch.index);
  if (patch.deletesTarget) {
    removeEncryptedTarget(state, target); state.tombstones.push(key);
  } else if (patch.kind === "unset") removeEncryptedTarget(state, target);
  if (patch.kind === "create-row" && target.kind === "row") state.rows.push({ rowId: target.rowId, fields: [], fieldVersions: {}, lifeVersion: 1, revision: 0 });
  if (patch.kind === "put-column" && target.kind === "column") state.head.authority.columnIds.push(target.columnId);
  if (patch.kind === "put-view" && target.kind === "view") state.head.authority.viewIds.push(target.viewId);
  for (const field of fields) {
    const fieldTarget = field.binding.target, fieldKey = baseTargetKey(fieldTarget), direct = fieldKey === key;
    const deleted = direct && patch.deletesTarget || patch.derivedDeletions.some(deletion => baseTargetKey(deletion) === fieldKey);
    if (deleted) {
      removeEncryptedTarget(state, fieldTarget); state.tombstones.push(fieldKey);
      if (fieldTarget.kind === "column-field" || fieldTarget.kind === "view-field") state.head.fields = replaceEncryptedField(state.head.fields, field);
    } else if (!(direct && patch.kind === "unset")) {
      if (fieldTarget.kind === "cell" || fieldTarget.kind === "row") {
        const row = state.rows.find(row => row.rowId === fieldTarget.rowId); assertCrypto(row);
        row.fields = replaceEncryptedField(row.fields, field);
      } else {
        state.head.fields = replaceEncryptedField(state.head.fields, field);
        if (fieldTarget.kind === "view" && !state.head.authority.viewIds.includes(fieldTarget.viewId)) state.head.authority.viewIds.push(fieldTarget.viewId);
      }
    }
    if (fieldTarget.kind === "cell") {
      const row = state.rows.find(row => row.rowId === fieldTarget.rowId);
      if (row) row.fieldVersions[fieldTarget.columnId] = (row.fieldVersions[fieldTarget.columnId] ?? 0) + 1;
    } else if (fieldTarget.kind !== "row") {
      state.head.fieldVersions[fieldKey] = (state.head.fieldVersions[fieldKey] ?? 0) + 1;
      for (const child of Object.keys(state.head.fieldVersions)) if (child.startsWith(`${fieldKey}:`)) state.head.fieldVersions[child]++;
    }
  }
  if (structuralPatch(patch)) {
    state.head.schemaRevision++; state.head.structuralGeneration++;
    if ("columnId" in target) state.head.columnSchemaVersions[target.columnId] = (state.head.columnSchemaVersions[target.columnId] ?? 0) + 1;
    for (const derived of patch.derivedTargets) if (derived.kind === "column") state.head.columnSchemaVersions[derived.columnId] = (state.head.columnSchemaVersions[derived.columnId] ?? 0) + 1;
  }
}
export function mergeEncryptedBase(input: EncryptedBaseState, commit: EncryptedBaseCommit,
  dependencies: readonly EncryptedBaseReceipt[] = [], rejected: Readonly<Record<number, Outcome["reason"]>> = {}) {
  const original = structuredClone(input), state = structuredClone(input);
  const dependencyFailed = commit.intent.dependsOnOperationIds.some(id => !dependencies.some(receipt => receipt.operationId === id &&
    receipt.results.every(result => result.status === "applied" || result.status === "converged")));
  const duplicates = new Set(commit.intent.patches.map(patch => baseTargetKey(patch.target))).size !== commit.intent.patches.length;
  const results = commit.intent.patches.map(patch => decide(original, commit, patch, duplicates ? "duplicate-target" : dependencyFailed ? "dependency-unresolved" : rejected[patch.index]));
  // Coupled derived metadata is one field decision even when its source patches are not an explicit atomic group.
  let coupled = true;
  while (coupled) {
    coupled = false;
    for (const patch of commit.intent.patches) {
      const own = [patch.target, ...patch.derivedTargets].map(baseTargetKey);
      const failed = commit.intent.patches.find(other => other.index !== patch.index &&
        [other.target, ...other.derivedTargets].some(target => own.includes(baseTargetKey(target))) &&
        !["applied", "converged"].includes(results[other.index].status));
      if (failed && ["applied", "converged"].includes(results[patch.index].status)) {
        results[patch.index] = { ...results[failed.index], index: patch.index }; coupled = true;
      }
    }
  }
  if (commit.intent.atomicGroup) {
    const failed = results.find(result => result.status !== "applied" && result.status !== "converged");
    if (failed) for (const result of results) { result.status = failed.status; result.reason = failed.reason; }
  }
  for (const result of results) if (result.status === "applied") write(state, commit, commit.intent.patches[result.index]);
  const changedRowIds = state.rows.filter(row => canonicalCipherJson(row) !== canonicalCipherJson(original.rows.find(before => before.rowId === row.rowId) ?? null)).map(row => row.rowId);
  const deletedRowIds = original.rows.filter(row => !state.rows.some(after => after.rowId === row.rowId)).map(row => row.rowId);
  for (const rowId of changedRowIds) state.rows.find(row => row.rowId === rowId)!.revision = (original.rows.find(row => row.rowId === rowId)?.revision ?? 0) + 1;
  if (changedRowIds.length || deletedRowIds.length) state.head.rowsGeneration++;
  if (canonicalCipherJson(state.head.fields) !== canonicalCipherJson(original.head.fields) ||
    canonicalCipherJson(state.head.authority) !== canonicalCipherJson(original.head.authority)) state.head.metadataRevision++;
  state.head.cloudRevision++; state.tombstones = [...new Set(state.tombstones)];
  encryptedBaseHeadSchema.parse(state.head);
  for (const row of state.rows) encryptedBaseRowSchema.parse(row);
  const targets = new Map(commit.intent.patches.flatMap(patch => [patch.target, ...patch.derivedTargets]).map(target => [baseTargetKey(target), target]));
  for (const patch of commit.intent.patches) if (patch.kind === "create-row" && patch.target.kind === "row") for (const columnId of state.head.authority.columnIds) {
    const target: BaseCipherTarget = { kind: "cell", rowId: patch.target.rowId, columnId }; targets.set(baseTargetKey(target), target);
  }
  const baseline = [...targets.values()].map(target => projectEncryptedTarget(state, target));
  const receipt = encryptedBaseReceiptSchema.parse({ baseId: commit.baseId, operationId: commit.operationId, ciphertextHash: commit.ciphertextHash,
    cloudRevision: state.head.cloudRevision, results, schemaRevision: state.head.schemaRevision, structuralGeneration: state.head.structuralGeneration,
    columnSchemaVersions: state.head.columnSchemaVersions, fieldVersions: Object.fromEntries(baseline.map(value => [baseTargetKey(value.target), value.version])), baseline, commit });
  const failed = results.filter(result => result.status !== "applied" && result.status !== "converged" && result.reason !== "deleted");
  return { state, receipt, changedRowIds, deletedRowIds, addedTombstones: state.tombstones.filter(target => !original.tombstones.includes(target)),
    candidates: commit.intent.atomicGroup && failed.length ? [{ indexes: results.map(result => result.index), reason: failed[0].reason! }] : failed.map(result => ({ indexes: [result.index], reason: result.reason! })) };
}
