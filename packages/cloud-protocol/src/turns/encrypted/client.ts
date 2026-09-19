/**
 * [INPUT]: Original local turn records, admitted content crypto, ciphertext body mappings and frozen public headers.
 * [OUTPUT]: Authenticated starts/chunks/finals with original plaintext identities preserved after opening.
 * [POS]: Client semantic boundary; callers freeze packets in their existing outbox before transmitting them.
 */
import { canonicalJson } from "../../encryption/encoding";
import type { FileCipherPort } from "../../blobs/encrypted";
import { assertCrypto, decodeBase64url, encodeBase64url } from "../../encryption";
import type { ChatPacket } from "../../chats/encrypted/model";
import { openChatPacket } from "../../chats/encrypted/client";
import { hashTurnIdentity, turnStartSchema, turnFinalSchema, type TurnStart, type TurnIdentity, type TurnFinal } from "../model";
import { hashTurnChunk, turnChunkSchema, type TurnChunk, type LiveProjection } from "../live";
import { prepareTurnRouting, assertPrivateRouting } from "./routing";
import { encryptedTurnStartSchema, encryptedTurnChunkSchema, encryptedTurnFinalSchema,
  type EncryptedTurnStart, type EncryptedTurnChunk, type EncryptedTurnFinal, type TurnPacket } from "./model";
import { turnFrameContext, startFrameHeader, chunkFrameHeader, finalFrameHeader, validateTurnStart, validateTurnChunk, validateTurnFinal } from "./wire";
const placeholder = (): TurnPacket => ({ envelope: "AA", ciphertextHash: "0".repeat(64), ciphertextBytes: 1 });
async function seal(crypto: FileCipherPort, context: ReturnType<typeof turnFrameContext>, raw: unknown, signal: AbortSignal): Promise<TurnPacket> {
  const plaintext = new TextEncoder().encode(canonicalJson(raw));
  try { const result = await crypto.run({ kind: "encrypt", context, plaintext }, signal); signal.throwIfAborted(); assertCrypto(result.kind === "encrypted");
    return { envelope: encodeBase64url(result.envelope), ciphertextHash: result.ciphertextHash, ciphertextBytes: result.envelope.byteLength };
  } finally { plaintext.fill(0); }
}
async function open(crypto: FileCipherPort, packet: TurnPacket, expectedContext: ReturnType<typeof turnFrameContext>, signal: AbortSignal): Promise<unknown> {
  const result = await crypto.run({ kind: "decrypt", expectedContext, envelope: decodeBase64url(packet.envelope, 1, 98_304) }, signal); assertCrypto(result.kind === "decrypted");
  try { signal.throwIfAborted(); const text = new TextDecoder("utf-8", { fatal: true }).decode(result.plaintext), value: unknown = JSON.parse(text);
    assertCrypto(canonicalJson(value) === text); return value;
  } finally { result.plaintext.fill(0); }
}
function sameIdentity(local: TurnIdentity, wire: TurnIdentity) {
  assertCrypto(local.chatId === wire.chatId && local.incarnationId === wire.incarnationId && local.turnId === wire.turnId &&
    local.executorDeviceId === wire.executorDeviceId && local.executionEpoch === wire.executionEpoch);
}
export async function prepareTurnStart(original: TurnStart, mappings: { userBodyHash: string; noticeBodyHashes: string[]; optionsPacket: ChatPacket }, crypto: FileCipherPort, signal: AbortSignal) {
  const local = turnStartSchema.parse(original); assertCrypto(hashTurnIdentity(local) === local.identityHash);
  const { options: _options, planRequested: _plan, ...identity } = local;
  const draft = encryptedTurnStartSchema.parse({ ...identity, ...mappings, packet: placeholder(), identityHash: "0".repeat(64) });
  const packet = await seal(crypto, turnFrameContext(crypto.scope, draft, "start", 0, startFrameHeader(draft)), local, signal);
  return validateTurnStart(crypto.scope, { ...draft, packet, identityHash: packet.ciphertextHash });
}
export async function openTurnStart(raw: EncryptedTurnStart, crypto: FileCipherPort, signal: AbortSignal): Promise<TurnStart> {
  const value = validateTurnStart(crypto.scope, raw), local = turnStartSchema.parse(await open(crypto, value.packet,
    turnFrameContext(crypto.scope, value, "start", 0, startFrameHeader(value)), signal));
  sameIdentity(local, value); assertCrypto(hashTurnIdentity(local) === local.identityHash);
  const { options, planRequested: _plan, identityHash: _hash, userBodyHash: _user, noticeBodyHashes: _notices, ...original } = local;
  const { optionsPacket, packet: _packet, identityHash: _cipher, userBodyHash: _cipherUser, noticeBodyHashes: _cipherNotices, ...routing } = value;
  assertCrypto(canonicalJson(original) === canonicalJson(routing));
  assertCrypto(canonicalJson(await openChatPacket(crypto, value.chatId, optionsPacket, signal)) === canonicalJson({ options }));
  signal.throwIfAborted(); return local;
}
export async function prepareTurnChunk(original: TurnChunk, identity: TurnIdentity, previousCiphertextHash: string, previous: LiveProjection, crypto: FileCipherPort, signal: AbortSignal) {
  const local = turnChunkSchema.parse(original); assertCrypto(hashTurnChunk(local) === local.payloadHash);
  const { routing, projection } = prepareTurnRouting(local, previous), draft = encryptedTurnChunkSchema.parse({ seq: local.seq, previousCiphertextHash, routing, packet: placeholder() });
  const packet = await seal(crypto, turnFrameContext(crypto.scope, identity, "chunk", draft.seq, chunkFrameHeader(identity, draft)), local, signal);
  return { chunk: validateTurnChunk(crypto.scope, identity, { ...draft, packet }), projection };
}
export async function openTurnChunk(raw: EncryptedTurnChunk, identity: TurnIdentity, crypto: FileCipherPort, signal: AbortSignal): Promise<TurnChunk> {
  const value = validateTurnChunk(crypto.scope, identity, raw), local = turnChunkSchema.parse(await open(crypto, value.packet,
    turnFrameContext(crypto.scope, identity, "chunk", value.seq, chunkFrameHeader(identity, value)), signal));
  assertCrypto(local.seq === value.seq && hashTurnChunk(local) === local.payloadHash); assertPrivateRouting(local, value.routing); return local;
}
export async function prepareTurnFinal(original: TurnFinal, identity: TurnIdentity, result: EncryptedTurnFinal["result"], previousCiphertextHash: string, crypto: FileCipherPort, signal: AbortSignal) {
  const local = turnFinalSchema.parse(original); sameIdentity(local, identity); assertCrypto(local.result.kind === result.kind);
  const draft = encryptedTurnFinalSchema.parse({ ...identity, expectedHighSeq: local.expectedHighSeq, previousCiphertextHash, result, terminal: local.terminal, packet: placeholder() });
  return validateTurnFinal(crypto.scope, { ...draft, packet: await seal(crypto, turnFrameContext(crypto.scope, draft, "final", draft.expectedHighSeq, finalFrameHeader(draft)), local, signal) });
}
export async function openTurnFinal(raw: EncryptedTurnFinal, originalStart: TurnStart, crypto: FileCipherPort, signal: AbortSignal): Promise<TurnFinal> {
  const value = validateTurnFinal(crypto.scope, raw), local = turnFinalSchema.parse(await open(crypto, value.packet,
    turnFrameContext(crypto.scope, value, "final", value.expectedHighSeq, finalFrameHeader(value)), signal));
  sameIdentity(local, value); sameIdentity(local, originalStart);
  assertCrypto(local.identityHash === originalStart.identityHash && local.expectedHighSeq === value.expectedHighSeq && local.terminal === value.terminal && local.result.kind === value.result.kind);
  return local;
}
