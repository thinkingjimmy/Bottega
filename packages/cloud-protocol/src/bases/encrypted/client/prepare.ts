/**
 * [INPUT]: Native Base semantics, the original captured operation, an admitted worker and explicit file mappings.
 * [OUTPUT]: Immutable initial/field ciphertext transports with preserved native operation identity.
 * [POS]: Client-only encryption planner; callers persist its exact result in the original Store before sending.
 */
import { baseAttachmentValueSchema } from "@ai-chat/base-ui/attachments/gallery-attachments";
import { validateBaseCell } from "@ai-chat/base-ui/compute/base-mutation-validation";
import type { BaseCellValue } from "@ai-chat/base-ui/model/bases-ipc";
import { assertCrypto, createBaseFieldContext, createBaseOperationContext, encodeBase64url, hashBaseInitialMetadata,
  hashBaseInitialCommitMetadata, hashBaseOperationMetadata, hashBaseCommitMetadata, type CryptoContext } from "../../../encryption";
import { baseInitialMetadataSchema, baseOperationMetadataSchema } from "../../../encryption/domains/bases";
import { baseOperationFitsBudget, baseOperationSchema, canonicalJson, fieldKey, hashBaseOperation, type BaseOperation, type BasePatch } from "../../operations";
import { initialBaseState } from "../../initial";
import type { BaseMergeState } from "../../merge";
import { deletesMetadataMember, isMetadataField, removeMetadataColumn } from "../../metadata";
import { baseFieldMetadata, baseTargetKey, hashBaseCiphertext, verifyBaseCommit, verifyBaseInitial } from "../wire";
import type { BaseCipherTarget, CipherPacket, EncryptedBaseField, EncryptedBaseInitial, BaseCipherIntent } from "../model";
import { assertResult, frozenPair, hashBaseSemanticValue, type BaseCipherFiles, type BaseCipherPort, type BaseCipherReference } from "./model";
export function targetOf(patch: BasePatch): BaseCipherTarget {
  if ("target" in patch) return { kind: "cell", ...patch.target };
  switch (patch.kind) {
    case "create-row": return { kind: "row", rowId: patch.row.id };
    case "delete-row": return { kind: "row", rowId: patch.rowId };
    case "put-column": return { kind: "column", columnId: patch.column.id };
    case "delete-column": return { kind: "column", columnId: patch.columnId };
    case "put-view": return { kind: "view", viewId: patch.view.id };
    case "delete-view": return { kind: "view", viewId: patch.viewId };
    case "set-column-field": return { kind: "column-field", columnId: patch.columnId, path: patch.path };
    case "set-view-field": return { kind: "view-field", viewId: patch.viewId, path: patch.path };
    case "set-order": return { kind: "order", field: patch.field };
    case "set-meta": return { kind: "meta", field: patch.field };
  }
}
async function sealBaseValue(port: BaseCipherPort, context: CryptoContext, value: unknown): Promise<CipherPacket> {
  const plaintext = new TextEncoder().encode(canonicalJson(value));
  try {
    const result = await port.run({ kind: "encrypt", context, plaintext }); assertResult(result, "encrypted");
    return { envelope: encodeBase64url(result.envelope), ciphertextHash: result.ciphertextHash, ciphertextBytes: result.envelope.byteLength };
  } finally { plaintext.fill(0); }
}
function metaValues(state: BaseMergeState): { target: BaseCipherTarget; value: unknown }[] {
  const { meta } = state;
  return [
    { target: { kind: "meta", field: "name" }, value: meta.name },
    { target: { kind: "meta", field: "activeViewId" }, value: meta.activeViewId },
    { target: { kind: "order", field: "columns" }, value: meta.columns.map(column => column.id) },
    { target: { kind: "order", field: "views" }, value: meta.views.map(view => view.id) },
    ...meta.columns.map(column => ({ target: { kind: "column" as const, columnId: column.id }, value: column })),
    ...meta.views.map(view => ({ target: { kind: "view" as const, viewId: view.id }, value: view })),
  ];
}
export async function prepareEncryptedBaseInitial(port: BaseCipherPort, input: { meta: unknown; operationId: string }): Promise<EncryptedBaseInitial> {
  const state = initialBaseState(input.meta), baseId = state.meta.ownerInstanceId;
  const intent = baseInitialMetadataSchema.parse({ sourceDeviceId: port.session.deviceId, owner: state.meta.owner, navigation: state.meta.navigation,
    columnIds: state.meta.columns.map(column => column.id), viewIds: state.meta.views.map(view => view.id) });
  const metadataCommitment = hashBaseInitialMetadata(intent), fields: EncryptedBaseField[] = [];
  for (const { target, value } of metaValues(state)) {
    const binding = { target, patchIndex: 0, role: "value" as const, expectedFieldVersion: 0, expectedRowVersion: null,
      expectedColumnSchemaVersion: null, structuralGeneration: 0, metadataCommitment };
    fields.push({ operationId: input.operationId, binding, references: [], packet: await sealBaseValue(port,
      createBaseFieldContext(port.scope, baseId, input.operationId, binding), value) });
  }
  const operation = await sealBaseValue(port, createBaseOperationContext(port.scope, baseId, input.operationId, { role: "snapshot", schemaRevision: 1,
    structuralGeneration: 0, metadataCommitment: hashBaseInitialCommitMetadata({ intent, fields: fields.map(baseFieldMetadata) }) }),
  { baseId, operationId: input.operationId, metadataHash: hashBaseSemanticValue(state.meta) });
  const payload = { baseId, operationId: input.operationId, intent, fields, operation };
  return verifyBaseInitial({ ...payload, ciphertextHash: hashBaseCiphertext(payload) }, port.scope);
}
function desired(operation: BaseOperation, patch: BasePatch): unknown {
  switch (patch.kind) {
    case "set": return patch.value;
    case "unset": case "delete-row": case "delete-column": case "delete-view": return null;
    case "increment": {
      const original = operation.baseValues[fieldKey(patch)];
      assertCrypto(typeof original === "number" && Number.isFinite(original + patch.amount)); return original + patch.amount;
    }
    case "create-row": return { id: patch.row.id };
    case "put-column": return patch.column;
    case "put-view": return patch.view;
    case "set-order": return patch.ids;
    case "set-meta": case "set-column-field": case "set-view-field": return patch.value;
  }
}
function derivedValues(snapshot: BaseMergeState, patch: BasePatch) {
  if (patch.kind !== "delete-column") return [];
  const nextState = structuredClone(snapshot); removeMetadataColumn(nextState.meta, patch.columnId);
  const previous = new Map(metaValues(snapshot).map(value => [baseTargetKey(value.target), value]));
  const next = metaValues(nextState);
  return [...next.filter(value => baseTargetKey(value.target) !== fieldKey(patch) &&
    value.target.kind !== "order" &&
    canonicalJson(previous.get(baseTargetKey(value.target))?.value ?? null) !== canonicalJson(value.value)),
  ...[...previous.values()].filter(value => value.target.kind === "view" && !next.some(after => baseTargetKey(after.target) === baseTargetKey(value.target)))
    .map(value => ({ target: value.target, value: null }))];
}
export async function prepareEncryptedBaseCommit(port: BaseCipherPort, source: BaseOperation, snapshot: BaseMergeState, files?: BaseCipherFiles) {
  const operation = baseOperationSchema.parse(source);
  assertCrypto(operation.baseId === snapshot.meta.ownerInstanceId && await hashBaseOperation(operation) === operation.payloadHash && baseOperationFitsBudget(operation));
  type PreparedValue = { index: number; target: BaseCipherTarget; value: unknown; references: BaseCipherReference[] };
  const values: PreparedValue[] = [], patches: BaseCipherIntent["patches"] = [], conditions = new Map<string, BaseCipherIntent["preconditions"][number]>();
  const prepareValue = async (index: number, target: BaseCipherTarget, value: unknown) => {
    if (target.kind === "cell" && value !== null) {
      const column = snapshot.meta.columns.find(column => column.id === target.columnId);
      if (column) validateBaseCell(column, value as BaseCellValue, column.type === "attachment" ? "internal" : "external", new Set(snapshot.rows.map(row => row.id)));
    }
    const attachment = baseAttachmentValueSchema.safeParse(value);
    if (attachment.success && attachment.data.localAvailability && !files) throw new Error("BASE_LOCAL_IMAGE_SOURCE_REQUIRED");
    if (attachment.success && !attachment.data.localAvailability && !files) throw new Error("BASE_ENCRYPTED_FILE_MAPPING_REQUIRED");
    const mapped = files ? await files.prepare(value, target) : { value, references: [] };
    values.push({ index, target, value: mapped.value, references: mapped.references });
  };
  const structuralState = structuredClone(snapshot);
  for (const [index, patch] of operation.patches.entries()) {
    const target = targetOf(patch), derived = derivedValues(structuralState, patch);
    await prepareValue(index, target, desired(operation, patch));
    if (patch.kind === "create-row") for (const [columnId, value] of Object.entries(patch.row.values)) await prepareValue(index, { kind: "cell", rowId: patch.row.id, columnId }, value);
    for (const effect of derived) {
      conditions.set(baseTargetKey(effect.target), { target: effect.target, version: snapshot.fieldVersions[baseTargetKey(effect.target)] ?? 0 });
      await prepareValue(index, effect.target, effect.value);
    }
    if (target.kind === "column-field" || target.kind === "view-field") {
      const parent: BaseCipherTarget = target.kind === "column-field" ? { kind: "column", columnId: target.columnId } : { kind: "view", viewId: target.viewId };
      conditions.set(baseTargetKey(parent), { target: parent, version: snapshot.fieldVersions[baseTargetKey(parent)] ?? 0 });
      if (target.path.length > 1) {
        const path = target.path;
        if (target.kind === "column-field" && path[0] === "options" && path.length === 3) {
          const parentTarget: BaseCipherTarget = { kind: "column-field", columnId: target.columnId, path: ["options", path[1]] };
          conditions.set(baseTargetKey(parentTarget), { target: parentTarget, version: snapshot.fieldVersions[baseTargetKey(parentTarget)] ?? 0 });
        }
      }
    }
    const columnId = "columnId" in target ? target.columnId : null, rowId = "rowId" in target ? target.rowId : null;
    patches.push({ index, kind: patch.kind, target, expectedFieldVersion: operation.baseFieldVersions[fieldKey(patch)] ?? 0,
      expectedRowVersion: rowId ? snapshot.fieldVersions[`row:${rowId}`] ?? 0 : null,
      expectedColumnSchemaVersion: columnId ? operation.baseColumnSchemaVersions[columnId] ?? 0 : null,
      references: [...new Map(values.filter(value => value.index === index).flatMap(value => value.references).map(reference => [reference.blobId, reference])).values()],
      deletesTarget: patch.kind.startsWith("delete-") || isMetadataField(patch) && deletesMetadataMember(patch),
      derivedTargets: derived.map(value => value.target), derivedDeletions: derived.filter(value => value.value === null).map(value => value.target) });
    if (patch.kind === "delete-column") removeMetadataColumn(structuralState.meta, patch.columnId);
    if (patch.kind === "put-column") structuralState.meta.columns.push(patch.column);
    if (patch.kind === "put-view") structuralState.meta.views.push(patch.view);
    if (patch.kind === "delete-view") structuralState.meta.views = structuralState.meta.views.filter(view => view.id !== patch.viewId);
  }
  const intent = baseOperationMetadataSchema.parse({ sourceDeviceId: port.session.deviceId, actor: operation.actor,
    schemaRevision: operation.schemaRevision, structuralGeneration: operation.schemaRevision, dependsOnOperationIds: operation.dependsOnOperationIds,
    atomicGroup: operation.atomicGroup, batchId: operation.batchId, preconditions: [...conditions.values()], patches });
  const metadataCommitment = hashBaseOperationMetadata(intent), fields: EncryptedBaseField[] = [];
  for (const value of values) {
    const patch = intent.patches[value.index], direct = baseTargetKey(value.target) === baseTargetKey(patch.target);
    const binding = { target: value.target, patchIndex: value.index, role: "value" as const,
      expectedFieldVersion: direct ? patch.expectedFieldVersion : patch.kind === "create-row" ? 0 : snapshot.fieldVersions[baseTargetKey(value.target)] ?? 0,
      expectedRowVersion: direct ? patch.expectedRowVersion : "rowId" in value.target ? patch.kind === "create-row" ? 0 : snapshot.fieldVersions[`row:${value.target.rowId}`] ?? 0 : null,
      expectedColumnSchemaVersion: "columnId" in value.target ? operation.baseColumnSchemaVersions[value.target.columnId] ?? 0 : null,
      structuralGeneration: intent.structuralGeneration, metadataCommitment };
    fields.push({ operationId: operation.operationId, binding, references: value.references, packet: await sealBaseValue(port,
      createBaseFieldContext(port.scope, operation.baseId, operation.operationId, binding), value.value) });
  }
  const packet = await sealBaseValue(port, createBaseOperationContext(port.scope, operation.baseId, operation.operationId, { role: "operation",
    schemaRevision: intent.schemaRevision, structuralGeneration: intent.structuralGeneration,
    metadataCommitment: hashBaseCommitMetadata({ intent, fields: fields.map(baseFieldMetadata) }) }), operation);
  const payload = { baseId: operation.baseId, operationId: operation.operationId, intent, fields, operation: packet };
  const commit = verifyBaseCommit({ ...payload, ciphertextHash: hashBaseCiphertext(payload) }, port.scope);
  return frozenPair(operation.payloadHash, commit);
}
