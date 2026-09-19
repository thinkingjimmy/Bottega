/**
 * [INPUT]: Exact classification intent, ciphertext facts/App bundles and named Chat contexts.
 * [OUTPUT]: Canonical aggregate hashes and server-safe intent/context validation.
 * [POS]: Classification integrity boundary; no semantic plaintext parser is available here.
 */
import { assertCrypto, createChatContext, type CryptoScope } from "../../../encryption";
import { canonicalRecordJson, recordCipherHash, verifyRecordPacket } from "../../../projects/encrypted";
import { verifyAppPromotion } from "../../../apps/encrypted/promotion";
import { validateChatPacket } from "../wire";
import { classificationIntentSchema, encryptedClassificationOperationSchema, type EncryptedClassificationOperation } from "./model";
export function classificationFactsMetadata(value: Pick<EncryptedClassificationOperation, "intent">) {
  const { intent } = value;
  return { incarnationId: intent.incarnationId, classification: { kind: intent.next.conversationKind, projectId: intent.next.projectId, appId: intent.next.appId },
    sourceDeviceId: intent.sourceDeviceId, agent: intent.agent, agentRevision: intent.agentRevision, expectedRevision: intent.expectedRevision,
    executionEpoch: intent.executionEpoch, archivedAt: intent.archivedAt, references: [] };
}
function hashClassificationMetadata(value: Pick<EncryptedClassificationOperation, "lifecycleOperationId" | "chatId" | "intent" | "facts" | "app">) {
  return recordCipherHash({ schema: "bottega.classification-commit/v1", lifecycleOperationId: value.lifecycleOperationId, chatId: value.chatId,
    intent: classificationIntentSchema.parse(value.intent), facts: { ciphertextHash: value.facts.ciphertextHash, ciphertextBytes: value.facts.ciphertextBytes },
    app: value.app?.ciphertextHash ?? null });
}
export function classificationContext(scope: CryptoScope, value: Pick<EncryptedClassificationOperation, "lifecycleOperationId" | "chatId" | "intent" | "facts" | "app">) {
  return createChatContext(scope, value.chatId, value.lifecycleOperationId, { role: "classification", incarnationId: value.intent.incarnationId,
    expectedRevision: value.intent.expectedRevision, metadataCommitment: hashClassificationMetadata(value) });
}
export function verifyClassificationOperation(raw: EncryptedClassificationOperation, scope: CryptoScope) {
  const value = encryptedClassificationOperationSchema.parse(raw), { ciphertextHash: _hash, ...payload } = value;
  assertCrypto(new TextEncoder().encode(canonicalRecordJson(value)).byteLength <= 196_608 && recordCipherHash(payload) === value.ciphertextHash);
  assertCrypto(value.facts.operationId === value.lifecycleOperationId && value.facts.role === "facts" &&
    canonicalRecordJson(value.facts.metadata) === canonicalRecordJson(classificationFactsMetadata(value)));
  validateChatPacket(scope, value.chatId, value.facts);
  if (value.app) {
    const app = verifyAppPromotion(value.app, scope), transfer = value.intent.basePromotion!;
    assertCrypto(transfer.destination.kind === "app" && app.appId === transfer.destination.appId && app.intent.projectId === transfer.destination.projectId &&
      app.intent.baseId === transfer.baseId && app.baseRevision === transfer.expectedRevision && app.operationId === value.lifecycleOperationId &&
      app.intent.actorDeviceId === value.intent.sourceDeviceId);
  }
  verifyRecordPacket(value.operation, classificationContext(scope, value)); return value;
}
