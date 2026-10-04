/**
 * [INPUT]: Depends on rooted import descriptors, SQLite Home manifest proofs and existing exact field/byte codecs.
 * [OUTPUT]: Pages complete imported fields, verifies retained Home files and restores an explicitly owned independent Home.
 * [POS]: Local archive assets; original scanner authority and absolute paths remain private.
 */
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { contentBlobId, type BlobDescriptor } from "@ai-chat/cloud-protocol";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import { recoveryPageSchema, type RecoveryIdentity, type RecoverySummary } from "../../../../../shared/cloud/recovery";
import { homeJobSchema } from "../../../chats/sqlite/cloud/home/contracts";
import { retainedSourceRefSchema } from "../../../chats/sqlite/cloud/delivery/contracts";
import { readChatSource, nativeSnapshotSchema, type ChatSyncStore } from "../../sync/chats/sources";
import { frozenImportSchema, readImportedSources } from "../../sync/chats/imported/sources";
import { encodeImportedContent, sliceSource } from "../../sync/chats/imported/fields";
import { HomeSourceCustody } from "../../sync-home/custody";
import { homeManifestSchema } from "@ai-chat/cloud-protocol/chats/home/model";
import { localBlobSource } from "../../files/store";
import { recoveryBytes } from "./bytes";
import { restoreHomeFile, type HomeTarget } from "../../sync-home/restore/files";
type Archive = { archive: RecoverySummary; descriptor: Record<string, unknown> };
export class RecoveryAssets {
  constructor(private readonly store: ChatSyncStore, private readonly userData: string | undefined) {}
  private async home(scope: SyncScope, value: Archive) {
    if (!this.userData) throw new Error("RECOVERY_UNAVAILABLE");
    const job = homeJobSchema.parse(value.descriptor.job), custody = new HomeSourceCustody(this.userData, scope, job.id), saved = await custody.read();
    if (job.chatId !== value.archive.chatId || saved.manifest.chatId !== job.chatId || saved.manifest.incarnationId !== job.incarnationId ||
      saved.manifest.snapshotId !== job.snapshotId) throw new Error("RECOVERY_HOME_CHANGED");
    if (value.descriptor.manifest) {
      const checkpoint = await readChatSource(this.store, scope, retainedSourceRefSchema.parse(value.descriptor.manifest)) as { kind: string; manifest?: unknown };
      const manifest = homeManifestSchema.parse(checkpoint.kind === "home-manifest" ? checkpoint.manifest : null);
      if (hashChatContent(saved.manifest) !== hashChatContent(manifest)) throw new Error("RECOVERY_HOME_CHANGED");
    }
    return { saved, custody };
  }
  private async imported(scope: SyncScope, value: Archive) {
    const snapshot = nativeSnapshotSchema.parse(await readChatSource(this.store, scope, retainedSourceRefSchema.parse(value.descriptor.source)));
    if (snapshot.chat.id !== value.archive.chatId) throw new Error("RECOVERY_IMPORT_CHANGED"); return frozenImportSchema.parse(snapshot.imported);
  }
  async homeInfo(scope: SyncScope, value: Archive) {
    const { saved } = await this.home(scope, value);
    return { pending: false, files: saved.manifest.entryCount - saved.manifest.omittedCount, omitted: saved.manifest.omittedCount };
  }
  async restoreHome(scope: SyncScope, value: Archive, target: HomeTarget, signal: AbortSignal) {
    const { saved, custody } = await this.home(scope, value);
    for (const entry of saved.entries) if (entry.kind === "file") await restoreHomeFile(target, saved.manifest.snapshotId, entry, custody.path(entry.blob), signal);
    await target.verify();
  }
  async page(scope: SyncScope, value: Archive, before: number | null, signal: AbortSignal) {
    const start = before ?? 0;
    if (value.archive.kind === "home") {
      const { saved } = await this.home(scope, value), end = Math.min(start + 20, saved.entries.length);
      if (start > saved.entries.length) throw new Error("RECOVERY_CURSOR_INVALID"); signal.throwIfAborted();
      return recoveryPageSchema.parse({ archive: value.archive, messages: [], files: saved.entries.slice(start, end), cursor: end < saved.entries.length ? end : null,
        complete: end === saved.entries.length });
    }
    const frozen = await this.imported(scope, value), imported = []; let offset = 0;
    for await (const source of readImportedSources(this.store, scope, frozen, signal)) {
      if (offset++ < start) continue;
      imported.push(await encodeImportedContent(source, async (_bytes, descriptor) => ({ ...descriptor, blobId: contentBlobId(descriptor, scope.userId) }), signal)); if (imported.length === 20) break;
    }
    if (start > frozen.generation.entry_count || offset < Math.min(start + 20, frozen.generation.entry_count)) throw new Error("RECOVERY_IMPORT_INCOMPLETE");
    const end = start + imported.length;
    return recoveryPageSchema.parse({ archive: value.archive, messages: [], imported, cursor: end < frozen.generation.entry_count ? end : null,
      complete: end === frozen.generation.entry_count });
  }
  async file(scope: SyncScope, value: Archive, input: RecoveryIdentity & { messageId: string; descriptor: BlobDescriptor }, signal: AbortSignal) {
    if (value.archive.kind === "home") {
      const { saved, custody } = await this.home(scope, value), entry = saved.entries.find(entry => hashChatContent(entry.path) === input.messageId);
      if (!entry || entry.kind !== "file" || hashChatContent(entry.blob) !== hashChatContent(input.descriptor)) throw new Error("RECOVERY_FILE_UNAVAILABLE");
      const file = await localBlobSource(custody.path(entry.blob), entry.blob.mime);
      try { return await recoveryBytes(file.source, entry.blob, signal); } finally { await file.close(); }
    }
    const frozen = await this.imported(scope, value);
    for await (const source of readImportedSources(this.store, scope, frozen, signal)) {
      if (`import-${source.metadata.deliverySeq}` !== input.messageId) continue;
      const entry = await encodeImportedContent(source, async (_bytes, descriptor) => ({ ...descriptor, blobId: contentBlobId(descriptor, scope.userId) }), signal);
      for (const field of entry.fields) {
        let offset = 0;
        for (const descriptor of field.chunks) {
          if (hashChatContent(descriptor) === hashChatContent(input.descriptor)) {
            const bytes = source.fields.find(value => value.field === field.field)!.source;
            return recoveryBytes(sliceSource(bytes, offset, descriptor.bytes), descriptor, signal);
          }
          offset += descriptor.bytes;
        }
      }
      break;
    }
    throw new Error("RECOVERY_FILE_UNAVAILABLE");
  }
}
