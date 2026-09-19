/**
 * [INPUT]: Original option operations, authenticated current Chat heads and an admitted crypto worker.
 * [OUTPUT]: Frozen ciphertext CAS and verified receipts with the original plaintext operation hash.
 * [POS]: Client semantic boundary for executor options; original execution ordering remains unchanged.
 */
import { canonicalJson } from "../../../encryption/encoding";
import { assertCrypto, decodeBase64url, encodeBase64url } from "../../../encryption";
import type { FileCipherPort } from "../../../blobs/encrypted";
import { chatOptionsOperationSchema, chatOptionsReceiptSchema, hashChatOptionsOperation, type ChatOptionsOperation } from "../../options-sync";
import { openChatHeadForRequest, openChatPacket, sealChatPacket } from "../client";
import { encryptedChatHeadSchema, type EncryptedChatHead } from "../model";
import { frozenOptionsSchema, encryptedOptionsReceiptSchema, type EncryptedOptionsReceipt, type EncryptedOptionsOperation } from "./model";
import { optionsContext, hashEncryptedOptions, validateEncryptedOptions } from "./wire";
export async function prepareEncryptedOptions(raw: ChatOptionsOperation, rawHead: EncryptedChatHead, crypto: FileCipherPort, signal: AbortSignal) {
  const original = chatOptionsOperationSchema.parse(raw), head = encryptedChatHeadSchema.parse(rawHead);
  assertCrypto(hashChatOptionsOperation(original) === original.payloadHash && head.remoteCreation === null && head.options !== null);
  const opened = await openChatHeadForRequest(head, original.chatId, crypto, signal);
  assertCrypto(head.chat.id === original.chatId && head.chat.incarnationId === original.incarnationId);
  const mode = canonicalJson(opened.chat.options) === canonicalJson(original.options) ? "keep" :
    canonicalJson(opened.chat.options) === canonicalJson(original.previous) ? "replace" : "conflict";
  const metadata = { ...head.options.metadata, sourceDeviceId: crypto.session.deviceId, incarnationId: original.incarnationId,
    agent: original.options.backend, agentRevision: original.agentRevision, executionEpoch: original.executionEpoch };
  const options = await sealChatPacket(crypto, original.chatId, { operationId: original.operationId, role: "options", metadata }, { options: original.options }, signal);
  const transport: EncryptedOptionsOperation = { operationId: original.operationId, chatId: original.chatId, incarnationId: original.incarnationId,
    executionEpoch: original.executionEpoch, agentRevision: original.agentRevision, afterUserSeq: original.afterUserSeq,
    backend: original.options.backend, sourceDeviceId: crypto.session.deviceId, expectedOptionsHash: head.options.ciphertextHash, mode, options,
    proof: { envelope: "AA", ciphertextHash: "0".repeat(64), ciphertextBytes: 1 }, ciphertextHash: "0".repeat(64) };
  const plaintext = new TextEncoder().encode(canonicalJson(original));
  try {
    const result = await crypto.run({ kind: "encrypt", context: optionsContext(crypto.scope, transport), plaintext }, signal);
    signal.throwIfAborted(); assertCrypto(result.kind === "encrypted");
    transport.proof = { envelope: encodeBase64url(result.envelope), ciphertextHash: result.ciphertextHash, ciphertextBytes: result.envelope.byteLength };
    transport.ciphertextHash = hashEncryptedOptions(transport); validateEncryptedOptions(crypto.scope, transport);
    return frozenOptionsSchema.parse({ kind: "encrypted-chat-options", encryptedSpace: head.encryptedSpace, plaintextHash: original.payloadHash, transport });
  } finally { plaintext.fill(0); }
}
export async function openEncryptedOptionsReceipt(raw: EncryptedOptionsReceipt, crypto: FileCipherPort, signal: AbortSignal) {
  const receipt = encryptedOptionsReceiptSchema.parse(raw), commit = validateEncryptedOptions(crypto.scope, receipt.commit);
  assertCrypto(receipt.operationId === commit.operationId && receipt.chatId === commit.chatId && receipt.ciphertextHash === commit.ciphertextHash && receipt.sourceDeviceId === commit.sourceDeviceId);
  const result = await crypto.run({ kind: "decrypt", expectedContext: optionsContext(crypto.scope, commit), envelope: decodeBase64url(commit.proof.envelope, 1, 98_304) }, signal);
  assertCrypto(result.kind === "decrypted");
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(result.plaintext), original = chatOptionsOperationSchema.parse(JSON.parse(text));
    assertCrypto(canonicalJson(original) === text && hashChatOptionsOperation(original) === original.payloadHash && original.operationId === commit.operationId &&
      original.chatId === commit.chatId && original.incarnationId === commit.incarnationId && original.executionEpoch === commit.executionEpoch &&
      original.agentRevision === commit.agentRevision && original.afterUserSeq === commit.afterUserSeq && original.options.backend === commit.backend);
    assertCrypto(canonicalJson(await openChatPacket(crypto, commit.chatId, commit.options, signal)) === canonicalJson({ options: original.options }));
    const head = receipt.head ? await openChatHeadForRequest(receipt.head, original.chatId, crypto, signal) : null;
    if (receipt.status === "applied" || receipt.status === "converged") assertCrypto(head !== null && canonicalJson(head.chat.options) === canonicalJson(original.options));
    signal.throwIfAborted(); return chatOptionsReceiptSchema.parse({ operationId: receipt.operationId, chatId: receipt.chatId,
      payloadHash: original.payloadHash, status: receipt.status, sourceDeviceId: receipt.sourceDeviceId, createdAt: receipt.createdAt });
  } finally { result.plaintext.fill(0); }
}
