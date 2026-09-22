/**
 * [INPUT]: Original classification candidates, decoded Chat heads and admitted App/record crypto.
 * [OUTPUT]: Exact frozen classification transports and authenticated original-hash receipts.
 * [POS]: Client classification codec; canonical domain facts remain owned by the existing Store.
 */
import { assertCrypto, assertExpectedScope } from "../../../encryption";
import { canonicalRecordJson, recordCipherHash } from "../../../projects/encrypted";
import { encryptRecordPacket, decryptRecordPacket } from "../../../projects/encrypted/client";
import { prepareAppPromotion } from "../../../apps/encrypted/promotion-client";
import { matchesBasePromotionProof } from "../../../apps/promotion";
import { chatClassificationOperationSchema, chatClassificationReceiptSchema, hashChatClassificationOperation, type ChatClassificationOperation } from "../../classification";
import { portableForkLineage, type CloudChatHead } from "../../model";
import { openChatHeadForRequest, sealChatPacket, sortKeyFacts, type ChatCipherPort } from "../client";
import { encryptedClassificationReceiptSchema, frozenClassificationSchema, type EncryptedClassificationReceipt, type FrozenClassification } from "./model";
import { classificationContext, classificationFactsMetadata, verifyClassificationOperation } from "./wire";
function allowed(original: ChatClassificationOperation) {
  const promotion = original.basePromotion;
  return { incarnationId: original.incarnationId, expectedRevision: original.expectedRevision,
    previous: original.previous, next: original.next, projectRescue: original.projectRescue ?? null,
    basePromotion: promotion ? { baseId: promotion.baseId, expectedRevision: promotion.expectedRevision,
      destination: promotion.destination.kind === "app" ? { kind: "app" as const, projectId: promotion.destination.projectId, appId: promotion.destination.appId } : promotion.destination } : null };
}
export function verifyFrozenClassification(raw: FrozenClassification, input: ChatClassificationOperation) {
  const frozen = frozenClassificationSchema.parse(raw), original = chatClassificationOperationSchema.parse(input);
  const transport = verifyClassificationOperation(frozen.transport, frozen.encryptedSpace.scope), { agent: _agent, agentRevision: _agentRevision,
    sourceDeviceId: _device, createdAt: _createdAt, archivedAt: _archivedAt, ...intent } = transport.intent;
  assertCrypto(hashChatClassificationOperation(original) === original.payloadHash && frozen.plaintextHash === original.payloadHash &&
    frozen.candidateHash === original.candidateHash && transport.lifecycleOperationId === original.lifecycleOperationId && transport.chatId === original.chatId &&
    canonicalRecordJson(intent) === canonicalRecordJson(allowed(original))); return frozen;
}
export async function prepareClassificationOperation(input: ChatClassificationOperation, current: CloudChatHead,
  crypto: ChatCipherPort, signal: AbortSignal, baseSchemaRevision = 0): Promise<FrozenClassification> {
  const original = chatClassificationOperationSchema.parse(input);
  assertCrypto(hashChatClassificationOperation(original) === original.payloadHash && current.chat.id === original.chatId && current.chat.incarnationId === original.incarnationId);
  const intent = { ...allowed(original), sourceDeviceId: crypto.session.deviceId, agent: current.chat.agent,
    agentRevision: current.chat.agentRevision, createdAt: current.chat.createdAt, archivedAt: current.archivedAt };
  const facts = await sealChatPacket(crypto, original.chatId, { operationId: original.lifecycleOperationId, role: "facts",
    metadata: classificationFactsMetadata({ intent }) }, { title: current.chat.title, classification: original.next,
    archivedAt: current.archivedAt, createdAt: current.chat.createdAt, ...sortKeyFacts(current.chat.sortKey), ...portableForkLineage(current.chat) }, signal);
  const promotion = original.basePromotion, destination = promotion?.destination;
  const app = destination?.kind === "app" ? await prepareAppPromotion({ appId: destination.appId, projectId: destination.projectId,
    operationId: original.lifecycleOperationId, baseId: promotion!.baseId, baseRevision: promotion!.expectedRevision,
    baseSchemaRevision, displayName: destination.displayName, createdAt: Date.now() }, crypto, signal) : null;
  const aggregate = { lifecycleOperationId: original.lifecycleOperationId, chatId: original.chatId, intent, facts, app };
  const operation = await encryptRecordPacket(crypto, classificationContext(crypto.scope, aggregate), original, signal);
  const payload = { ...aggregate, operation };
  return verifyFrozenClassification({ kind: "encrypted-chat-classification", encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint },
    plaintextHash: original.payloadHash, candidateHash: original.candidateHash, transport: { ...payload, ciphertextHash: recordCipherHash(payload) } }, original);
}
export async function openClassificationReceipt(input: EncryptedClassificationReceipt, frozen: FrozenClassification,
  crypto: ChatCipherPort, signal: AbortSignal = new AbortController().signal) {
  const receipt = encryptedClassificationReceiptSchema.parse(input), binding = frozenClassificationSchema.parse(frozen);
  assertExpectedScope(binding.encryptedSpace.scope, crypto.scope);
  assertCrypto(binding.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint);
  const transport = verifyClassificationOperation(receipt.commit, crypto.scope);
  assertCrypto(canonicalRecordJson(transport) === canonicalRecordJson(binding.transport) && receipt.ciphertextHash === transport.ciphertextHash &&
    receipt.lifecycleOperationId === transport.lifecycleOperationId && receipt.chatId === transport.chatId &&
    receipt.sourceDeviceId === transport.intent.sourceDeviceId && receipt.expectedRevision === transport.intent.expectedRevision);
  const original = chatClassificationOperationSchema.parse(await decryptRecordPacket(crypto, transport.operation, classificationContext(crypto.scope, transport), signal));
  verifyFrozenClassification(binding, original);
  const head = receipt.head ? await openChatHeadForRequest(receipt.head, original.chatId, crypto, signal) : null;
  if (receipt.status === "applied") {
    assertCrypto(head && head.chat.id === original.chatId && head.chat.incarnationId === original.incarnationId &&
      head.chat.cloudRevision === original.expectedRevision + 1 && canonicalRecordJson(head.chat.classification) === canonicalRecordJson(original.next) &&
      canonicalRecordJson(receipt.head!.facts) === canonicalRecordJson(transport.facts) && matchesBasePromotionProof(original.basePromotion, receipt.basePromotion));
  } else assertCrypto(receipt.basePromotion === undefined);
  return chatClassificationReceiptSchema.parse({ lifecycleOperationId: original.lifecycleOperationId, chatId: original.chatId,
    candidateHash: original.candidateHash, payloadHash: original.payloadHash, expectedRevision: original.expectedRevision,
    status: receipt.status, head, sourceDeviceId: receipt.sourceDeviceId, createdAt: receipt.createdAt,
    ...(receipt.basePromotion ? { basePromotion: receipt.basePromotion } : {}) });
}
