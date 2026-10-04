/**
 * [INPUT]: Original native initialization manifests/pages and an admitted client crypto worker.
 * [OUTPUT]: Frozen ciphertext manifests/pages and authenticated receipt proofs preserving original content hashes.
 * [POS]: Client-only native initialization codec; the original Chat outbox owns immutable retries.
 */
import { canonicalJson } from "../../encryption/encoding";
import { assertCrypto, encodeBase64url } from "../../encryption";
import type { FileCipherPort } from "../../blobs/encrypted";
import { hashChatContent } from "../transcript/body";
import { chatInitialManifestSchema, chatInitialPageSchema, hashChatInitialPage, chatInitialReceiptSchema,
  type ChatInitialManifest, type ChatInitialPage } from "../transcript/initial";
import { initialContext, validateInitialPacket, frozenInitialManifestSchema, frozenInitialPageSchema, hashEncryptedInitialPage,
  encryptedInitialReceiptSchema, type EncryptedInitialManifest, type EncryptedInitialPage } from "./initial";
const placeholder = { envelope: "AA", ciphertextHash: "0".repeat(64), ciphertextBytes: 1 };
async function seal(value: EncryptedInitialManifest | EncryptedInitialPage, original: unknown, crypto: FileCipherPort, signal: AbortSignal) {
  const plaintext = new TextEncoder().encode(canonicalJson(original));
  try {
    const result = await crypto.run({ kind: "encrypt", context: initialContext(crypto.scope, value), plaintext }, signal);
    signal.throwIfAborted(); assertCrypto(result.kind === "encrypted");
    return { envelope: encodeBase64url(result.envelope), ciphertextHash: result.ciphertextHash, ciphertextBytes: result.envelope.byteLength };
  } finally { plaintext.fill(0); }
}
export async function prepareInitialManifest(original: ChatInitialManifest, ciphertextDigest: string, crypto: FileCipherPort, signal: AbortSignal) {
  const manifest = chatInitialManifestSchema.parse(original), transport = { ...manifest, digest: ciphertextDigest, proof: placeholder };
  transport.proof = await seal(transport, manifest, crypto, signal); validateInitialPacket(crypto.scope, transport);
  return frozenInitialManifestSchema.parse({ kind: "encrypted-native-manifest", plaintextHash: hashChatContent(manifest), transport,
    encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } });
}
export async function prepareInitialPage(original: ChatInitialPage, ciphertextHashes: string[], crypto: FileCipherPort, signal: AbortSignal) {
  const page = chatInitialPageSchema.parse(original), { payloadHash, ...identity } = page;
  assertCrypto(hashChatInitialPage(page) === payloadHash && page.bodyHashes.length === ciphertextHashes.length);
  const transport = { ...identity, bodyHashes: ciphertextHashes, proof: placeholder, ciphertextHash: "0".repeat(64) };
  transport.proof = await seal(transport, page, crypto, signal); transport.ciphertextHash = hashEncryptedInitialPage(transport);
  return frozenInitialPageSchema.parse({ kind: "encrypted-native-page", plaintextHash: payloadHash, transport,
    encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } });
}
export async function openInitialReceipt(raw: ReturnType<typeof encryptedInitialReceiptSchema.parse>, crypto: FileCipherPort, signal: AbortSignal) {
  const receipt = encryptedInitialReceiptSchema.parse(raw), wire = receipt.commit;
  assertCrypto(hashEncryptedInitialPage(wire) === wire.ciphertextHash && receipt.ciphertextHash === wire.ciphertextHash && receipt.operationId === wire.operationId &&
    receipt.chatId === wire.chatId && receipt.manifestId === wire.manifestId && receipt.receivedCount === wire.offset + wire.bodyHashes.length);
  const result = await crypto.run({ kind: "decrypt", expectedContext: initialContext(crypto.scope, wire), envelope: validateInitialPacket(crypto.scope, wire) }, signal);
  assertCrypto(result.kind === "decrypted");
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(result.plaintext), page = chatInitialPageSchema.parse(JSON.parse(text));
    const { bodyHashes: _originalHashes, payloadHash, ...originalIdentity } = page;
    const { bodyHashes: _cipherHashes, proof: _proof, ciphertextHash: _cipherHash, ...cipherIdentity } = wire;
    assertCrypto(canonicalJson(page) === text && hashChatInitialPage(page) === payloadHash && canonicalJson(originalIdentity) === canonicalJson(cipherIdentity));
    const { ciphertextHash: _hash, commit: _commit, ...original } = receipt;
    signal.throwIfAborted(); return chatInitialReceiptSchema.parse({ ...original, payloadHash });
  } finally { result.plaintext.fill(0); }
}
