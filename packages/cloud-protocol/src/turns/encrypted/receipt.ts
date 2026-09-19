/**
 * [INPUT]: Ciphertext receipts, original start/final proofs and authenticated body/prefix readers.
 * [OUTPUT]: Private local receipts and live states without exposing plaintext commitment hashes on the wire.
 * [POS]: Client-only receipt translation; only complete authenticated outcomes can settle a local turn.
 */
import { assertCrypto } from "../../encryption";
import type { FileCipherPort } from "../../blobs/encrypted";
import { turnReceiptSchema, type CloudTurnReceipt } from "../../chats/content/completion";
import { hashChatContent, type ChatBody } from "../../chats/transcript/body";
import { liveTurnStateSchema } from "../model";
import { encryptedTurnReceiptSchema, encryptedLiveTurnStateSchema, type EncryptedTurnReceipt, type EncryptedLiveTurnState } from "./model";
import { openTurnStart, openTurnFinal } from "./client";
import { openTurnPrefix, type TurnPrefixReader } from "./prefix";
export type TurnReceiptReader = { readPrefixPage: TurnPrefixReader;
  readResult(chatId: string, incarnationId: string, messageId: string, bodyHash: string, signal: AbortSignal): Promise<ChatBody | null>;
  openedResult?(body: ChatBody | null): void };
export async function openTurnReceipt(raw: EncryptedTurnReceipt, crypto: FileCipherPort, reader: TurnReceiptReader, signal: AbortSignal): Promise<CloudTurnReceipt> {
  const value = encryptedTurnReceiptSchema.parse(raw), original = await openTurnStart(value.start, crypto, signal);
  const { start: _start, result: _result, resultKind: _kind, ...publicFields } = value;
  if (value.settlementState !== "settled") return turnReceiptSchema.parse({ ...publicFields, identityHash: original.identityHash });
  const result = value.result!; let resultHash: string, message = false;
  if (result.kind === "final") {
    assertCrypto(result.final.identityHash === value.identityHash && result.final.terminal === value.terminalKind);
    const final = await openTurnFinal(result.final, original, crypto, signal); resultHash = final.resultHash; message = final.result.kind === "message";
    assertCrypto(message || resultHash === hashChatContent(null));
  } else {
    if (result.kind === "prefix") assertCrypto(result.prefix.start.identityHash === value.identityHash && result.prefix.highSeq === value.sealedHighSeq &&
      result.prefix.reason === value.sealReason && result.prefix.terminal === (value.terminalKind ?? null));
    const body = result.kind === "prefix" ? await openTurnPrefix(result.prefix, crypto, reader.readPrefixPage, signal) :
      await reader.readResult(value.chatId, value.incarnationId, value.assistantMessageId, result.bodyHash, signal);
    if (result.kind === "adopted") assertCrypto(body);
    reader.openedResult?.(body);
    if (body) {
      const item = body.message; assertCrypto(item.role === "assistant" && item.id === value.assistantMessageId && item.seq === value.assistantSeq && item.turnId === value.turnId && item.resultHash);
      resultHash = item.resultHash; message = true;
    } else resultHash = hashChatContent(null);
  }
  signal.throwIfAborted(); const { finalMessageId: _final, ...fields } = publicFields;
  return turnReceiptSchema.parse({ ...fields, identityHash: original.identityHash, resultKind: message ? "message" : "empty", resultHash,
    ...(message ? { finalMessageId: value.assistantMessageId } : {}) });
}
export async function openLiveTurnState(raw: EncryptedLiveTurnState, crypto: FileCipherPort, reader: TurnReceiptReader, signal: AbortSignal) {
  const value = encryptedLiveTurnStateSchema.parse(raw), { lastCiphertextHash: _hash, ...state } = value;
  assertCrypto(value.backend === value.receipt.start.backend && value.createdAt === value.receipt.start.createdAt);
  return liveTurnStateSchema.parse({ ...state, receipt: await openTurnReceipt(value.receipt, crypto, reader, signal) });
}
