/**
 * [INPUT]: Original Home custody, scoped file workers, immutable Chat outbox checkpoints and fresh upload attempt IDs.
 * [OUTPUT]: Exact frozen encrypted entries/manifests/pages reusing custody chunk hashes, with replaceable session-bound upload attempts.
 * [POS]: Home producer adapter; original native inventory remains the sole semantic source.
 */
import { canonicalJson, type FileProgress } from "@ai-chat/cloud-protocol";
import { randomUUID } from "node:crypto";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { hashHomePage } from "@ai-chat/cloud-protocol/chats/home/model";
import { homeCipherIdentity, frozenHomeEntrySchema, frozenHomeManifestSchema, frozenHomePageSchema,
  type FrozenHomeEntry } from "@ai-chat/cloud-protocol/chats/home/encrypted";
import { prepareHomeEntry, prepareHomeManifest, prepareHomePage } from "@ai-chat/cloud-protocol/chats/home/encrypted/client";
import { prepareEncryptedFile } from "@ai-chat/cloud-protocol/blobs/encrypted/client";
import type { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import type { EncryptedBusinessHeader } from "@ai-chat/cloud-protocol/spaces";
import type { FrozenHome } from "../../../chats/sqlite/cloud/delivery/home";
import type { ChatDeliveryCheckpoint } from "../../../chats/sqlite/cloud/delivery/contracts";
import type { ChatDeliveryCheckpoints } from "../../sync/chats/checkpoints";
import { localBlobSource } from "../../files/store";
import type { HomeSourceCustody } from "../custody";
async function freeze(checkpoints: ChatDeliveryCheckpoints, key: string, create: () => Promise<ChatDeliveryCheckpoint>) {
  const existing = await checkpoints.get(key); if (existing) return existing;
  const candidate = await create();
  try { return await checkpoints.save(candidate); }
  catch (error) { const winner = await checkpoints.get(key); if (winner) return winner; throw error; }
}
export async function prepareHomeCiphertext(source: FrozenHome, checkpoints: ChatDeliveryCheckpoints, custody: HomeSourceCustody,
  files: Pick<EncryptedBlobTransfer, "crypto">, header: EncryptedBusinessHeader, signal: AbortSignal) {
  const identity = homeCipherIdentity(source.manifest), journal = checkpoints.fileJournal(), entries: FrozenHomeEntry[] = [];
  for (const [ordinal, entry] of source.entries.entries()) {
    signal.throwIfAborted();
    const operationId = hashChatContent([identity.snapshotId, Math.floor(ordinal / 50) * 50]), key = `cipher-home-entry:${identity.snapshotId}:${ordinal}`;
    const frozen = frozenHomeEntrySchema.parse(await freeze(checkpoints, key, async () => {
      let descriptor = null;
      if (entry.kind === "file") {
        const fileKey = hashChatContent(["home-file", identity.snapshotId, ordinal]), complete = await journal.read(`${fileKey}:complete`);
        if (complete?.kind === "encrypted-file-complete") descriptor = complete.descriptor;
        else {
          const local = await localBlobSource(custody.path(entry.blob), entry.blob.mime);
          try { descriptor = await prepareEncryptedFile({ key: fileKey, operationId: fileKey, owner: { kind: "chat", id: identity.chatId },
            ownerGeneration: identity.incarnationId, source: { sha256: entry.blob.sha256, bytes: entry.blob.bytes, mime: entry.blob.mime },
            sourceParts: custody.parts(entry.blob) ?? undefined, priority: "background" }, local.source, files.crypto, journal, signal); }
          finally { await local.close(); }
        }
      }
      return prepareHomeEntry(files.crypto, identity, ordinal, operationId, entry, descriptor, signal);
    }));
    if (frozen.plaintextHash !== hashChatContent(entry) || canonicalJson(frozen.identity) !== canonicalJson(identity) ||
      canonicalJson(frozen.encryptedSpace) !== canonicalJson(header.encryptedSpace)) throw new Error("HOME_CIPHER_IDENTITY_CHANGED");
    entries.push(frozen);
  }
  signal.throwIfAborted();
  const manifest = frozenHomeManifestSchema.parse(await freeze(checkpoints, `cipher-home-manifest:${identity.snapshotId}`,
    () => prepareHomeManifest(files.crypto, source.manifest, entries, signal)));
  if (manifest.plaintextHash !== hashChatContent(source.manifest) || canonicalJson(manifest.encryptedSpace) !== canonicalJson(header.encryptedSpace)) throw new Error("HOME_CIPHER_IDENTITY_CHANGED");
  return { entries, manifest };
}
export async function frozenHomePage(source: FrozenHome, entries: readonly FrozenHomeEntry[], offset: number,
  checkpoints: ChatDeliveryCheckpoints, files: Pick<EncryptedBlobTransfer, "crypto">) {
  const manifest = source.manifest, native = { chatId: manifest.chatId, incarnationId: manifest.incarnationId, executionEpoch: manifest.executionEpoch,
    snapshotId: manifest.snapshotId, operationId: hashChatContent([manifest.snapshotId, offset]), payloadHash: "0".repeat(64), offset, entries: source.entries.slice(offset, offset + 50) };
  native.payloadHash = hashHomePage(native);
  const value = frozenHomePageSchema.parse(await freeze(checkpoints, `cipher-home-page:${native.operationId}`,
    async () => prepareHomePage(files.crypto, manifest, native, entries.slice(offset, offset + 50))));
  if (value.plaintextHash !== native.payloadHash || value.operation.operationId !== native.operationId) throw new Error("HOME_CIPHER_PAGE_CHANGED"); return value;
}
export async function uploadHomeFiles(entries: readonly FrozenHomeEntry[], checkpoints: ChatDeliveryCheckpoints, files: EncryptedBlobTransfer,
  header: EncryptedBusinessHeader, signal: AbortSignal, progress?: (value: FileProgress) => void) {
  const journal = checkpoints.fileJournal();
  for (const entry of entries) if (entry.entry.file) {
    signal.throwIfAborted(); const key = hashChatContent(["home-file", entry.identity.snapshotId, entry.entry.ordinal]), complete = await journal.read(`${key}:complete`);
    if (complete?.kind !== "encrypted-file-complete") throw new Error("HOME_FILE_CIPHERTEXT_REQUIRED");
    // File identity is durable; a transport attempt expires with its original login and upload lease.
    await files.uploadFile(header, randomUUID(), "home-snapshot", complete.descriptor, journal, key, progress, signal);
  }
}
