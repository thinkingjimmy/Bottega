/**
 * [INPUT]: Fixed turn context v2, canonical ciphertext envelopes and closed public frame metadata.
 * [OUTPUT]: Server-safe context/hash checks and deterministic durable-prefix membership.
 * [POS]: AAD commits complete routing, time, sequence and hash-chain metadata through a domain-specific operation identity.
 */
import { canonicalJson } from "../../encryption/encoding";
import { createTurnContext, assertCrypto, assertExpectedContext, decodeBase64url, hashEnvelope, parseEnvelope, type CryptoScope } from "../../encryption";
import { messageMembershipSchema } from "../../encryption/domains/messages";
import { validateChatPacket } from "../../chats/encrypted/wire";
import { hashChatContent } from "../../chats/transcript/body";
import { turnIdentitySchema, type TurnIdentity } from "../model";
import { encryptedTurnStartSchema, encryptedTurnChunkSchema, encryptedTurnFinalSchema, encryptedTurnPrefixSchema,
  type EncryptedTurnStart, type EncryptedTurnChunk, type EncryptedTurnFinal, type EncryptedTurnPrefix, type TurnPacket } from "./model";
export const cipherTurnIdentity = (value: TurnIdentity): TurnIdentity => turnIdentitySchema.parse(Object.fromEntries(Object.keys(turnIdentitySchema.shape).map(key => [key, value[key as keyof TurnIdentity]])));
export function turnFrameContext(scope: CryptoScope, identity: Omit<TurnIdentity, "identityHash">, kind: "start" | "chunk" | "final", sequence: number, header: unknown) {
  return createTurnContext(scope, identity.chatId, hashChatContent(["turn-cipher-frame-v1", kind, header]), { incarnationId: identity.incarnationId,
    turnId: identity.turnId, frameSequence: sequence, frameKind: kind === "final" ? "final" : "event",
    snapshotId: null, replacementIndex: null, replacementCount: null });
}
export function startFrameHeader(raw: EncryptedTurnStart) { const { packet: _packet, identityHash: _hash, ...value } = encryptedTurnStartSchema.parse(raw); return value; }
export function chunkFrameHeader(identity: TurnIdentity, raw: EncryptedTurnChunk) { const { packet: _packet, ...value } = encryptedTurnChunkSchema.parse(raw); return { turn: turnIdentitySchema.parse(identity), ...value }; }
export function finalFrameHeader(raw: EncryptedTurnFinal) { const { packet: _packet, ...value } = encryptedTurnFinalSchema.parse(raw); return value; }
function validateTurnPacket(packet: TurnPacket, context: ReturnType<typeof turnFrameContext>) {
  const bytes = decodeBase64url(packet.envelope, 1, 98_304);
  assertCrypto(bytes.byteLength === packet.ciphertextBytes && hashEnvelope(bytes) === packet.ciphertextHash);
  assertExpectedContext(parseEnvelope(bytes).context, context); return bytes;
}
export function validateTurnStart(scope: CryptoScope, raw: EncryptedTurnStart) {
  const value = encryptedTurnStartSchema.parse(raw), options = value.optionsPacket; validateChatPacket(scope, value.chatId, options);
  assertCrypto(options.role === "options" && options.metadata.incarnationId === value.incarnationId && options.metadata.sourceDeviceId === value.ownerDeviceId &&
    options.metadata.agent === value.backend && options.metadata.agentRevision === value.expectedAgentRevision + Number(value.noticeSeq !== undefined) &&
    options.metadata.references.length === 0);
  validateTurnPacket(value.packet, turnFrameContext(scope, value, "start", 0, startFrameHeader(value))); return value;
}
export function validateTurnChunk(scope: CryptoScope, identity: TurnIdentity, raw: EncryptedTurnChunk) {
  const value = encryptedTurnChunkSchema.parse(raw);
  validateTurnPacket(value.packet, turnFrameContext(scope, identity, "chunk", value.seq, chunkFrameHeader(identity, value))); return value;
}
export function validateTurnFinal(scope: CryptoScope, raw: EncryptedTurnFinal) {
  const value = encryptedTurnFinalSchema.parse(raw);
  validateTurnPacket(value.packet, turnFrameContext(scope, value, "final", value.expectedHighSeq, finalFrameHeader(value))); return value;
}
export function hashTurnPrefix(raw: EncryptedTurnPrefix) { const { bodyHash: _hash, ...value } = encryptedTurnPrefixSchema.parse(raw); return hashChatContent(["turn-cipher-prefix-v1", value]); }
export function validateTurnPrefix(scope: CryptoScope, raw: EncryptedTurnPrefix) {
  const value = encryptedTurnPrefixSchema.parse(raw); validateTurnStart(scope, value.start);
  assertCrypto(canonicalJson(value.encryptedSpace.scope) === canonicalJson(scope) && value.bodyHash === hashTurnPrefix(value) &&
    (value.highSeq > 0 || value.lastCiphertextHash === value.start.identityHash)); return value;
}
export function turnPrefixMembership(value: EncryptedTurnPrefix) {
  return messageMembershipSchema.parse({ chatId: value.start.chatId, incarnationId: value.start.incarnationId,
    messageId: value.start.assistantMessageId, source: "native", generationId: null, seq: value.start.assistantSeq, messageRole: "assistant",
    originalCreatedAt: value.start.createdAt, timeState: "valid", versionId: value.bodyHash, manifestId: value.bodyHash });
}
export function turnPrefixSummary(value: EncryptedTurnPrefix) {
  return { messageId: value.start.assistantMessageId, seq: value.start.assistantSeq, role: "assistant" as const, backend: value.start.backend,
    createdAt: value.start.createdAt, timeState: "valid" as const, source: "native" as const, generationId: null, blobs: [], turnId: value.start.turnId,
    completion: "interrupted" as const, ciphertextBytes: value.ciphertextBytes };
}
