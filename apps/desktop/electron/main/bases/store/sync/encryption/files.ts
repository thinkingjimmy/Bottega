/**
 * [INPUT]: The original Base serial writer, bounded ciphertext sidecars and authenticated file descriptors.
 * [OUTPUT]: Commit-if-absent journals, native image mappings and writer-serialized in-flight operation leases.
 * [POS]: Existing pending/candidate custody extension; each sidecar precedes its envelope publication.
 */
import { frozenFileRecordSchema, type FrozenFileJournal } from "@ai-chat/cloud-protocol/blobs/encrypted/journal";
import { encryptedFileDescriptorSchema, type EncryptedFileDescriptor } from "@ai-chat/cloud-protocol/blobs/encrypted/model";
import type { SerialQueue } from "../../../../persistence/serial-queue";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { BaseStoreFiles } from "../../base-files";
import { baseSyncEnvelopeSchema, type BaseSyncEnvelope } from "../model";
type Target = { ownerKey: string; baseId: string };
type Ports = { queue: SerialQueue; files: Pick<BaseStoreFiles, "readCiphertext" | "writeCiphertext">;
  current(target: Target, scope: SyncScope): BaseSyncEnvelope; commit(target: Target, state: BaseSyncEnvelope): Promise<unknown>;
  released?(target: Target): Promise<unknown> };
export class BaseEncryptionFileCustody {
  private readonly leases = new Map<string, Map<string, number>>();
  constructor(private readonly ports: Ports) {}
  private targetKey(target: Target) { return JSON.stringify([target.ownerKey, target.baseId]); }
  activeOperationIds(target: Target): ReadonlySet<string> { return new Set(this.leases.get(this.targetKey(target))?.keys()); }
  async using<T>(target: Target, scope: SyncScope, operationId: string | null, run: () => Promise<T>): Promise<T> {
    if (operationId === null) return run();
    const key = this.targetKey(target);
    await this.ports.queue.enqueue(async () => {
      this.ports.current(target, scope);
      const leases = this.leases.get(key) ?? new Map<string, number>();
      if (!leases.has(operationId) && leases.size >= 128) throw new Error("BASE_FILE_OPERATION_LIMIT");
      leases.set(operationId, (leases.get(operationId) ?? 0) + 1); this.leases.set(key, leases);
    });
    try { return await run(); }
    finally {
      const leases = this.leases.get(key)!, count = leases.get(operationId)!;
      if (count === 1) leases.delete(operationId); else leases.set(operationId, count - 1);
      if (!leases.size) this.leases.delete(key);
      // Closing or transferring the Store can prevent maintenance; the next validated open can resume it.
      await this.ports.queue.enqueue(async () => this.ports.released?.(target)).catch(() => undefined);
    }
  }
  image(target: Target, scope: SyncScope, blobId: string) { return structuredClone(this.ports.current(target, scope).encryptionFiles?.images[blobId] ?? null); }
  remember(target: Target, scope: SyncScope, blobId: string, raw: EncryptedFileDescriptor, journalKey: string | null, replace = false) {
    return this.ports.queue.enqueue(async () => {
      const state = this.ports.current(target, scope), descriptor = encryptedFileDescriptorSchema.parse(raw);
      if (descriptor.encryption.owner.kind !== "base" || descriptor.encryption.owner.id !== target.baseId ||
        /^att_([a-f0-9]{64})\.(png|jpe?g|webp|gif)$/.exec(blobId)?.[1] !== descriptor.sha256) throw new Error("BASE_ATTACHMENT_IDENTITY_CHANGED");
      const previous = state.encryptionFiles?.images[blobId];
      if (previous && previous.descriptor.encryption.owner.id === target.baseId) {
        if (previous.descriptor.sha256 !== descriptor.sha256 || previous.descriptor.bytes !== descriptor.bytes || previous.descriptor.mime !== descriptor.mime) throw new Error("BASE_ATTACHMENT_IDENTITY_CHANGED");
        if (!replace || previous.descriptor.blobId === descriptor.blobId) return structuredClone(previous);
      }
      const envelope = structuredClone(state); envelope.encryptionFiles ??= { records: {}, images: {} };
      const value = { descriptor, journalKey }; envelope.encryptionFiles.images[blobId] = value;
      await this.ports.commit(target, baseSyncEnvelopeSchema.parse(envelope)); return value;
    });
  }
  journal(target: Target, scope: SyncScope, operationId: string): FrozenFileJournal {
    const read = async (key: string) => {
      const state = this.ports.current(target, scope), record = state.encryptionFiles?.records[key];
      if (!record) return null;
      if (record.operationId !== operationId) throw new Error("BASE_FILE_JOURNAL_IDENTITY_CHANGED");
      return frozenFileRecordSchema.parse(await this.ports.files.readCiphertext(target.ownerKey, record.hash));
    };
    return { read: key => this.ports.queue.enqueue(() => read(key)), write: (key, raw) => this.ports.queue.enqueue(async () => {
      const prior = await read(key); if (prior) return prior;
      const state = this.ports.current(target, scope), operation = state.pendingOperations.find(value => value.operationId === operationId);
      if (!operation?.sealed || operation.state !== "queued" || state.tombstones.includes("base") || state.promotionExport) throw new Error("BASE_FILE_OPERATION_UNAVAILABLE");
      const value = frozenFileRecordSchema.parse(raw), hash = await this.ports.files.writeCiphertext(target.ownerKey, `${JSON.stringify(value)}\n`), envelope = structuredClone(state);
      const blobId = value.kind === "encrypted-file-intent" ? value.identity.blobId : value.kind === "encrypted-file-complete" ? value.descriptor.blobId : value.blobId;
      envelope.encryptionFiles ??= { records: {}, images: {} }; envelope.encryptionFiles.records[key] = { hash, operationId, blobId };
      await this.ports.commit(target, baseSyncEnvelopeSchema.parse(envelope)); return value;
    }) };
  }
}
