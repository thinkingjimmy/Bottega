/**
 * [INPUT]: Original turn start/chunk/final checkpoints and immutable message ciphertext mappings.
 * [OUTPUT]: Exact source-hash, sequence, ciphertext-chain and body-reference validation inside SQLite custody.
 * [POS]: Original delivery checkpoint leaf; no key, scheduler or independent outbox exists here.
 */
import { canonicalJson } from "@ai-chat/cloud-protocol";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { validateEncryptedMessage } from "@ai-chat/cloud-protocol/chats/encrypted/messages";
import { sameTurnBodySource } from "@ai-chat/cloud-protocol/turns/encrypted/journal";
import { cipherTurnIdentity, validateTurnStart, validateTurnChunk, validateTurnFinal } from "@ai-chat/cloud-protocol/turns/encrypted/wire";
import type { ChatDeliveryCheckpoint } from "../contracts";
export function validateTurnEncryptionCheckpoint(checkpoint: ChatDeliveryCheckpoint, chatId: string, prior: (key: string) => ChatDeliveryCheckpoint) {
  if (checkpoint.kind === "encrypted-turn-canonical-body") {
    const message = validateEncryptedMessage(checkpoint.encryptedSpace.scope, checkpoint.message), member = message.membership;
    const original = prior(`body:${member.seq}`), opened = checkpoint.openedBody;
    if (original.kind !== "native-body" || original.bodyHash !== checkpoint.plaintextHash || hashChatContent(original.body) !== checkpoint.plaintextHash ||
      hashChatContent(opened) !== checkpoint.openedPlaintextHash || member.chatId !== chatId || member.source !== "native" || member.generationId !== null ||
      member.messageId !== original.body.message.id || member.seq !== original.body.message.seq || member.originalCreatedAt !== original.body.message.createdAt ||
      member.timeState !== "valid" || member.messageRole !== (original.body.message.role === "notice" ? "system" : original.body.message.role) ||
      original.body.message.role === "assistant" || !sameTurnBodySource(original.body, opened, checkpoint.encryptedSpace.scope.sourceAccountId)) throw new Error("TURN_CANONICAL_BODY_SOURCE_MISMATCH");
  }
  if (checkpoint.kind === "encrypted-turn-start") {
    const original = prior("turn-start");
    if (original.kind !== "turn-start" || original.start.chatId !== chatId || original.start.identityHash !== checkpoint.plaintextHash) throw new Error("TURN_CIPHER_SOURCE_MISMATCH");
    const value = validateTurnStart(checkpoint.encryptedSpace.scope, checkpoint.start), local = original.start;
    const { options: _options, planRequested: _plan, identityHash: _identity, userBodyHash: _user, noticeBodyHashes: _notices, ...localHeader } = local;
    const { optionsPacket: _packet, packet: _proof, identityHash: _cipher, userBodyHash: _cipherUser, noticeBodyHashes: _cipherNotices, ...header } = value;
    if (canonicalJson(header) !== canonicalJson(localHeader)) throw new Error("TURN_CIPHER_IDENTITY_MISMATCH");
    for (const [index, hash] of [local.userBodyHash, ...local.noticeBodyHashes].entries()) {
      const expected = [value.userBodyHash, ...value.noticeBodyHashes][index], sequence = index === 0 ? local.userSeq : (local.executorNoticeSeq ?? local.noticeSeq)! + index - 1;
      let body: ChatDeliveryCheckpoint;
      try { body = prior(`cipher-turn-body:${sequence}`); } catch (error) {
        if (!(error instanceof Error) || error.message !== "OUTBOX_CHECKPOINT_PREDECESSOR_REQUIRED") throw error;
        body = prior(`message:${hash}:complete`);
      }
      if (body.kind !== "encrypted-message-complete" && body.kind !== "encrypted-turn-canonical-body") throw new Error("TURN_CIPHER_BODY_MISMATCH");
      const owner = body.kind === "encrypted-turn-canonical-body" ? body : prior(`message:${hash}:intent`);
      if (owner.kind !== "encrypted-message-intent" && owner.kind !== "encrypted-turn-canonical-body" || body.plaintextHash !== hash ||
        canonicalJson(owner.encryptedSpace) !== canonicalJson(checkpoint.encryptedSpace) || body.message.bodyHash !== expected ||
        body.message.membership.incarnationId !== local.incarnationId) throw new Error("TURN_CIPHER_BODY_MISMATCH");
    }
  }
  if (checkpoint.kind !== "encrypted-turn-chunk" && checkpoint.kind !== "encrypted-turn-final") return;
  const start = prior("encrypted-turn-start");
  if (start.kind !== "encrypted-turn-start" || start.start.chatId !== chatId || canonicalJson(start.encryptedSpace) !== canonicalJson(checkpoint.encryptedSpace)) throw new Error("TURN_CIPHER_START_REQUIRED");
  const identity = cipherTurnIdentity(start.start);
  const sequence = checkpoint.kind === "encrypted-turn-chunk" ? checkpoint.chunk.seq - 1 : checkpoint.final.expectedHighSeq;
  const predecessor = sequence === 0 ? null : prior(`cipher-turn-chunk:${sequence}`);
  if (predecessor && predecessor.kind !== "encrypted-turn-chunk") throw new Error("TURN_CIPHER_SEQUENCE_MISMATCH");
  const previousHash = predecessor?.kind === "encrypted-turn-chunk" ? predecessor.chunk.packet.ciphertextHash : start.start.identityHash;
  if (checkpoint.kind === "encrypted-turn-chunk") {
    const original = prior(`turn-chunk:${checkpoint.chunk.seq}`);
    if (original.kind !== "turn-chunk" || original.chunk.payloadHash !== checkpoint.plaintextHash || checkpoint.chunk.previousCiphertextHash !== previousHash) throw new Error("TURN_CIPHER_CHUNK_MISMATCH");
    validateTurnChunk(start.encryptedSpace.scope, identity, checkpoint.chunk);
  } else {
    const original = prior("turn-final"), value = validateTurnFinal(start.encryptedSpace.scope, checkpoint.final);
    if (original.kind !== "turn-final" || hashChatContent(original.final) !== checkpoint.plaintextHash || value.previousCiphertextHash !== previousHash ||
      value.identityHash !== identity.identityHash || value.expectedHighSeq !== original.final.expectedHighSeq || value.result.kind !== original.final.result.kind || value.terminal !== original.final.terminal) throw new Error("TURN_CIPHER_FINAL_MISMATCH");
    if (value.result.kind === "message" && original.final.result.kind === "message") {
      const body = prior(`message:${original.final.result.bodyHash}:complete`);
      if (body.kind !== "encrypted-message-complete" || body.message.bodyHash !== value.result.bodyHash) throw new Error("TURN_CIPHER_BODY_MISMATCH");
    }
  }
}
