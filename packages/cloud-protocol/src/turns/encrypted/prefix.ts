/**
 * [INPUT]: A fixed ciphertext prefix, admitted crypto and bounded immutable turn pages.
 * [OUTPUT]: Client-replayed interrupted Chat bodies or an explicit empty outcome with original message time.
 * [POS]: Durable history resolver; server recovery retains ciphertext and never runs this reducer.
 */
import { assertCrypto } from "../../encryption";
import type { FileCipherPort } from "../../blobs/encrypted";
import { createLiveProjection, reduceLiveProjection, interruptedTurnBody } from "../projection";
import { encryptedTurnPageSchema, type EncryptedTurnPage, type EncryptedTurnPrefix } from "./model";
import { cipherTurnIdentity, validateTurnPrefix } from "./wire";
import { openTurnStart, openTurnChunk } from "./client";
import type { TurnStart } from "../model";
import type { TurnChunk } from "../live";
export type TurnPrefixReader = (chatId: string, turnId: string, afterSeq: number, throughSeq: number, signal: AbortSignal) => Promise<EncryptedTurnPage>;
export interface TurnPrefixProjectionPort<T> { begin(start: TurnStart): Promise<void>; append(chunk: TurnChunk): Promise<void>;
  complete(start: TurnStart, prefix: EncryptedTurnPrefix): Promise<T> }
export async function replayTurnPrefix<T>(raw: EncryptedTurnPrefix, crypto: FileCipherPort, readPage: TurnPrefixReader, signal: AbortSignal, project: TurnPrefixProjectionPort<T>): Promise<T> {
  const value = validateTurnPrefix(crypto.scope, raw); assertCrypto(value.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint);
  const start = await openTurnStart(value.start, crypto, signal), identity = cipherTurnIdentity(value.start);
  let highSeq = 0, previousHash = value.start.identityHash; await project.begin(start);
  let bytes = value.start.packet.ciphertextBytes + value.start.optionsPacket.ciphertextBytes;
  while (highSeq < value.highSeq) {
    signal.throwIfAborted(); const page = encryptedTurnPageSchema.parse(await readPage(start.chatId, start.turnId, highSeq, value.highSeq, signal));
    assertCrypto(page.state && page.state.receipt.identityHash === value.start.identityHash && page.state.chunksAvailable && page.chunks.length > 0);
    for (const chunk of page.chunks) {
      assertCrypto(chunk.seq === highSeq + 1 && chunk.seq <= value.highSeq && chunk.previousCiphertextHash === previousHash);
      const original = await openTurnChunk(chunk, identity, crypto, signal); await project.append(original);
      highSeq = chunk.seq; previousHash = chunk.packet.ciphertextHash; bytes += chunk.packet.ciphertextBytes;
      assertCrypto(bytes <= value.ciphertextBytes); signal.throwIfAborted();
    }
    assertCrypto(!page.complete || highSeq === value.highSeq);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  assertCrypto(previousHash === value.lastCiphertextHash && bytes === value.ciphertextBytes);
  signal.throwIfAborted(); return project.complete(start, value);
}
export const turnPrefixReason = (value: EncryptedTurnPrefix) => value.terminal === "error" ? "source-error" as const : value.terminal === "cancelled" ? "source-cancelled" as const :
  value.reason === "final-result-missing" ? "final-result-missing" as const : "execution-unconfirmed" as const;
export async function openTurnPrefix(raw: EncryptedTurnPrefix, crypto: FileCipherPort, readPage: TurnPrefixReader, signal: AbortSignal) {
  let projection = createLiveProjection(raw.start.createdAt);
  return replayTurnPrefix(raw, crypto, readPage, signal, { begin: async start => { projection = createLiveProjection(start.createdAt); },
    append: async chunk => { projection = reduceLiveProjection(projection, chunk.events); },
    complete: async (start, value) => interruptedTurnBody(start, projection, value.sealedAt, turnPrefixReason(value)) });
}
