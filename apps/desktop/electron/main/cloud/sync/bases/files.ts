/**
 * [INPUT]: Original Base envelope file custody, admitted encryption workers, bounded image sources and fresh upload attempt IDs.
 * [OUTPUT]: Authenticated private image mappings, verified source-only markers and frozen ciphertext uploads through replaceable transport attempts.
 * [POS]: Main Base file codec; native image identities stay local and original outbox sidecars own retries.
 */
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { baseAttachmentValueSchema } from "@ai-chat/base-ui/attachments/gallery-attachments";
import { canonicalJson, hashBytes, protocolHeader, type CloudBuildConfig, type FileProgress } from "@ai-chat/cloud-protocol";
import { baseAttachmentReferences, bindBaseAttachment, encryptedBaseAttachmentSchema, type BaseCipherFiles } from "@ai-chat/cloud-protocol/bases/encrypted/client";
import { prepareEncryptedFile } from "@ai-chat/cloud-protocol/blobs/encrypted/client";
import type { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import type { EncryptedFileDescriptor } from "@ai-chat/cloud-protocol/blobs/encrypted/model";
import type { BaseStore } from "../../../bases/base-store";
import type { PendingBaseOperation } from "../../../bases/store/sync/model";
import { ownerFileStem } from "../../../bases/store/base-files";
import { readBlobMetadata } from "../../../persistence/logical-blob";
import { localBlobSource } from "../../files/store";
type Target = { ownerKey: string; baseId: string };
export class BaseFilePublisher {
  private readonly controller = new AbortController();
  private readonly active = new Set<Promise<unknown>>();
  private readonly staged = new Map<string, Map<string, EncryptedFileDescriptor>>();
  constructor(private readonly input: { store: BaseStore; files: Pick<EncryptedBlobTransfer, "uploadFile" | "crypto">; config: CloudBuildConfig; userId: string;
    progress?(): (value: FileProgress) => void }) {}
  private get scope() { return { environment: this.input.config.environmentId, userId: this.input.userId }; }
  private check() {
    this.controller.signal.throwIfAborted(); const crypto = this.input.files.crypto;
    if (crypto.session.userId !== this.input.userId) throw new Error("account-scope-changed"); return crypto;
  }
  private track<T>(operation: () => Promise<T>): Promise<T> {
    const task = operation(); this.active.add(task); void task.finally(() => this.active.delete(task)).catch(() => undefined); return task;
  }
  async admit(target: Target, replace = true) {
    const key = canonicalJson(target), mappings = this.staged.get(key); if (!mappings) return;
    this.check();
    for (const [blobId, descriptor] of mappings) await this.input.store.sync.encryptedFiles.remember(target, this.scope, blobId, descriptor, null, replace);
    if (this.staged.get(key) === mappings) this.staged.delete(key);
  }
  codec(target: Target, operation?: PendingBaseOperation): BaseCipherFiles {
    const prepared = new Map<string, ReturnType<BaseCipherFiles["prepare"]>>();
    return { prepare: async value => {
      const parsed = baseAttachmentValueSchema.safeParse(value);
      if (!parsed.success) return { value, references: [] };
      if (parsed.data.localAvailability) {
        const image = parsed.data, crypto = this.check();
        if (image.localAvailability!.sourceDeviceId !== crypto.session.deviceId) throw new Error("BASE_LOCAL_IMAGE_SOURCE_REQUIRED");
        const bytes = await this.input.store.attachments.read(ownerFileStem(target.ownerKey), target.baseId, image);
        bytes.fill(0); this.check(); return { value: image, references: [] };
      }
      const image = parsed.data; let task = prepared.get(image.blobId);
      if (!task) { task = this.track(() => this.prepareImage(target, operation, image)); prepared.set(image.blobId, task); }
      return task;
    }, open: async (value, _target, references) => {
      const attachment = baseAttachmentValueSchema.safeParse(value);
      if (attachment.success && !attachment.data.localAvailability) throw new Error("BASE_ENCRYPTED_FILE_MAPPING_REQUIRED");
      const parsed = encryptedBaseAttachmentSchema.safeParse(value);
      if (!parsed.success) { if (references.length) throw new Error("BASE_ATTACHMENT_IDENTITY_CHANGED"); return value; }
      const { file, value: image } = parsed.data, crypto = this.check(); bindBaseAttachment(image, file, target.baseId);
      if (canonicalJson(file.encryption.encryptedSpace) !== canonicalJson({ scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint }) ||
        canonicalJson(baseAttachmentReferences(file)) !== canonicalJson(references)) throw new Error("BASE_ATTACHMENT_IDENTITY_CHANGED");
      const key = canonicalJson(target), mappings = this.staged.get(key) ?? new Map();
      if (this.staged.size >= 128 && !this.staged.has(key) || mappings.size >= 10000 && !mappings.has(image.blobId)) throw new Error("BASE_FILE_READ_LIMIT");
      mappings.set(image.blobId, file); this.staged.set(key, mappings); this.check(); return image;
    } };
  }
  private async prepareImage(target: Target, operation: PendingBaseOperation | undefined, image: ReturnType<typeof baseAttachmentValueSchema.parse>) {
    return this.input.store.sync.encryptedFiles.using(target, this.scope, operation?.operationId ?? null,
      () => this.prepareImageUnderLease(target, operation, image));
  }
  private async prepareImageUnderLease(target: Target, operation: PendingBaseOperation | undefined, image: ReturnType<typeof baseAttachmentValueSchema.parse>) {
    const signal = this.controller.signal, crypto = this.check(), custody = this.input.store.sync.encryptedFiles;
    let mapping = custody.image(target, this.scope, image.blobId);
    if (mapping?.descriptor.encryption.owner.id !== target.baseId) mapping = null;
    if (!mapping) {
      if (!operation?.sealed) throw new Error("BASE_FILE_OPERATION_UNAVAILABLE");
      const stem = ownerFileStem(target.ownerKey), path = join(this.input.store.attachments.familyPath(stem, target.baseId), image.blobId);
      const metadata = await readBlobMetadata(path, `${stem}:${target.baseId}`);
      if (metadata.blobId !== image.blobId || metadata.bytes !== image.byteLength || metadata.mime !== image.mediaType) throw new Error("BASE_ATTACHMENT_IDENTITY_CHANGED");
      const file = await localBlobSource(path, image.mediaType);
      try {
        const key = hashBytes(new TextEncoder().encode(canonicalJson([target.baseId, operation.operationId, image.blobId])));
        const journal = custody.journal(target, this.scope, operation.operationId);
        const descriptor = await prepareEncryptedFile({ key, operationId: operation.operationId, owner: { kind: "base", id: target.baseId }, ownerGeneration: null,
          source: { sha256: metadata.sha256, bytes: image.byteLength, mime: image.mediaType } }, file.source, crypto, journal, signal);
        mapping = await custody.remember(target, this.scope, image.blobId, descriptor, key);
      } finally { await file.close(); }
    }
    const bound = bindBaseAttachment(image, mapping.descriptor, target.baseId);
    if (mapping.journalKey) {
      const key = mapping.journalKey, descriptor = mapping.descriptor, crypto = this.check();
      const header = { ...protocolHeader(this.input.config), expectedUserId: this.input.userId,
        encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
      // Reusing a file must not reuse an expired or previous-login upload session.
      await custody.using(target, this.scope, descriptor.encryption.operationId, () =>
        this.input.files.uploadFile(header, randomUUID(), "gallery", descriptor,
          custody.journal(target, this.scope, descriptor.encryption.operationId), key, this.input.progress?.(), signal));
    }
    this.check(); return { value: bound, references: baseAttachmentReferences(mapping.descriptor) };
  }
  async close() { this.controller.abort(new Error("BASE_FILE_UPLOAD_CLOSED")); await Promise.allSettled([...this.active]); this.staged.clear(); }
}
