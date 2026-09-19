/**
 * [INPUT]: Admitted crypto, immutable generation proofs and bounded message block readers.
 * [OUTPUT]: Frozen generation transport and authenticated original import metadata/entries.
 * [POS]: Client-only imported semantic boundary; local hashes keep their original meaning.
 */
import { canonicalJson } from "../../../encryption/encoding";
import { encryptedFileDescriptorSchema, type FileCipherPort } from "../../../blobs/encrypted";
import { ciphertextFileDescriptor } from "../../../blobs/encrypted/transport";
import { assertCrypto, decodeBase64url, encodeBase64url } from "../../../encryption";
import { importManifestSchema, importStatusSchema, importedEntrySchema, importedEntryHash, type ImportedEntry } from "../model";
import { hashChatContent } from "../../transcript/body";
import { openMessageBody } from "../../encrypted/messages/client";
import type { EncryptedMessage, EncryptedMessageBlock } from "../../encrypted/messages";
import { importManifestContext, validateImportManifest, frozenImportManifestSchema,
  type EncryptedImportManifest, type EncryptedImportStatus } from "./model";
export async function prepareImportManifest(original: ReturnType<typeof importManifestSchema.parse>, cipher: { bytes: number; digest: string }, crypto: FileCipherPort, signal: AbortSignal) {
  const manifest = importManifestSchema.parse(original), { sourceKind: _source, incompleteTail: _tail, ...metadata } = manifest;
  const transport = { ...metadata, ...cipher, proof: { envelope: "AA", ciphertextHash: "0".repeat(64), ciphertextBytes: 1 } };
  const plaintext = new TextEncoder().encode(canonicalJson(manifest));
  try {
    const encrypted = await crypto.run({ kind: "encrypt", context: importManifestContext(crypto.scope, transport), plaintext }, signal);
    signal.throwIfAborted(); assertCrypto(encrypted.kind === "encrypted");
    transport.proof = { envelope: encodeBase64url(encrypted.envelope), ciphertextHash: encrypted.ciphertextHash, ciphertextBytes: encrypted.envelope.byteLength };
    validateImportManifest(crypto.scope, transport);
    return frozenImportManifestSchema.parse({ kind: "encrypted-import-manifest", plaintextHash: hashChatContent(manifest),
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint }, transport });
  } finally { plaintext.fill(0); }
}
async function openImportManifest(raw: EncryptedImportManifest, crypto: FileCipherPort, signal: AbortSignal) {
  const value = validateImportManifest(crypto.scope, raw);
  const result = await crypto.run({ kind: "decrypt", expectedContext: importManifestContext(crypto.scope, value), envelope: decodeBase64url(value.proof.envelope, 1, 98_304) }, signal);
  assertCrypto(result.kind === "decrypted");
  try {
    signal.throwIfAborted(); const text = new TextDecoder("utf-8", { fatal: true }).decode(result.plaintext), original = importManifestSchema.parse(JSON.parse(text));
    const { bytes: _bytes, digest: _digest, sourceKind: _source, incompleteTail: _tail, ...identity } = original;
    const { bytes: _cipherBytes, digest: _cipherDigest, proof: _proof, ...actual } = value;
    assertCrypto(canonicalJson(original) === text && canonicalJson(identity) === canonicalJson(actual)); return original;
  } finally { result.plaintext.fill(0); }
}
export async function openImportStatus(raw: EncryptedImportStatus, crypto: FileCipherPort, signal: AbortSignal) {
  const manifest = await openImportManifest(raw.manifest, crypto, signal);
  if (raw.state === "ready") assertCrypto(raw.receivedCount === raw.manifest.entryCount && raw.receivedBytes === raw.manifest.bytes && raw.receivedDigest === raw.manifest.digest && raw.revision === raw.manifest.expectedRevision + 1);
  return importStatusSchema.parse({ ...raw, manifest, receivedBytes: raw.state === "ready" ? manifest.bytes : 0,
    receivedDigest: raw.state === "ready" ? manifest.digest : hashChatContent(["import-generation-v1"]) });
}
export async function openImportedEntry(message: EncryptedMessage, crypto: FileCipherPort,
  readBlock: (blockId: string, signal: AbortSignal) => Promise<EncryptedMessageBlock>, signal: AbortSignal): Promise<ImportedEntry> {
  const { membership } = message;
  assertCrypto(membership.source === "imported" && membership.generationId !== null);
  const bytes = await openMessageBody(message, crypto, readBlock, signal);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes), entry = importedEntrySchema.parse(JSON.parse(text));
    assertCrypto(canonicalJson(entry) === text && importedEntryHash(entry) === entry.entryVersionId && entry.deliverySeq === membership.seq &&
      entry.role === membership.messageRole && entry.createdAt === membership.originalCreatedAt && (entry.createdAt !== null) === (membership.timeState === "valid"));
    const references = new Map(entry.fields.flatMap(field => field.chunks).map(raw => {
      const file = encryptedFileDescriptorSchema.parse(raw);
      assertCrypto(file.encryption.owner.kind === "chat" && file.encryption.owner.id === membership.chatId && file.encryption.ownerGeneration === membership.generationId);
      return [file.blobId, ciphertextFileDescriptor(file)] as const;
    }));
    const publication = message.pages[0]!.publication;
    assertCrypto(publication.backend === null && publication.turnId === null && publication.completion === (entry.completion ?? null) &&
      canonicalJson([...references.values()]) === canonicalJson(publication.references)); signal.throwIfAborted(); return entry;
  } finally { bytes.fill(0); }
}
