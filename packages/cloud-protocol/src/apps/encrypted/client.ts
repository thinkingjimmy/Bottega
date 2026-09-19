/**
 * [INPUT]: Original App operations, client-verified source metadata and admitted Project/Base/file crypto adapters.
 * [OUTPUT]: Frozen App lifecycle transports, request-bound heads/packages, authenticated catalogs and original-hash receipts.
 * [POS]: Shared client boundary; AppStore and page sessions keep their original mutation ownership.
 */
import { z } from "zod";
import { appItemSchema, appOperationSchema, appReceiptSchema, appPackageSchema, packageCandidateInputSchema, verifiedAppSourceSchema,
  type AppOperation, type AppReceipt, type CloudApp, type CloudAppPackage } from "../model";
import { assertCrypto, assertExpectedScope, createAppContext } from "../../encryption";
import { projectOperationSchema, hashProjectOperation, type PortableProject } from "../../projects/model";
import { prepareProjectOperation, encryptRecordPacket, decryptRecordPacket, type ProjectCipherPort } from "../../projects/encrypted/client";
import { canonicalRecordJson, recordCipherHash, type EncryptedProjectOperation } from "../../projects/encrypted";
import type { EncryptedBaseInitial } from "../../bases/encrypted";
import { encryptedFileDescriptorSchema, type EncryptedFileDescriptor } from "../../blobs/encrypted/model";
import { ciphertextFileDescriptor } from "../../blobs/encrypted/transport";
import { frozenAppOperationSchema, encryptedAppHeadSchema, encryptedAppPackageSchema, encryptedAppReceiptSchema, type AppCipherIntent, type EncryptedAppHead, type EncryptedAppPackage,
  type EncryptedAppReceipt, type FrozenAppOperation } from "./model";
import { appRecordContext, hashAppCommitMetadata, verifyAppHead, verifyAppOperation, verifyAppPackage } from "./wire";
export type AppCipherPort = ProjectCipherPort;
export type AppPackageCandidate = z.infer<typeof packageCandidateInputSchema>;
const factsSchema = z.object({ schema: z.literal("bottega.encrypted-app-facts/v1"), displayName: appItemSchema.shape.displayName,
  dataCoverage: appItemSchema.shape.dataCoverage }).strict();
const packageSchema = z.object({ schema: z.literal("bottega.encrypted-app-package/v1"), verified: verifiedAppSourceSchema,
  packageBlob: encryptedFileDescriptorSchema }).strict();
const operationProofSchema = z.object({ schema: z.literal("bottega.encrypted-app-operation/v1"), appId: appItemSchema.shape.appId,
  operationId: appOperationSchema.options[0].shape.operationId, plaintextHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Previous = { app: CloudApp | null; project: PortableProject | null; baseRevision: number; baseSchemaRevision: number };
type PrepareAppOptions = Previous & { initial?: EncryptedBaseInitial; verified?: z.infer<typeof verifiedAppSourceSchema>;
  migration?: AppCipherIntent["migration"] };
async function appProject(operation: AppOperation, previous: Previous, crypto: AppCipherPort, signal: AbortSignal): Promise<EncryptedProjectOperation | null> {
  if (operation.kind === "delete" && !operation.retainBase) return null;
  const projectId = operation.kind === "create" ? operation.projectId : previous.app!.projectId;
  const command = operation.kind === "create" ? { kind: "create" as const, metadata: { name: operation.displayName.slice(0, 100), sortIndex: previous.project?.sortIndex ?? 0 },
    createdAt: previous.project?.createdAt ?? Date.now() } : { kind: "patch" as const, expectedRevision: previous.project!.cloudRevision,
    changes: { name: operation.kind === "rename" ? operation.displayName.slice(0, 100) : previous.project!.name } };
  const value = projectOperationSchema.parse({ projectId, operationId: operation.operationId, command, payloadHash: "0".repeat(64) });
  value.payloadHash = await hashProjectOperation(value);
  return (await prepareProjectOperation(value, operation.kind === "create" ? null : previous.project, crypto, signal,
    { role: operation.kind === "delete" ? "base-custody" : "workspace", appId: operation.kind === "delete" ? null : operation.appId })).transport;
}
export async function prepareAppOperation(raw: AppOperation | AppPackageCandidate, previous: PrepareAppOptions, crypto: AppCipherPort,
  signal: AbortSignal): Promise<FrozenAppOperation> {
  const publishing = !Object.hasOwn(raw, "kind");
  const operation = publishing ? packageCandidateInputSchema.parse(raw) : appOperationSchema.parse(raw);
  const kind = "kind" in operation ? operation.kind : "publish", current = previous.app;
  assertCrypto(kind === "create" || current && current.appId === operation.appId && current.revision === (operation as Exclude<AppOperation, { kind: "create" }>).expectedRevision);
  if (kind !== "create") assertCrypto(previous.project && previous.project.id === current!.projectId && previous.project.appId === current!.appId);
  const creation = "kind" in operation && operation.kind === "create" ? operation : null;
  const publish = !("kind" in operation) ? operation : null;
  const intent: AppCipherIntent = { kind, projectId: creation?.projectId ?? current!.projectId, baseId: creation?.baseId ?? current!.baseId,
    sourceDeviceId: current?.sourceDeviceId ?? crypto.session.deviceId, actorDeviceId: crypto.session.deviceId,
    expectedRevision: creation ? 0 : current!.revision, expectedProjectRevision: creation ? 0 : previous.project!.cloudRevision,
    expectedBaseRevision: creation ? 0 : previous.baseRevision, packageRevision: publish?.packageRevision ?? current?.activePackageRevision ?? null,
    baseSchemaRevision: previous.baseSchemaRevision, createdAt: current?.createdAt ?? Date.now(),
    retainBase: "kind" in operation && operation.kind === "delete" ? operation.retainBase : null,
    migration: publish ? previous.migration ?? "requires-atomic" : null };
  const dataCoverage = publish ? verifiedAppSourceSchema.parse(previous.verified).dataCoverage : current?.dataCoverage ?? "partial";
  const displayName = "kind" in operation && operation.kind !== "delete" ? operation.displayName : current!.displayName;
  const facts = kind === "delete" ? null : await encryptRecordPacket(crypto, appRecordContext(crypto.scope, operation.appId, operation.operationId, intent, "facts"),
    { schema: "bottega.encrypted-app-facts/v1", displayName, dataCoverage }, signal);
  const project = "kind" in operation ? await appProject(operation, previous, crypto, signal) : null;
  const initial = creation ? previous.initial ?? null : null;
  const packagePacket = publish ? await encryptRecordPacket(crypto, appRecordContext(crypto.scope, operation.appId, operation.operationId, intent, "package"),
    { schema: "bottega.encrypted-app-package/v1", verified: verifiedAppSourceSchema.parse(previous.verified), packageBlob: publish.packageBlob }, signal) : null;
  const aggregate = { intent, facts, project, initial, package: packagePacket, packageFile: publish ? ciphertextFileDescriptor(publish.packageBlob) : null };
  const plaintextHash = recordCipherHash(operation);
  const proof = await encryptRecordPacket(crypto, createAppContext(crypto.scope, operation.appId, operation.operationId,
    { role: "operation", projectId: intent.projectId, baseId: intent.baseId, expectedRevision: intent.expectedRevision, packageRevision: intent.packageRevision ?? 0,
      metadataCommitment: hashAppCommitMetadata(aggregate) }), { schema: "bottega.encrypted-app-operation/v1", appId: operation.appId,
    operationId: operation.operationId, plaintextHash }, signal);
  const payload = { appId: operation.appId, operationId: operation.operationId, ...aggregate, operation: proof };
  const transport = { ...payload, ciphertextHash: recordCipherHash(payload) };
  verifyAppOperation(transport, crypto.scope);
  return frozenAppOperationSchema.parse({ encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint }, plaintextHash, transport });
}
export async function openAppHead(raw: EncryptedAppHead, crypto: AppCipherPort, signal: AbortSignal): Promise<CloudApp> {
  const head = verifyAppHead(raw, crypto.scope, crypto.keyPackageFingerprint);
  const facts = factsSchema.parse(await decryptRecordPacket(crypto, head.facts, appRecordContext(crypto.scope, head.appId, head.operationId, head.intent, "facts"), signal));
  return appItemSchema.parse({ appId: head.appId, projectId: head.projectId, baseId: head.baseId, sourceDeviceId: head.sourceDeviceId,
    displayName: facts.displayName, dataCoverage: facts.dataCoverage, revision: head.revision, activePackageRevision: head.activePackageRevision,
    packageState: head.packageState, createdAt: head.createdAt, updatedAt: head.updatedAt });
}
export async function openAppHeadForRequest(raw: EncryptedAppHead, appId: string, crypto: AppCipherPort, signal: AbortSignal): Promise<CloudApp> {
  const head = encryptedAppHeadSchema.parse(raw);
  assertCrypto(head.appId === appId);
  return openAppHead(head, crypto, signal);
}
export async function openAppPackage(raw: EncryptedAppPackage, crypto: AppCipherPort, signal: AbortSignal): Promise<CloudAppPackage> {
  const value = verifyAppPackage(raw, crypto.scope, crypto.keyPackageFingerprint);
  const facts = packageSchema.parse(await decryptRecordPacket(crypto, value.packet, appRecordContext(crypto.scope, value.appId, value.operationId, value.intent, "package"), signal));
  assertCrypto(canonicalRecordJson(ciphertextFileDescriptor(facts.packageBlob)) === canonicalRecordJson(value.packageFile));
  return appPackageSchema.parse({ ...facts.verified, appId: value.appId, packageRevision: value.intent.packageRevision, baseSchemaRevision: value.intent.baseSchemaRevision,
    packageBlob: facts.packageBlob, createdAt: value.createdAt });
}
export async function openAppPackageForRequest(raw: EncryptedAppPackage, appId: string, packageRevision: number, crypto: AppCipherPort,
  signal: AbortSignal): Promise<CloudAppPackage> {
  const value = encryptedAppPackageSchema.parse(raw);
  assertCrypto(value.appId === appId && value.intent.packageRevision === packageRevision);
  return openAppPackage(value, crypto, signal);
}
export function verifyFrozenAppOperation(raw: FrozenAppOperation, original: AppOperation | AppPackageCandidate) {
  const value = frozenAppOperationSchema.parse(raw), parsed = Object.hasOwn(original, "kind") ? appOperationSchema.parse(original) : packageCandidateInputSchema.parse(original);
  assertCrypto(value.plaintextHash === recordCipherHash(parsed) && value.transport.appId === parsed.appId && value.transport.operationId === parsed.operationId);
  verifyAppOperation(value.transport, value.encryptedSpace.scope); return value;
}
export async function openAppReceipt(raw: EncryptedAppReceipt, frozen: FrozenAppOperation, crypto: AppCipherPort, signal: AbortSignal): Promise<AppReceipt> {
  const receipt = encryptedAppReceiptSchema.parse(raw), binding = frozenAppOperationSchema.parse(frozen), transport = verifyAppOperation(binding.transport, crypto.scope);
  assertExpectedScope(binding.encryptedSpace.scope, crypto.scope); assertCrypto(binding.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint, "sync-space-changed");
  assertCrypto(receipt.operationId === transport.operationId && receipt.appId === transport.appId && receipt.ciphertextHash === transport.ciphertextHash &&
    receipt.kind === transport.intent.kind && receipt.projectId === transport.intent.projectId && receipt.baseId === transport.intent.baseId);
  const proof = operationProofSchema.parse(await decryptRecordPacket(crypto, transport.operation,
    createAppContext(crypto.scope, transport.appId, transport.operationId, { role: "operation", projectId: transport.intent.projectId, baseId: transport.intent.baseId,
      expectedRevision: transport.intent.expectedRevision, packageRevision: transport.intent.packageRevision ?? 0, metadataCommitment: hashAppCommitMetadata(transport) }), signal));
  assertCrypto(proof.plaintextHash === binding.plaintextHash && proof.appId === transport.appId && proof.operationId === transport.operationId);
  if (receipt.outcome === "applied" || receipt.outcome === "converged") assertCrypto(receipt.revision === transport.intent.expectedRevision + 1);
  const { ciphertextHash: _hash, ...metadata } = receipt; return appReceiptSchema.parse({ ...metadata, payloadHash: binding.plaintextHash });
}
export type { EncryptedFileDescriptor };
