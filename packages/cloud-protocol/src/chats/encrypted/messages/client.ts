/**
 * [INPUT]: An admitted worker, original-outbox message journal and bounded immutable ciphertext block readers.
 * [OUTPUT]: Exact retry preparation, authenticated manifests and complete plaintext body reconstruction.
 * [POS]: SDK-free message codec; consumers validate native/imported content semantics after authentication.
 */
import { z } from "zod";
import { canonicalJson } from "../../../encryption/encoding";
import { hashBytes } from "../../../blobs/transfer";
import { hashCanonical } from "../../../encryption/encoding";
import type { CipherPriority, FileCipherPort } from "../../../blobs/encrypted";
import { assertCrypto, assertExpectedScope, encodeBase64url } from "../../../encryption";
import { sha256Schema } from "../../../blobs";
import { encryptedMessageBlockSchema, encryptedMessagePageSchema, MESSAGE_CIPHER_LIMITS,
  type MessageMembership, type MessagePublication, type EncryptedMessage, type EncryptedMessageBlock } from "./model";
import { frozenMessageIntentSchema, frozenMessageBlockSchema, frozenMessageCompleteSchema, type MessageCipherJournal } from "./journal";
import { messageBlockContext, messagePageContext, validateMessageBlock, validateMessagePage, validateEncryptedMessage, hashEncryptedMessage } from "./wire";
const privateManifest = z.object({ format: z.literal(1), plaintextHash: sha256Schema,
  plaintextBytes: z.number().int().min(1).max(MESSAGE_CIPHER_LIMITS.privateBytes), publicationCommitment: sha256Schema }).strict();
export async function prepareEncryptedMessage(input: { key: string; operationId: string;
  membership: Omit<MessageMembership, "versionId" | "manifestId">; publication: MessagePublication; plaintext: Uint8Array; priority?: CipherPriority },
  crypto: FileCipherPort, journal: MessageCipherJournal, signal: AbortSignal) {
  const options = input.priority ? { priority: input.priority } : undefined;
  signal.throwIfAborted(); assertCrypto(input.plaintext.byteLength > 0 && input.plaintext.byteLength <= MESSAGE_CIPHER_LIMITS.privateBytes);
  const plaintextHash = hashBytes(input.plaintext), blockCount = Math.ceil(input.plaintext.byteLength / MESSAGE_CIPHER_LIMITS.blockBytes);
  let raw = await journal.read(input.key + ":intent");
  if (!raw) raw = await journal.write(input.key + ":intent", { kind: "encrypted-message-intent", key: input.key, operationId: input.operationId, userId: crypto.session.userId,
    encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint }, plaintextHash, plaintextBytes: input.plaintext.byteLength,
    membership: { ...input.membership, versionId: globalThis.crypto.randomUUID(), manifestId: globalThis.crypto.randomUUID() },
    blockIds: Array.from({ length: blockCount }, () => globalThis.crypto.randomUUID()), publication: input.publication });
  const intent = frozenMessageIntentSchema.parse(raw), { versionId: _version, manifestId: _manifest, ...membership } = intent.membership;
  assertExpectedScope(intent.encryptedSpace.scope, crypto.scope);
  assertCrypto(intent.userId === crypto.session.userId && intent.key === input.key && intent.operationId === input.operationId && intent.plaintextHash === plaintextHash &&
    intent.plaintextBytes === input.plaintext.byteLength && intent.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint &&
    canonicalJson(membership) === canonicalJson(input.membership) && canonicalJson(intent.publication) === canonicalJson(input.publication) && intent.blockIds.length === blockCount);
  const complete = await journal.read(input.key + ":complete");
  if (complete) {
    const frozen = frozenMessageCompleteSchema.parse(complete); assertCrypto(frozen.plaintextHash === plaintextHash && frozen.key === input.key &&
      frozen.message.operationId === intent.operationId && canonicalJson(frozen.message.membership) === canonicalJson(intent.membership) &&
      canonicalJson(frozen.message.pages[0]!.publication) === canonicalJson(intent.publication) &&
      canonicalJson(frozen.message.pages[0]!.metadata.blocks.map(block => block.blockId)) === canonicalJson(intent.blockIds));
    validateEncryptedMessage(crypto.scope, frozen.message); return frozen;
  }
  const blocks = [];
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
    signal.throwIfAborted(); const key = `${input.key}:block:${blockIndex}`;
    let frozen = await journal.read(key);
    if (!frozen) {
      const identity = { operationId: input.operationId, membership: intent.membership, blockId: intent.blockIds[blockIndex]!, blockIndex, blockCount };
      const plaintext = input.plaintext.slice(blockIndex * MESSAGE_CIPHER_LIMITS.blockBytes, (blockIndex + 1) * MESSAGE_CIPHER_LIMITS.blockBytes);
      try {
        const result = await crypto.run({ kind: "encrypt", context: messageBlockContext(crypto.scope, identity), plaintext }, signal, options);
        signal.throwIfAborted(); assertCrypto(result.kind === "encrypted");
        const block = encryptedMessageBlockSchema.parse({ ...identity, envelope: encodeBase64url(result.envelope), ciphertextHash: result.ciphertextHash, ciphertextBytes: result.envelope.byteLength });
        validateMessageBlock(crypto.scope, block);
        frozen = await journal.write(key, { kind: "encrypted-message-block", key: input.key, block });
      } finally { plaintext.fill(0); }
    }
    const { block } = frozenMessageBlockSchema.parse(frozen);
    assertCrypto(block.blockId === intent.blockIds[blockIndex] && block.blockIndex === blockIndex && block.blockCount === blockCount &&
      block.operationId === input.operationId && canonicalJson(block.membership) === canonicalJson(intent.membership));
    validateMessageBlock(crypto.scope, block);
    blocks.push({ blockId: block.blockId, index: blockIndex, ciphertextHash: block.ciphertextHash, ciphertextBytes: block.ciphertextBytes });
  }
  const identity = { operationId: input.operationId, metadata: { membership: intent.membership, blockOffset: 0, blockCount, blocks },
    pageIndex: 0, pageCount: 1, publication: intent.publication };
  const plaintext = new TextEncoder().encode(canonicalJson(privateManifest.parse({ format: 1, plaintextHash, plaintextBytes: input.plaintext.byteLength,
    publicationCommitment: hashCanonical(intent.publication) })));
  try {
    const result = await crypto.run({ kind: "encrypt", context: messagePageContext(crypto.scope, identity), plaintext }, signal, options);
    signal.throwIfAborted(); assertCrypto(result.kind === "encrypted");
    const page = encryptedMessagePageSchema.parse({ ...identity, envelope: encodeBase64url(result.envelope), ciphertextHash: result.ciphertextHash, ciphertextBytes: result.envelope.byteLength });
    const message: EncryptedMessage = { bodyHash: "0".repeat(64), operationId: input.operationId, membership: intent.membership, pages: [page] };
    message.bodyHash = hashEncryptedMessage(message);
    const frozen = frozenMessageCompleteSchema.parse(await journal.write(input.key + ":complete", { kind: "encrypted-message-complete", key: input.key, plaintextHash, message }));
    assertCrypto(frozen.plaintextHash === plaintextHash && canonicalJson(frozen.message.membership) === canonicalJson(intent.membership));
    validateEncryptedMessage(crypto.scope, frozen.message); return frozen;
  } finally { plaintext.fill(0); }
}
export async function openMessageManifest(raw: EncryptedMessage, crypto: FileCipherPort, signal?: AbortSignal) {
  const message = validateEncryptedMessage(crypto.scope, raw), page = message.pages[0]!;
  const result = await crypto.run({ kind: "decrypt", expectedContext: messagePageContext(crypto.scope, page), envelope: validateMessagePage(crypto.scope, page) }, signal);
  assertCrypto(result.kind === "decrypted");
  try {
    signal?.throwIfAborted(); const text = new TextDecoder("utf-8", { fatal: true }).decode(result.plaintext);
    const manifest = privateManifest.parse(JSON.parse(text));
    assertCrypto(canonicalJson(manifest) === text && manifest.publicationCommitment === hashCanonical(page.publication) &&
      Math.ceil(manifest.plaintextBytes / MESSAGE_CIPHER_LIMITS.blockBytes) === page.metadata.blockCount);
    return { message, ...manifest, publication: page.publication };
  } finally { result.plaintext.fill(0); }
}
export async function openMessageBody(raw: EncryptedMessage, crypto: FileCipherPort,
  readBlock: (blockId: string, signal: AbortSignal) => Promise<EncryptedMessageBlock>, signal: AbortSignal) {
  const manifest = await openMessageManifest(raw, crypto, signal), output = new Uint8Array(manifest.plaintextBytes);
  let offset = 0;
  try {
    for (const page of manifest.message.pages) for (const reference of page.metadata.blocks) {
      signal.throwIfAborted(); const block = encryptedMessageBlockSchema.parse(await readBlock(reference.blockId, signal)); signal.throwIfAborted();
      assertCrypto(block.blockId === reference.blockId && block.blockIndex === reference.index && block.ciphertextHash === reference.ciphertextHash &&
        block.ciphertextBytes === reference.ciphertextBytes && block.operationId === raw.operationId &&
        canonicalJson(block.membership) === canonicalJson(raw.membership) && block.blockCount === page.metadata.blockCount);
      const envelope = validateMessageBlock(crypto.scope, block);
      const decoded = await crypto.run({ kind: "decrypt", expectedContext: messageBlockContext(crypto.scope, block), envelope }, signal);
      assertCrypto(decoded.kind === "decrypted");
      try {
        signal.throwIfAborted(); assertCrypto(decoded.plaintext.byteLength === Math.min(MESSAGE_CIPHER_LIMITS.blockBytes, output.byteLength - offset));
        output.set(decoded.plaintext, offset); offset += decoded.plaintext.byteLength;
      } finally { decoded.plaintext.fill(0); }
    }
    assertCrypto(offset === output.byteLength && hashBytes(output) === manifest.plaintextHash); signal.throwIfAborted(); return output;
  } catch (error) { output.fill(0); throw error; }
}
