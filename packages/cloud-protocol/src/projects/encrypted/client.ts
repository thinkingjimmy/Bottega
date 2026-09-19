/**
 * [INPUT]: An admitted crypto owner, original Project domain operations and verified ciphertext transports.
 * [OUTPUT]: Bounded Project encryption, request-bound single heads, authenticated catalogs and original-hash receipts.
 * [POS]: Shared desktop/Web codec; durable queues and Store commits remain with their existing domain owners.
 */
import { z } from "zod";
import { assertCrypto, assertExpectedScope, createProjectContext, encodeBase64url, type CryptoContext } from "../../encryption";
import type { FileCipherPort } from "../../blobs/encrypted/model";
import { projectOperationSchema, projectMetadataSchema, portableProjectSchema, projectReceiptSchema, hashProjectOperation,
  type ProjectOperation, type PortableProject } from "../model";
import { encryptedProjectHeadSchema, encryptedProjectReceiptSchema, frozenProjectOperationSchema, projectPacketSchema,
  type ProjectIntent, type ProjectPacket, type EncryptedProjectHead, type EncryptedProjectReceipt, type FrozenProjectOperation } from "./model";
import { canonicalRecordJson, hashProjectCommitMetadata, projectFactsContext, recordCipherHash, verifyProjectHead, verifyProjectOperation, verifyRecordPacket } from "./wire";
export type ProjectCipherPort = FileCipherPort;
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
const factsSchema = z.object({ schema: z.literal("bottega.encrypted-project-facts/v1"), metadata: projectMetadataSchema }).strict();
export async function encryptRecordPacket(crypto: ProjectCipherPort, context: CryptoContext, value: unknown, signal: AbortSignal): Promise<ProjectPacket> {
  const plaintext = encoder.encode(canonicalRecordJson(value));
  try {
    signal.throwIfAborted(); const result = await crypto.run({ kind: "encrypt", context, plaintext }, signal);
    signal.throwIfAborted(); assertCrypto(result.kind === "encrypted");
    const packet = projectPacketSchema.parse({ envelope: encodeBase64url(result.envelope), ciphertextHash: result.ciphertextHash, ciphertextBytes: result.envelope.byteLength });
    verifyRecordPacket(packet, context); return packet;
  } finally { plaintext.fill(0); }
}
export async function decryptRecordPacket(crypto: ProjectCipherPort, packet: ProjectPacket, context: CryptoContext, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted(); const bytes = verifyRecordPacket(packet, context);
  const result = await crypto.run({ kind: "decrypt", expectedContext: context, envelope: bytes }, signal);
  assertCrypto(result.kind === "decrypted");
  try { signal.throwIfAborted(); return JSON.parse(decoder.decode(result.plaintext)); } finally { result.plaintext.fill(0); }
}
function candidateMetadata(operation: ProjectOperation, previous: PortableProject | null) {
  if (operation.command.kind === "create") return operation.command.metadata;
  assertCrypto(previous && previous.id === operation.projectId && previous.cloudRevision === operation.command.expectedRevision);
  if (operation.command.kind === "delete") return projectMetadataSchema.parse({ name: previous.name, sortIndex: previous.sortIndex,
    ...(previous.gitRemote ? { gitRemote: previous.gitRemote } : {}),
    ...(previous.appearance ? { appearance: previous.appearance } : {}), ...(previous.archivedAt === undefined ? {} : { archivedAt: previous.archivedAt }) });
  const value = { ...previous, ...operation.command.changes };
  return projectMetadataSchema.parse({ name: value.name, sortIndex: value.sortIndex,
    ...(value.gitRemote ? { gitRemote: value.gitRemote } : {}),
    ...(value.appearance ? { appearance: value.appearance } : {}), ...(value.archivedAt == null ? {} : { archivedAt: value.archivedAt }) });
}
export async function prepareProjectOperation(raw: ProjectOperation, previous: PortableProject | null, crypto: ProjectCipherPort,
  signal: AbortSignal, authority?: { role: PortableProject["role"]; appId: string | null }): Promise<FrozenProjectOperation> {
  const operation = projectOperationSchema.parse(raw); assertCrypto(await hashProjectOperation(operation) === operation.payloadHash);
  const metadata = candidateMetadata(operation, previous), expectedRevision = operation.command.kind === "create" ? 0 : operation.command.expectedRevision;
  const intent: ProjectIntent = { kind: operation.command.kind, role: authority?.role ?? previous?.role ?? "workspace", appId: authority ? authority.appId : previous?.appId ?? null,
    sourceDeviceId: previous?.sourceDeviceId ?? crypto.session.deviceId, actorDeviceId: crypto.session.deviceId, expectedRevision,
    createdAt: operation.command.kind === "create" ? operation.command.createdAt : previous!.createdAt,
    archivedAt: metadata.archivedAt ?? null, order: metadata.sortIndex };
  const facts = operation.command.kind === "delete" ? null : await encryptRecordPacket(crypto,
    projectFactsContext(crypto.scope, operation.projectId, operation.operationId, intent), { schema: "bottega.encrypted-project-facts/v1", metadata }, signal);
  const encryptedOperation = await encryptRecordPacket(crypto, createProjectContext(crypto.scope, operation.projectId, operation.operationId,
    { role: "operation", expectedRevision, metadataCommitment: hashProjectCommitMetadata(intent, facts) }), operation, signal);
  const payload = { projectId: operation.projectId, operationId: operation.operationId, intent, facts, operation: encryptedOperation };
  return frozenProjectOperationSchema.parse({ encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint },
    plaintextHash: operation.payloadHash, transport: { ...payload, ciphertextHash: recordCipherHash(payload) } });
}
export async function openProjectHead(raw: EncryptedProjectHead, crypto: ProjectCipherPort, signal: AbortSignal): Promise<PortableProject> {
  const head = verifyProjectHead(raw, crypto.scope, crypto.keyPackageFingerprint);
  const facts = factsSchema.parse(await decryptRecordPacket(crypto, head.facts,
    projectFactsContext(crypto.scope, head.projectId, head.operationId, head.intent), signal));
  assertCrypto(facts.metadata.sortIndex === head.intent.order && (facts.metadata.archivedAt ?? null) === head.intent.archivedAt);
  return portableProjectSchema.parse({ ...facts.metadata, id: head.projectId, sourceDeviceId: head.intent.sourceDeviceId,
    role: head.intent.role, appId: head.intent.appId, createdAt: head.createdAt, updatedAt: head.updatedAt, cloudRevision: head.revision });
}
export async function openProjectHeadForRequest(raw: EncryptedProjectHead, projectId: string, crypto: ProjectCipherPort,
  signal: AbortSignal): Promise<PortableProject> {
  const head = encryptedProjectHeadSchema.parse(raw);
  assertCrypto(head.projectId === projectId);
  return openProjectHead(head, crypto, signal);
}
export async function openProjectReceipt(raw: EncryptedProjectReceipt, frozen: FrozenProjectOperation, crypto: ProjectCipherPort, signal: AbortSignal) {
  const binding = frozenProjectOperationSchema.parse(frozen), receipt = encryptedProjectReceiptSchema.parse(raw);
  assertExpectedScope(binding.encryptedSpace.scope, crypto.scope);
  assertCrypto(binding.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint, "sync-space-changed");
  const transport = verifyProjectOperation(binding.transport, crypto.scope);
  assertCrypto(receipt.operationId === transport.operationId && receipt.projectId === transport.projectId && receipt.ciphertextHash === transport.ciphertextHash);
  const operation = projectOperationSchema.parse(await decryptRecordPacket(crypto, transport.operation,
    createProjectContext(crypto.scope, transport.projectId, transport.operationId, { role: "operation", expectedRevision: transport.intent.expectedRevision,
      metadataCommitment: hashProjectCommitMetadata(transport.intent, transport.facts) }), signal));
  assertCrypto(operation.payloadHash === binding.plaintextHash && await hashProjectOperation(operation) === binding.plaintextHash &&
    operation.operationId === transport.operationId && operation.projectId === transport.projectId && operation.command.kind === transport.intent.kind);
  if (receipt.status === "applied" || receipt.status === "converged") assertCrypto(receipt.project && receipt.project.operationId === transport.operationId &&
    receipt.project.facts.ciphertextHash === transport.facts?.ciphertextHash && receipt.project.revision === transport.intent.expectedRevision + 1);
  const project = receipt.project ? await openProjectHeadForRequest(receipt.project, transport.projectId, crypto, signal) : null;
  if (project) assertCrypto(project.id === receipt.projectId);
  // Only the authenticated client can decide equal-value convergence after a ciphertext-blind CAS conflict.
  const converged = receipt.status === "conflicted" && project && operation.command.kind === "patch" &&
    Object.entries(operation.command.changes).every(([key, value]) => canonicalRecordJson(project[key as keyof PortableProject] ?? null) === canonicalRecordJson(value));
  return projectReceiptSchema.parse({ operationId: receipt.operationId, projectId: receipt.projectId, payloadHash: binding.plaintextHash,
    status: converged ? "converged" : receipt.status, project, sourceDeviceId: receipt.sourceDeviceId, createdAt: receipt.createdAt });
}
