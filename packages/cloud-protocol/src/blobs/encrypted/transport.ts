/**
 * [INPUT]: Original file transfer ports, frozen outbox parts and private authenticated parent descriptors.
 * [OUTPUT]: Provides immutable encrypted upload, ready-blob reuse without local ciphertext and authenticated downloads.
 * [POS]: Extends the existing transfer lifecycle; introduces no durable queue or upload identity.
 */
import { canonicalJson } from "../../encryption/encoding";
import { assertCrypto } from "../../encryption";
import type { EncryptedBusinessHeader } from "../../spaces";
import { beginUploadSchema, blobReadPlanSchema, type BeginBlobUpload } from "../functions";
import { BlobTransfer, type BlobSink, type BlobSource, type FileProgress } from "../transfer";
import { openEncryptedFile, readFrozenFilePart } from "./client";
import { ciphertextFileDescriptorSchema, encryptedFileDescriptorSchema, encryptedFileIdentitySchema,
  type CipherPriority, type EncryptedFileDescriptor, type FileCipherPort } from "./model";
import type { FrozenFileJournal } from "./journal";
export function ciphertextFileDescriptor(raw: EncryptedFileDescriptor) {
  const { encryption } = encryptedFileDescriptorSchema.parse(raw);
  return ciphertextFileDescriptorSchema.parse({ blobId: encryption.blobId, sha256: encryption.sha256, bytes: encryption.bytes,
    mime: "application/octet-stream", encryption: encryptedFileIdentitySchema.parse({
      ...(encryption.domain ? { domain: encryption.domain } : {}), encryptedSpace: encryption.encryptedSpace, blobId: encryption.blobId, owner: encryption.owner,
      ownerGeneration: encryption.ownerGeneration, manifestId: encryption.manifestId, operationId: encryption.operationId, chunkCount: encryption.chunkCount,
    }) });
}
export function prepareFrozenFileUpload(header: EncryptedBusinessHeader, uploadId: string, contentKind: BeginBlobUpload["contentKind"],
  descriptor: EncryptedFileDescriptor, journal: FrozenFileJournal, key: string) {
  const wire = ciphertextFileDescriptor(descriptor), parts = descriptor.encryption.parts;
  const input = beginUploadSchema.parse({ ...header, uploadId, contentKind, owner: wire.encryption.owner, descriptor: wire, parts });
  const offsets: number[] = []; let total = 0;
  for (const part of parts) { offsets.push(total); total += part.bytes; }
  const source: BlobSource = { bytes: total, mime: wire.mime, read: async (offset, length) => {
    const index = offsets.indexOf(offset), part = parts[index];
    assertCrypto(!!part && part.bytes === length);
    const frozen = await readFrozenFilePart(journal, key, wire.encryption, index, false);
    assertCrypto(canonicalJson(frozen.part) === canonicalJson(part));
    return new Uint8Array(frozen.bytes);
  } };
  return { input, source };
}
export class EncryptedBlobTransfer extends BlobTransfer {
  get crypto() { return this.ports.crypto(); }
  uploadFile(header: EncryptedBusinessHeader, uploadId: string, contentKind: BeginBlobUpload["contentKind"], descriptor: EncryptedFileDescriptor,
    journal: FrozenFileJournal, key: string, progress?: (value: FileProgress) => void, external?: AbortSignal) {
    return this.task(external, async signal => {
      const prepared = prepareFrozenFileUpload(header, uploadId, contentKind, descriptor, journal, key);
      const result = await this.upload(prepared.input, prepared.source, progress, signal);
      assertCrypto(result.blobId === descriptor.blobId && canonicalJson(result) === canonicalJson(prepared.input.descriptor));
      return descriptor;
    });
  }
  reuseFile(header: EncryptedBusinessHeader, uploadId: string, contentKind: BeginBlobUpload["contentKind"], descriptor: EncryptedFileDescriptor, external?: AbortSignal) {
    return this.task(external, async signal => {
      const prepared = prepareFrozenFileUpload(header, uploadId, contentKind, descriptor, {
        read: async () => null, write: async () => { throw new Error("reuse-is-read-only"); },
      }, descriptor.encryption.operationId);
      const result = await this.upload({ ...prepared.input, claimOnly: true }, prepared.source, undefined, signal);
      assertCrypto(result.blobId === descriptor.blobId && canonicalJson(result) === canonicalJson(prepared.input.descriptor));
      return descriptor;
    });
  }
  readFile<T>(raw: EncryptedFileDescriptor, crypto: FileCipherPort, sink: BlobSink<T>,
    progress: (value: FileProgress) => void = () => undefined, external?: AbortSignal, priority?: CipherPriority) {
    return this.task(external, async signal => {
      let aborted = false;
      const guarded: BlobSink<T> = { ...sink, abort: async () => { if (!aborted) { aborted = true; await sink.abort(); } } };
      try {
        const descriptor = encryptedFileDescriptorSchema.parse(raw), wire = ciphertextFileDescriptor(descriptor);
        const plan = blobReadPlanSchema.parse(await this.ports.readPlan(descriptor.blobId, wire.encryption.owner, signal));
        assertCrypto(canonicalJson(plan.descriptor) === canonicalJson(wire) && canonicalJson(plan.owner) === canonicalJson(wire.encryption.owner) &&
          canonicalJson(plan.parts) === canonicalJson(descriptor.encryption.parts));
        let read = 0;
        return await openEncryptedFile(descriptor, crypto, async (part, signal) => {
          const bytes = await this.ports.readPart(plan, part, signal);
          read += bytes.byteLength; progress({ phase: "downloading", bytes: read, total: wire.bytes });
          return bytes;
        }, guarded, signal, priority);
      } catch (error) { await guarded.abort(); throw error; }
    });
  }
}
