/**
 * [INPUT]: Existing account-scoped encrypted file transfer, current authenticated header and immutable native byte sources.
 * [OUTPUT]: NativeFileTransfer preserves exact mutable request identities and bounded immutable-content files with account/close revalidation.
 * [POS]: Native transport byte plane shared by Web and owner main; encrypted resource commands carry its small descriptors.
 */
import { hashBlobSource, hashBytes, type BlobSource } from "../../../blobs/transfer";
import { prepareEncryptedFile } from "../../../blobs/encrypted/client";
import type { EncryptedBlobTransfer } from "../../../blobs/encrypted/transport";
import type { FrozenFileRecord } from "../../../blobs/encrypted";
import type { EncryptedBusinessHeader } from "../../../spaces";
import type { NativeRemoteFile } from "../../../resources/artifact/native";
export class NativeFileTransfer {
  private readonly contents = new Map<string, NativeRemoteFile>();
  private readonly records = new Map<string, FrozenFileRecord>();
  private readonly ready = new Map<string, { digest: string; result: NativeRemoteFile }>();
  private readonly flights = new Map<string, { digest: string; task: Promise<NativeRemoteFile> }>();
  private readonly controller = new AbortController();
  constructor(private readonly transfer: EncryptedBlobTransfer, private readonly header: () => EncryptedBusinessHeader, private readonly chatId: string) {}
  stage(key: string, source: BlobSource, external?: AbortSignal): Promise<NativeRemoteFile> { return this.prepare(key, source, true, external); }
  async stageContent(namespace: string, data: Uint8Array, mime: string, external?: AbortSignal): Promise<NativeRemoteFile> {
    const signal = external ? AbortSignal.any([external, this.controller.signal]) : this.controller.signal;
    signal.throwIfAborted(); this.header();
    if (!data.length || data.length > 50_000_000 || namespace.length > 128 || !mime || mime.length > 128) throw new Error("artifact-budget");
    const bytes = data.slice(), key = "content:" + hashBytes(new TextEncoder().encode(JSON.stringify([namespace, mime, bytes.length, hashBytes(bytes)])));
    const cached = this.contents.get(key);
    if (cached) { this.contents.delete(key); this.contents.set(key, cached); return cached; }
    const result = await this.prepare(key, nativeBytesSource(bytes, mime), false, external);
    signal.throwIfAborted(); this.header(); this.contents.delete(key); this.contents.set(key, result);
    if (this.contents.size > 16) this.contents.delete(this.contents.keys().next().value!);
    return result;
  }
  private async prepare(key: string, source: BlobSource, retain: boolean, external?: AbortSignal): Promise<NativeRemoteFile> {
    const signal = external ? AbortSignal.any([external, this.controller.signal]) : this.controller.signal;
    signal.throwIfAborted(); this.header();
    if (!source.bytes || source.bytes > 50_000_000 || key.length > 160) throw new Error("artifact-budget");
    const hashes = await hashBlobSource(source, signal), digest = JSON.stringify([source.bytes, source.mime, hashes.sha256]);
    const prior = this.ready.get(key); if (prior) { if (prior.digest !== digest) throw new Error("artifact-request-conflict"); return prior.result; }
    const flight = this.flights.get(key);
    if (flight) { if (flight.digest !== digest) throw new Error("artifact-request-conflict"); return flight.task; }
    if (this.flights.size >= 2 || retain && this.ready.size >= 128 || this.records.size > 1024) throw new Error("artifact-budget");
    const journal = { read: async (name: string) => this.records.get(name) ?? null, write: async (name: string, value: FrozenFileRecord) => {
      signal.throwIfAborted(); this.header(); const old = this.records.get(name); if (old) return old;
      this.records.set(name, value); return value;
    } };
    const run = (async () => {
      const blob = await prepareEncryptedFile({ key, operationId: key, owner: { kind: "chat", id: this.chatId }, ownerGeneration: null,
        source: { bytes: source.bytes, mime: source.mime, sha256: hashes.sha256 } }, source, this.transfer.crypto, journal, signal);
      const result = { blob: await this.transfer.uploadFile(this.header(), "native-" + blob.blobId, "artifact", blob, journal, key, undefined, signal) };
      signal.throwIfAborted(); this.header(); if (retain) this.ready.set(key, { digest, result });
      for (const [name, record] of this.records) if (record.key === key) this.records.delete(name);
      return result;
    })().finally(() => this.flights.delete(key));
    this.flights.set(key, { digest, task: run }); return run;
  }
  async close() { this.controller.abort(); await Promise.allSettled([...this.flights.values()].map(flight => flight.task)); this.records.clear(); this.ready.clear(); this.contents.clear(); }
}
export const nativeBytesSource = (bytes: Uint8Array, mime = "application/octet-stream"): BlobSource => ({ bytes: bytes.length, mime,
  read: async (offset, length) => bytes.slice(offset, offset + length) });
