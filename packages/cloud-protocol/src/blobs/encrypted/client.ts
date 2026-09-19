/**
 * [INPUT]: An admitted crypto worker, bounded immutable byte sources, caller-provided part hashes and the original domain outbox journal.
 * [OUTPUT]: Incremental authenticated file preparation, exact retry reads and atomic verified plaintext publication.
 * [POS]: SDK-free encrypted file codec; transports and domain owners supply authorization, durability and scheduling.
 */
import { PlaintextFileValidator } from "./validation";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { assertCrypto, assertExpectedContext, assertExpectedScope, decodeBase64url, encodeBase64url,
  hashEnvelope, MAX_ENVELOPE_BYTES, parseEnvelope } from "../../encryption";
import { canonicalJson } from "../../encryption/encoding";
import { blobDescriptorSchema, type BlobDescriptor } from "../index";
import { hashBlobSource, hashBytes, type BlobSink, type BlobSource } from "../transfer";
import { encryptedFileDescriptorSchema, FILE_CHUNK_BYTES, type CipherPriority, type EncryptedFileDescriptor, type EncryptedFileIdentity,
  type EncryptedFilePart, type FileCipherPort, fileCipherContext as context } from "./model";
import { frozenFileCompleteSchema, frozenFileIntentSchema, frozenFilePartSchema, type FrozenFileIntent, type FrozenFileJournal } from "./journal";
type PrepareInput = { key: string; operationId: string; owner: EncryptedFileIdentity["owner"]; ownerGeneration: string | null;
  source: Omit<BlobDescriptor, "blobId">; domain?: "skill-generation";
  // A custody owner that already hashed the exact bytes in FILE_CHUNK_BYTES parts skips the second full read; every part is still
  // re-hashed against this list before it is encrypted, so the frozen intent keeps the same authority either way.
  sourceParts?: readonly string[]; priority?: CipherPriority };
const partKey = (key: string, partIndex: number) => `${key}:part:${partIndex}`;
function assertIdentity(identity: EncryptedFileIdentity, crypto: FileCipherPort) {
  assertExpectedScope(identity.encryptedSpace.scope, crypto.scope);
  assertCrypto(identity.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint, "sync-space-changed");
}
// `verify` re-authenticates the stored envelope; upload callers pass false because the transfer hashes every part against the
// same descriptor immediately before it leaves the process.
export async function readFrozenFilePart(journal: FrozenFileJournal, key: string, identity: EncryptedFileIdentity, partIndex: number, verify = true) {
  const value = frozenFilePartSchema.parse(await journal.read(partKey(key, partIndex)));
  assertCrypto(value.key === key && value.blobId === identity.blobId && value.part.partIndex === partIndex);
  const bytes = decodeBase64url(value.envelope, 1, MAX_ENVELOPE_BYTES);
  assertCrypto(value.part.bytes === bytes.byteLength);
  if (!verify) return { bytes, part: value.part };
  assertCrypto(value.part.sha256 === hashEnvelope(bytes));
  assertExpectedContext(parseEnvelope(bytes).context, context(identity, partIndex));
  return { bytes, part: value.part };
}
export async function prepareEncryptedFile(input: PrepareInput, source: BlobSource, crypto: FileCipherPort, journal: FrozenFileJournal,
  signal: AbortSignal): Promise<EncryptedFileDescriptor> {
  signal.throwIfAborted();
  const descriptor = blobDescriptorSchema.omit({ blobId: true }).parse(input.source);
  assertCrypto(source.bytes === descriptor.bytes && source.mime === descriptor.mime);
  const binding = { key: input.key, operationId: input.operationId, owner: input.owner, ownerGeneration: input.ownerGeneration, ...(input.domain ? { domain: input.domain } : {}),
    userId: crypto.session.userId, encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint }, source: descriptor };
  const inputHash = hashBytes(new TextEncoder().encode(canonicalJson(binding)));
  let intent: FrozenFileIntent;
  const prior = await journal.read(input.key + ":intent"); signal.throwIfAborted();
  if (prior) intent = frozenFileIntentSchema.parse(prior);
  else {
    let sourceParts = input.sourceParts?.slice();
    if (sourceParts) assertCrypto(sourceParts.length === Math.max(1, Math.ceil(descriptor.bytes / FILE_CHUNK_BYTES)));
    else {
      const validator = new PlaintextFileValidator(descriptor.mime);
      let hashes: Awaited<ReturnType<typeof hashBlobSource>>;
      try {
        hashes = await hashBlobSource({ ...source, read: async (offset, size) => {
          const bytes = await source.read(offset, size); validator.write(bytes); return bytes;
        } }, signal, undefined, FILE_CHUNK_BYTES);
        validator.finish();
      } finally { validator.clear(); }
      assertCrypto(hashes.sha256 === descriptor.sha256);
      sourceParts = hashes.parts.length ? hashes.parts.map(part => part.sha256) : [hashBytes(new Uint8Array())];
    }
    intent = frozenFileIntentSchema.parse(await journal.write(input.key + ":intent", {
      kind: "encrypted-file-intent", key: input.key, userId: crypto.session.userId, inputHash, source: descriptor, sourceParts,
      identity: { ...(input.domain ? { domain: input.domain } : {}), encryptedSpace: binding.encryptedSpace, blobId: globalThis.crypto.randomUUID(), owner: input.owner,
        ownerGeneration: input.ownerGeneration, manifestId: globalThis.crypto.randomUUID(), operationId: input.operationId, chunkCount: sourceParts.length },
    }));
  }
  signal.throwIfAborted();
  assertCrypto(intent.inputHash === inputHash && intent.key === input.key && intent.userId === crypto.session.userId);
  assertIdentity(intent.identity, crypto);
  assertCrypto(canonicalJson(intent.source) === canonicalJson(descriptor) && canonicalJson(intent.identity.owner) === canonicalJson(input.owner) &&
    intent.identity.operationId === input.operationId && intent.identity.ownerGeneration === input.ownerGeneration && intent.identity.domain === input.domain);
  const digest = sha256.create(), parts: EncryptedFilePart[] = [];
  let ciphertextBytes = 0;
  for (let partIndex = 0; partIndex < intent.identity.chunkCount; partIndex++) {
    signal.throwIfAborted();
    let produced: { bytes: Uint8Array; part: EncryptedFilePart } | null = null;
    if (!await journal.read(partKey(input.key, partIndex))) {
      const length = Math.min(FILE_CHUNK_BYTES, descriptor.bytes - partIndex * FILE_CHUNK_BYTES);
      const plaintext = new Uint8Array(await source.read(partIndex * FILE_CHUNK_BYTES, length));
      try {
        signal.throwIfAborted(); assertCrypto(plaintext.byteLength === length && hashBytes(plaintext) === intent.sourceParts[partIndex]);
        const encrypted = await crypto.run({ kind: "encrypt", context: context(intent.identity, partIndex), plaintext }, signal, { priority: input.priority });
        signal.throwIfAborted(); assertCrypto(encrypted.kind === "encrypted");
        assertCrypto(encrypted.ciphertextHash === hashEnvelope(encrypted.envelope));
        assertExpectedContext(parseEnvelope(encrypted.envelope).context, context(intent.identity, partIndex));
        // The journal returns the committed winner, so a concurrent attempt still decides the bytes without a second read.
        const committed = frozenFilePartSchema.parse(await journal.write(partKey(input.key, partIndex), { kind: "encrypted-file-part", key: input.key,
          blobId: intent.identity.blobId, part: { partIndex, bytes: encrypted.envelope.byteLength, sha256: encrypted.ciphertextHash },
          envelope: encodeBase64url(encrypted.envelope) }));
        assertCrypto(committed.key === input.key && committed.blobId === intent.identity.blobId && committed.part.partIndex === partIndex);
        if (committed.part.sha256 === encrypted.ciphertextHash) produced = { bytes: encrypted.envelope, part: committed.part };
      } finally { plaintext.fill(0); }
    }
    signal.throwIfAborted();
    const frozen = produced ?? await readFrozenFilePart(journal, input.key, intent.identity, partIndex);
    signal.throwIfAborted(); digest.update(frozen.bytes); ciphertextBytes += frozen.bytes.byteLength; parts.push(frozen.part);
  }
  const result = encryptedFileDescriptorSchema.parse({ ...descriptor, blobId: intent.identity.blobId, encryption: {
    ...intent.identity, bytes: ciphertextBytes, sha256: bytesToHex(digest.digest()), parts,
  } });
  const complete = frozenFileCompleteSchema.parse(await journal.write(input.key + ":complete", {
    kind: "encrypted-file-complete", key: input.key, inputHash, descriptor: result,
  }));
  signal.throwIfAborted(); assertCrypto(complete.inputHash === inputHash && complete.key === input.key && canonicalJson(complete.descriptor) === canonicalJson(result));
  return complete.descriptor;
}
export async function openEncryptedFile<T>(raw: EncryptedFileDescriptor, crypto: FileCipherPort,
  read: (part: EncryptedFilePart, signal: AbortSignal) => Promise<Uint8Array>, sink: BlobSink<T>, signal: AbortSignal,
  priority?: CipherPriority) {
  const validator = new PlaintextFileValidator(raw.mime);
  try {
    const descriptor = encryptedFileDescriptorSchema.parse(raw); assertIdentity(descriptor.encryption, crypto);
    const plaintextHash = sha256.create(), ciphertextHash = sha256.create(); let length = 0, encryptedLength = 0;
    for (const part of descriptor.encryption.parts) {
      signal.throwIfAborted(); const bytes = await read(part, signal); signal.throwIfAborted();
      assertCrypto(bytes.byteLength === part.bytes && hashEnvelope(bytes) === part.sha256);
      ciphertextHash.update(bytes); encryptedLength += bytes.byteLength;
      const decoded = await crypto.run({ kind: "decrypt", expectedContext: context(descriptor.encryption, part.partIndex), envelope: bytes }, signal, { priority });
      assertCrypto(decoded.kind === "decrypted");
      try {
        signal.throwIfAborted(); assertCrypto(decoded.plaintext.byteLength === Math.min(FILE_CHUNK_BYTES, descriptor.bytes - length));
        validator.write(decoded.plaintext); plaintextHash.update(decoded.plaintext); length += decoded.plaintext.byteLength;
        await sink.write(new Uint8Array(decoded.plaintext));
      } finally { decoded.plaintext.fill(0); }
    }
    assertCrypto(length === descriptor.bytes && encryptedLength === descriptor.encryption.bytes &&
      bytesToHex(plaintextHash.digest()) === descriptor.sha256 && bytesToHex(ciphertextHash.digest()) === descriptor.encryption.sha256);
    validator.finish(); signal.throwIfAborted(); return await sink.commit(descriptor);
  } catch (error) { await sink.abort(); throw error; } finally { validator.clear(); }
}
