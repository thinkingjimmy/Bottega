/**
 * [INPUT]: An admitted worker, original plaintext metadata operations and immutable ciphertext Chat DTOs.
 * [OUTPUT]: Frozen ciphertext commits, catalog/request-bound heads (sortKey bound clear-to-facts like createdAt) and verified original-domain receipts.
 * [POS]: Client-only semantic bridge; original Stores retain queues, source hashes and conflict policy.
 */
import { z } from "zod";
import { openRemoteCreation } from "../../remote/encrypted/creation";
import { remoteCreationIdentity, remoteHash } from "../../remote/encrypted/wire";
import { canonicalJson } from "../../encryption/encoding";
import { assertCrypto, assertExpectedScope, encodeBase64url } from "../../encryption";
import type { FileCipherPort } from "../../blobs/encrypted";
import { forkLineageFields, portableForkLineage, chatSortKeySchema, cloudChatHeadSchema, portableChatSchema, type CloudChatHead } from "../model";
import { chatMetadataOperationSchema, chatMetadataReceiptSchema, hashChatMetadataOperation, type ChatMetadataOperation } from "../metadata";
import { turnOptionsSchema } from "../options";
import { chatPacketSchema, encryptedChatHeadSchema, encryptedChatMetadataReceiptSchema, frozenChatMetadataSchema, publicChatSchema,
  type ChatPacket, type EncryptedChatHead, type EncryptedChatMetadataReceipt, type EncryptedChatMetadataOperation } from "./model";
import { chatOperationMetadata, chatPacketContext, validateChatPacket, hashEncryptedChatOperation, validateEncryptedChatOperation } from "./wire";
export type ChatCipherPort = FileCipherPort;
const privateFacts = z.object({ title: portableChatSchema.shape.title, classification: portableChatSchema.shape.classification,
  archivedAt: cloudChatHeadSchema.shape.archivedAt, createdAt: portableChatSchema.shape.createdAt, sortKey: chatSortKeySchema.optional(), ...forkLineageFields }).strict();
/** Facts packets carry the key only when set; packets sealed before sortKey existed open as "never moved". */
export const sortKeyFacts = (sortKey: number | null | undefined) => sortKey == null ? {} : { sortKey };
const privateOptions = z.object({ options: turnOptionsSchema }).strict();
export async function sealChatPacket(crypto: ChatCipherPort, chatId: string, identity: Pick<ChatPacket, "operationId" | "role" | "metadata">,
  value: unknown, signal?: AbortSignal): Promise<ChatPacket> {
  const plaintext = new TextEncoder().encode(canonicalJson(value));
  try {
    const result = await crypto.run({ kind: "encrypt", context: chatPacketContext(crypto.scope, chatId, identity), plaintext }, signal);
    assertCrypto(result.kind === "encrypted");
    return chatPacketSchema.parse({ ...identity, envelope: encodeBase64url(result.envelope), ciphertextHash: result.ciphertextHash, ciphertextBytes: result.envelope.byteLength });
  } finally { plaintext.fill(0); }
}
export async function openChatPacket(crypto: ChatCipherPort, chatId: string, packet: ChatPacket, signal?: AbortSignal): Promise<unknown> {
  const envelope = validateChatPacket(crypto.scope, chatId, packet);
  const result = await crypto.run({ kind: "decrypt", expectedContext: chatPacketContext(crypto.scope, chatId, packet), envelope }, signal);
  assertCrypto(result.kind === "decrypted");
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(result.plaintext), value: unknown = JSON.parse(text);
    assertCrypto(canonicalJson(value) === text); return value;
  } finally { result.plaintext.fill(0); }
}
export async function openChatHead(raw: EncryptedChatHead, crypto: ChatCipherPort, signal?: AbortSignal): Promise<CloudChatHead> {
  const head = encryptedChatHeadSchema.parse(raw);
  assertExpectedScope(head.encryptedSpace.scope, crypto.scope);
  assertCrypto(head.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint);
  if (head.remoteCreation) {
    const privateCreation = await openRemoteCreation(head.remoteCreation, crypto, signal);
    const identity = remoteCreationIdentity(crypto.scope, head.remoteCreation.createOperationId);
    assertCrypto(head.chat.id === identity.chatId && head.chat.incarnationId === identity.incarnationId);
    const { encryptedSpace: _space, facts: _facts, options: _options, remoteCreation: _creation, ...publicHead } = head;
    return cloudChatHeadSchema.parse({ ...publicHead, chat: { ...head.chat, title: privateCreation.title, options: privateCreation.options } });
  }
  assertCrypto(head.facts !== null && head.options !== null);
  const facts = privateFacts.parse(await openChatPacket(crypto, head.chat.id, head.facts, signal));
  const options = privateOptions.parse(await openChatPacket(crypto, head.chat.id, head.options, signal)).options;
  assertCrypto(head.facts.metadata.incarnationId === head.chat.incarnationId && head.options.metadata.incarnationId === head.chat.incarnationId &&
    head.facts.metadata.expectedRevision + 1 === head.chat.cloudRevision && facts.createdAt === head.chat.createdAt &&
    (facts.sortKey ?? null) === (head.chat.sortKey ?? null) &&
    facts.archivedAt === head.archivedAt && head.facts.metadata.archivedAt === head.archivedAt &&
    canonicalJson(facts.classification) === canonicalJson(head.chat.classification) &&
    canonicalJson(head.facts.metadata.classification) === canonicalJson({ kind: head.chat.classification.conversationKind,
      projectId: head.chat.classification.projectId, appId: head.chat.classification.appId }) &&
    options.backend === head.chat.agent && head.options.metadata.agent === head.chat.agent && head.options.metadata.agentRevision === head.chat.agentRevision);
  const { encryptedSpace: _space, facts: _facts, options: _options, remoteCreation: _creation, ...publicHead } = head;
  return cloudChatHeadSchema.parse({ ...publicHead, chat: { ...head.chat, title: facts.title, options, ...portableForkLineage(facts) } });
}
export async function openChatHeadForRequest(raw: EncryptedChatHead, chatId: string, crypto: ChatCipherPort, signal?: AbortSignal): Promise<CloudChatHead> {
  const head = encryptedChatHeadSchema.parse(raw);
  assertCrypto(head.chat.id === chatId);
  return openChatHead(head, crypto, signal);
}
export async function prepareChatMetadataOperation(raw: ChatMetadataOperation, current: CloudChatHead | null,
  crypto: ChatCipherPort, signal?: AbortSignal) {
  const original = chatMetadataOperationSchema.parse(raw);
  assertCrypto(hashChatMetadataOperation(original) === original.payloadHash);
  const command = original.command;
  assertCrypto(command.kind === "create" || current?.chat.id === original.chatId && current.chat.incarnationId === command.incarnationId);
  const chat = command.kind === "create" ? command.chat : current!.chat;
  const expectedRevision = command.kind === "create" ? 0 : command.expectedRevision;
  const archivedAt = command.kind === "create" ? command.archivedAt : command.changes.archivedAt === undefined ? current!.archivedAt : command.changes.archivedAt;
  const title = command.kind === "create" ? command.chat.title : command.changes.title === undefined ? current!.chat.title : command.changes.title;
  const sortKey = command.kind === "create" ? command.chat.sortKey ?? null
    : command.changes.sortKey === undefined ? current!.chat.sortKey ?? null : command.changes.sortKey;
  const base = { operationId: original.operationId, chatId: original.chatId, kind: command.kind,
    chat: publicChatSchema.parse({ id: chat.id, incarnationId: chat.incarnationId, agent: chat.agent, agentRevision: chat.agentRevision,
      classification: chat.classification, cloudRevision: expectedRevision, createdAt: chat.createdAt, updatedAt: chat.updatedAt, ...sortKeyFacts(sortKey) }),
    archivedAt, lifecycleKind: command.kind === "create" ? command.lifecycleKind : current!.kind,
    expectedRevision, sourceDeviceId: crypto.session.deviceId };
  const identity = { operationId: original.operationId, metadata: chatOperationMetadata(base) };
  const facts = await sealChatPacket(crypto, original.chatId, { ...identity, role: "facts" }, privateFacts.parse({ title,
    classification: chat.classification, archivedAt, createdAt: chat.createdAt, ...sortKeyFacts(sortKey), ...portableForkLineage(chat) }), signal);
  const options = command.kind === "create" ? await sealChatPacket(crypto, original.chatId, { ...identity, role: "options" }, { options: chat.options }, signal) : null;
  const operation = await sealChatPacket(crypto, original.chatId, { ...identity, role: "metadata" }, original, signal);
  const transport: EncryptedChatMetadataOperation = { ...base, facts, options, operation, ciphertextHash: "0".repeat(64) };
  transport.ciphertextHash = hashEncryptedChatOperation(transport);
  return frozenChatMetadataSchema.parse({ kind: "encrypted-chat-metadata", encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint },
    plaintextHash: original.payloadHash, transport });
}
export async function openChatMetadataReceipt(raw: EncryptedChatMetadataReceipt, crypto: ChatCipherPort, signal?: AbortSignal) {
  const receipt = encryptedChatMetadataReceiptSchema.parse(raw), commit = validateEncryptedChatOperation(crypto.scope, receipt.commit);
  assertCrypto(receipt.operationId === commit.operationId && receipt.chatId === commit.chatId && receipt.ciphertextHash === commit.ciphertextHash);
  const operation = chatMetadataOperationSchema.parse(await openChatPacket(crypto, receipt.chatId, commit.operation, signal));
  assertCrypto(operation.operationId === receipt.operationId && operation.chatId === receipt.chatId && hashChatMetadataOperation(operation) === operation.payloadHash);
  const head = receipt.head ? await openChatHeadForRequest(receipt.head, receipt.chatId, crypto, signal) : null;
  let status = receipt.status;
  if (status === "conflicted" && head && operation.command.kind === "patch" && head.chat.incarnationId === operation.command.incarnationId) {
    const changes = operation.command.changes;
    if ((changes.title === undefined || changes.title === head.chat.title) && (changes.archivedAt === undefined || changes.archivedAt === head.archivedAt) &&
      (changes.sortKey === undefined || changes.sortKey === (head.chat.sortKey ?? null))) status = "converged";
  }
  return chatMetadataReceiptSchema.parse({ operationId: receipt.operationId, chatId: receipt.chatId, payloadHash: operation.payloadHash,
    status, head, sourceDeviceId: receipt.sourceDeviceId, createdAt: receipt.createdAt });
}

export async function prepareRemoteChatInitialization(raw: EncryptedChatHead, crypto: ChatCipherPort, signal?: AbortSignal) {
  const head = encryptedChatHeadSchema.parse(raw); assertCrypto(head.remoteCreation !== null && head.ownerDeviceId === crypto.session.deviceId);
  const opened = await openChatHead(head, crypto, signal), operationId = remoteHash(["remote-initial", head.remoteCreation.createOperationId]);
  const metadata = { incarnationId: head.chat.incarnationId, classification: { kind: "ordinary" as const, appId: null, projectId: head.chat.classification.projectId },
    sourceDeviceId: head.remoteCreation.binding.targetDeviceId, agent: head.chat.agent, agentRevision: 0, expectedRevision: 0, archivedAt: null, references: [] };
  const facts = await sealChatPacket(crypto, head.chat.id, { operationId, role: "facts", metadata }, privateFacts.parse({ title: opened.chat.title,
    classification: opened.chat.classification, archivedAt: null, createdAt: opened.chat.createdAt, ...sortKeyFacts(opened.chat.sortKey), ...portableForkLineage(opened.chat) }), signal);
  const options = await sealChatPacket(crypto, head.chat.id, { operationId, role: "options", metadata }, { options: opened.chat.options }, signal);
  return { kind: "encrypted-remote-initial" as const, encryptedSpace: head.encryptedSpace, chatId: head.chat.id, incarnationId: head.chat.incarnationId,
    creationHash: head.remoteCreation.ciphertextHash, facts, options };
}
