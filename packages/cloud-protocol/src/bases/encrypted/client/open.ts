/**
 * [INPUT]: Independently admitted scope, original Base/request identities, exact ciphertext and native semantic validators.
 * [OUTPUT]: Request-bound metadata, candidates and native receipts; foreign parents are rejected before decryption or file association.
 * [POS]: Client-only read boundary; failed decryption or identity checks never advance the native Store.
 */
import { z } from "zod";
import { baseMetaSchema, baseRowSchema } from "@ai-chat/base-ui/model/bases-schema";
import type { BaseMeta, BaseColumn, BaseView } from "@ai-chat/base-ui/model/bases-ipc";
import { baseAttachmentValueSchema } from "@ai-chat/base-ui/attachments/gallery-attachments";
import { assertCrypto, createBaseFieldContext, createBaseOperationContext, hashBaseInitialCommitMetadata, hashBaseCommitMetadata,
  type CryptoContext } from "../../../encryption";
import { baseOperationSchema, baseReceiptSchema, canonicalJson, hashBaseOperation } from "../../operations";
import { baseConflictSchema, baseConflictLookupSchema } from "../../snapshot";
import { writeMetadataField, readMetadataPath } from "../../metadata";
import { baseTargetKey, baseFieldMetadata, verifyBasePacket, verifyBaseField, verifyBaseInitial, verifyBaseCommit } from "../wire";
import { encryptedBaseHeadSchema, encryptedBaseRowSchema, encryptedBaseReceiptSchema, encryptedBaseConflictSchema, encryptedBaseLookupSchema,
  type CipherPacket, type EncryptedBaseInitial, type EncryptedBaseHead, type EncryptedBaseField, type EncryptedBaseProjection, type EncryptedBaseCommit,
  type EncryptedBaseReceipt } from "../model";
import { assertResult, hashBaseSemanticValue, type BaseCipherPort, type BaseCipherFiles, type FrozenBaseTransport } from "./model";
import { targetOf } from "./prepare";
async function openBasePacket(port: BaseCipherPort, packet: CipherPacket, expectedContext: CryptoContext): Promise<unknown> {
  const envelope = verifyBasePacket(packet, expectedContext), result = await port.run({ kind: "decrypt", expectedContext, envelope });
  assertResult(result, "decrypted");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result.plaintext)); }
  finally { result.plaintext.fill(0); }
}
export async function openBaseField(port: BaseCipherPort, baseId: string, field: EncryptedBaseField, files?: BaseCipherFiles) {
  verifyBaseField(field, port.scope, baseId);
  assertCrypto(field.binding.role === "value");
  const value = await openBasePacket(port, field.packet, createBaseFieldContext(port.scope, baseId, field.operationId, field.binding));
  if (field.references.length && !files) throw new Error("BASE_ENCRYPTED_FILE_MAPPING_REQUIRED");
  const result = files ? await files.open(value, field.binding.target, field.references) : value;
  const attachment = baseAttachmentValueSchema.safeParse(result);
  if (attachment.success && !attachment.data.localAvailability && !files) throw new Error("BASE_ENCRYPTED_FILE_MAPPING_REQUIRED");
  return result;
}
async function metadata(port: BaseCipherPort, baseId: string, authority: EncryptedBaseHead["authority"], fields: EncryptedBaseField[], revision: number, rowsGeneration: number) {
  const values = new Map<string, unknown>();
  for (const field of fields) {
    const key = baseTargetKey(field.binding.target); assertCrypto(!values.has(key));
    assertCrypto(field.binding.target.kind !== "cell" && field.binding.target.kind !== "row" && !field.references.length);
    values.set(key, await openBaseField(port, baseId, field));
  }
  const columns = authority.columnIds.map(id => values.get(`column:${id}`) as BaseColumn), views = authority.viewIds.map(id => values.get(`view:${id}`) as BaseView);
  assertCrypto(columns.every(Boolean) && views.every(Boolean));
  const meta: BaseMeta = { owner: authority.owner, navigation: authority.navigation, ownerInstanceId: baseId,
    columns: structuredClone(columns), views: structuredClone(views), name: z.string().parse(values.get("meta:name")),
    activeViewId: z.string().parse(values.get("meta:activeViewId")), revision, rowsGeneration, galleryGeneration: 0, historyGeneration: 0 };
  for (const field of fields.filter(field => field.binding.target.kind === "column-field" || field.binding.target.kind === "view-field")
    .sort((a, b) => baseTargetKey(a.binding.target).split(":").length - baseTargetKey(b.binding.target).split(":").length)) {
    const target = field.binding.target, value = values.get(baseTargetKey(target));
    if (target.kind === "column-field") writeMetadataField(meta, { kind: "set-column-field", columnId: target.columnId, path: target.path, value: z.json().parse(value) });
    if (target.kind === "view-field") writeMetadataField(meta, { kind: "set-view-field", viewId: target.viewId, path: target.path, value: z.json().parse(value) });
  }
  for (const key of ["columns", "views"] as const) {
    const ids = z.array(z.string()).parse(values.get(`meta:${key}`));
    assertCrypto(new Set(ids).size === ids.length);
    const order = [...ids.filter(id => meta[key].some(value => value.id === id)), ...meta[key].filter(value => !ids.includes(value.id)).map(value => value.id)];
    meta[key].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  return baseMetaSchema.parse(meta);
}
export async function openEncryptedBaseInitial(port: BaseCipherPort, baseId: string, input: EncryptedBaseInitial) {
  const initial = verifyBaseInitial(input, port.scope); assertCrypto(initial.baseId === baseId);
  const meta = await metadata(port, baseId, initial.intent, initial.fields, 0, 0);
  const proof = z.object({ baseId: z.string(), operationId: z.string(), metadataHash: z.string() }).strict().parse(await openBasePacket(port, initial.operation,
    createBaseOperationContext(port.scope, initial.baseId, initial.operationId, { role: "snapshot", schemaRevision: 1, structuralGeneration: 0,
      metadataCommitment: hashBaseInitialCommitMetadata({ intent: initial.intent, fields: initial.fields.map(baseFieldMetadata) }) })));
  assertCrypto(proof.baseId === initial.baseId && proof.operationId === initial.operationId && proof.metadataHash === hashBaseSemanticValue(meta)); return meta;
}
export async function openEncryptedBaseHead(port: BaseCipherPort, baseId: string, input: unknown) {
  const head = encryptedBaseHeadSchema.parse(input);
  assertCrypto(head.baseId === baseId && head.initial.baseId === baseId);
  assertCrypto(canonicalJson(head.encryptedSpace) === canonicalJson({ scope: port.scope, keyPackageFingerprint: port.keyPackageFingerprint }));
  await openEncryptedBaseInitial(port, baseId, head.initial);
  const meta = await metadata(port, head.baseId, head.authority, head.fields, head.metadataRevision, head.rowsGeneration);
  return { baseId: head.baseId, meta, cloudRevision: head.cloudRevision, schemaRevision: head.schemaRevision,
    columnSchemaVersions: head.columnSchemaVersions, fieldVersions: head.fieldVersions };
}
export async function openEncryptedBaseRow(port: BaseCipherPort, baseId: string, input: unknown, files?: BaseCipherFiles) {
  const row = encryptedBaseRowSchema.parse(input), values: Record<string, unknown> = {}, seen = new Set<string>();
  for (const field of row.fields) {
    const target = field.binding.target;
    assertCrypto((target.kind === "row" || target.kind === "cell") && target.rowId === row.rowId);
    const key = baseTargetKey(target); assertCrypto(!seen.has(key)); seen.add(key);
    const value = await openBaseField(port, baseId, field, files);
    if (target.kind === "cell") values[target.columnId] = value;
    else assertCrypto(z.object({ id: z.literal(row.rowId) }).strict().safeParse(value).success);
  }
  assertCrypto(seen.has(`row:${row.rowId}`));
  return { row: baseRowSchema.parse({ id: row.rowId, values }), fieldVersions: row.fieldVersions, lifeVersion: row.lifeVersion, revision: row.revision };
}
async function openEncryptedBaseProjection(port: BaseCipherPort, baseId: string, projection: EncryptedBaseProjection, files?: BaseCipherFiles): Promise<unknown> {
  const target = projection.target;
  if (projection.field) assertCrypto(baseTargetKey(projection.field.binding.target) === baseTargetKey(target));
  if (target.kind === "row") {
    if (!projection.field) return null;
    return (await openEncryptedBaseRow(port, baseId, { rowId: target.rowId, fields: [projection.field, ...projection.related],
      lifeVersion: projection.version, revision: projection.version, fieldVersions: {} }, files)).row;
  }
  if (target.kind === "column" || target.kind === "view") {
    if (!projection.field) return null;
    let value = await openBaseField(port, baseId, projection.field, files);
    for (const field of projection.related) {
      const pathTarget = field.binding.target;
      assertCrypto(target.kind === "column" ? pathTarget.kind === "column-field" && pathTarget.columnId === target.columnId : pathTarget.kind === "view-field" && pathTarget.viewId === target.viewId);
      const next = await openBaseField(port, baseId, field, files);
      const shell = { columns: target.kind === "column" ? [value] : [], views: target.kind === "view" ? [value] : [] } as unknown as BaseMeta;
      if (pathTarget.kind === "column-field") writeMetadataField(shell, { kind: "set-column-field", columnId: pathTarget.columnId, path: pathTarget.path, value: z.json().parse(next) });
      if (pathTarget.kind === "view-field") writeMetadataField(shell, { kind: "set-view-field", viewId: pathTarget.viewId, path: pathTarget.path, value: z.json().parse(next) });
      value = target.kind === "column" ? shell.columns[0] : shell.views[0];
    }
    return value;
  }
  if (projection.field) return openBaseField(port, baseId, projection.field, files);
  if ((target.kind === "column-field" || target.kind === "view-field") && projection.related.length) {
    const parent = projection.related[0];
    assertCrypto(target.kind === "column-field" ? parent.binding.target.kind === "column" && parent.binding.target.columnId === target.columnId :
      parent.binding.target.kind === "view" && parent.binding.target.viewId === target.viewId);
    const value = await openEncryptedBaseProjection(port, baseId, { target: parent.binding.target, version: 0, field: parent, related: projection.related.slice(1) }, files);
    return readMetadataPath(value, target.path);
  }
  return null;
}
export async function openEncryptedBaseOperation(port: BaseCipherPort, input: EncryptedBaseCommit) {
  const commit = verifyBaseCommit(input, port.scope);
  const operation = baseOperationSchema.parse(await openBasePacket(port, commit.operation, createBaseOperationContext(port.scope, commit.baseId, commit.operationId,
    { role: "operation", schemaRevision: commit.intent.schemaRevision, structuralGeneration: commit.intent.structuralGeneration,
      metadataCommitment: hashBaseCommitMetadata({ intent: commit.intent, fields: commit.fields.map(baseFieldMetadata) }) })));
  assertCrypto(operation.baseId === commit.baseId && operation.operationId === commit.operationId && await hashBaseOperation(operation) === operation.payloadHash);
  assertCrypto(operation.actor === commit.intent.actor && operation.schemaRevision === commit.intent.schemaRevision &&
    operation.atomicGroup === commit.intent.atomicGroup && operation.batchId === commit.intent.batchId &&
    canonicalJson(operation.dependsOnOperationIds) === canonicalJson(commit.intent.dependsOnOperationIds) &&
    operation.patches.length === commit.intent.patches.length && operation.patches.every((patch, index) => {
      const intent = commit.intent.patches[index];
      return intent.kind === patch.kind && baseTargetKey(intent.target) === baseTargetKey(targetOf(patch)) &&
        intent.expectedFieldVersion === (operation.baseFieldVersions[baseTargetKey(intent.target)] ?? 0);
    }));
  return operation;
}
function assertReceiptRequest(receipt: EncryptedBaseReceipt, expected: Pick<EncryptedBaseCommit, "baseId" | "operationId">) {
  assertCrypto(receipt.baseId === expected.baseId && receipt.operationId === expected.operationId &&
    receipt.commit.baseId === expected.baseId && receipt.commit.operationId === expected.operationId &&
    receipt.ciphertextHash === receipt.commit.ciphertextHash);
}
export async function openEncryptedBaseReceipt(port: BaseCipherPort, request: Pick<EncryptedBaseCommit, "baseId" | "operationId">, input: unknown,
  expected?: Pick<FrozenBaseTransport, "plaintextHash" | "ciphertextHash">, files?: BaseCipherFiles) {
  const receipt = encryptedBaseReceiptSchema.parse(input); assertReceiptRequest(receipt, request);
  if (expected) assertCrypto(expected.ciphertextHash === receipt.ciphertextHash);
  const operation = await openEncryptedBaseOperation(port, receipt.commit);
  assertCrypto(receipt.operationId === operation.operationId && receipt.baseId === operation.baseId && receipt.ciphertextHash === receipt.commit.ciphertextHash &&
    receipt.results.length === operation.patches.length && receipt.results.every((result, index) => result.index === index));
  if (expected) assertCrypto(expected.plaintextHash === operation.payloadHash && expected.ciphertextHash === receipt.ciphertextHash);
  const values: Record<string, unknown> = {};
  for (const projection of receipt.baseline) values[baseTargetKey(projection.target)] = await openEncryptedBaseProjection(port, receipt.baseId, projection, files);
  return baseReceiptSchema.parse({ operationId: receipt.operationId, payloadHash: operation.payloadHash, cloudRevision: receipt.cloudRevision,
    results: receipt.results, baseline: { schemaRevision: receipt.schemaRevision, columnSchemaVersions: receipt.columnSchemaVersions,
      fieldVersions: receipt.fieldVersions, values } });
}
export async function openEncryptedBaseConflict(port: BaseCipherPort, baseId: string, input: unknown, files?: BaseCipherFiles) {
  const conflict = encryptedBaseConflictSchema.parse(input);
  assertCrypto(conflict.commit.baseId === baseId && new Set(conflict.indexes).size === conflict.indexes.length &&
    conflict.indexes.every(index => index < conflict.commit.intent.patches.length));
  const operation = await openEncryptedBaseOperation(port, conflict.commit), currentValues: Record<string, unknown> = {};
  for (const projection of conflict.current) currentValues[baseTargetKey(projection.target)] = await openEncryptedBaseProjection(port, operation.baseId, projection, files);
  return baseConflictSchema.parse({ conflictId: conflict.conflictId, operation, indexes: conflict.indexes, currentValues,
    currentFieldVersions: conflict.currentFieldVersions, sourceDeviceId: conflict.sourceDeviceId, sourceDeviceName: conflict.sourceDeviceName,
    reason: conflict.reason, state: conflict.state, createdAt: conflict.createdAt });
}
export async function openEncryptedBaseLookup(port: BaseCipherPort, request: Pick<EncryptedBaseCommit, "baseId" | "operationId"> & { resolutionOperationId: string | null },
  input: unknown, files?: BaseCipherFiles) {
  const lookup = encryptedBaseLookupSchema.parse(input);
  assertReceiptRequest(lookup.receipt, request);
  if (lookup.resolutionReceipt) {
    assertCrypto(request.resolutionOperationId !== null && lookup.candidates.some(candidate => candidate.resolutionOperationId === request.resolutionOperationId));
    assertReceiptRequest(lookup.resolutionReceipt, { baseId: request.baseId, operationId: request.resolutionOperationId });
  }
  assertCrypto(lookup.candidates.every(candidate => new Set(candidate.indexes).size === candidate.indexes.length &&
    candidate.indexes.every(index => index < lookup.receipt.commit.intent.patches.length)));
  return baseConflictLookupSchema.parse({ receipt: await openEncryptedBaseReceipt(port, request, lookup.receipt, undefined, files),
    operation: lookup.candidates.length ? await openEncryptedBaseOperation(port, lookup.receipt.commit) : null,
    sourceDeviceId: lookup.sourceDeviceId, sourceDeviceName: lookup.sourceDeviceName, createdAt: lookup.createdAt, candidates: lookup.candidates,
    resolutionReceipt: lookup.resolutionReceipt ? await openEncryptedBaseReceipt(port,
      { baseId: request.baseId, operationId: request.resolutionOperationId! }, lookup.resolutionReceipt, undefined, files) : null });
}
