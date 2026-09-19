/**
 * [INPUT]: Depends on native Home sources, encrypted manifests/entries and exact original-outbox predecessors.
 * [OUTPUT]: Defines bounded native/ciphertext custody and validates mapped publication receipts inside ChatStore's outbox.
 * [POS]: Local Home delivery codec; bytes live in the Home source holder, never in a second queue.
 */
import { z } from "zod";
import { homeManifestSchema, homeEntrySchema, homeReceiptSchema, homeStatusSchema, MAX_HOME_ENTRIES,
  EMPTY_HOME_DIGEST, extendHomeDigest, hashHomePage } from "@ai-chat/cloud-protocol/chats/home/model";
import { canonicalJson } from "@ai-chat/cloud-protocol";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { ciphertextFileDescriptor } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import { EMPTY_HOME_CIPHER_DIGEST, extendHomeCipherDigest, homeCipherIdentity, verifyHomeEntry, verifyHomeManifest, verifyHomePage,
  encryptedHomeReceiptSchema, encryptedHomeStatusSchema } from "@ai-chat/cloud-protocol/chats/home/encrypted";
import { openHomeReceipt } from "@ai-chat/cloud-protocol/chats/home/encrypted/client";
import type { ChatDeliveryCheckpoint } from "./contracts";
export const frozenHomeSchema = z.object({ manifest: homeManifestSchema, entries: z.array(homeEntrySchema).max(MAX_HOME_ENTRIES) }).strict()
  .superRefine(({ manifest, entries }, ctx) => {
    let digest = EMPTY_HOME_DIGEST, path = "", bytes = 0, omitted = 0;
    for (const entry of entries) {
      if (entry.path <= path) ctx.addIssue({ code: "custom", message: "Unordered Home entries" });
      digest = extendHomeDigest(digest, entry); path = entry.path;
      if (entry.kind === "file") bytes += entry.blob.bytes; else omitted++;
    }
    if (manifest.digest !== digest || manifest.bytes !== bytes || manifest.omittedCount !== omitted || manifest.entryCount !== entries.length) {
      ctx.addIssue({ code: "custom", message: "Home manifest does not match its source entries" });
    }
  });
export type FrozenHome = z.infer<typeof frozenHomeSchema>;
export const homeCheckpoints = [
  z.object({ kind: z.literal("home-manifest"), manifest: homeManifestSchema }).strict(),
  z.object({ kind: z.literal("home-entries"), offset: z.number().int().nonnegative(), entries: z.array(homeEntrySchema).min(1).max(50) }).strict(),
  z.object({ kind: z.literal("home-page"), receipt: homeReceiptSchema, encryptedReceipt: encryptedHomeReceiptSchema.optional() }).strict(),
  z.object({ kind: z.literal("home-complete"), status: homeStatusSchema.refine(value => value.state === "ready"), encryptedStatus: encryptedHomeStatusSchema.optional() }).strict(),
] as const;
export function validateHomeEncryptionCheckpoint(checkpoint: ChatDeliveryCheckpoint, chatId: string, prior: (key: string) => ChatDeliveryCheckpoint) {
  if (!["encrypted-home-entry", "encrypted-home-manifest", "encrypted-home-page", "home-page", "home-complete"].includes(checkpoint.kind)) return;
  const native = prior("home-manifest");
  if (native.kind !== "home-manifest" || native.manifest.chatId !== chatId) throw new Error("HOME_CIPHER_SOURCE_REQUIRED");
  const manifest = native.manifest, identity = homeCipherIdentity(manifest);
  const sourceEntry = (ordinal: number) => {
    const offset = Math.floor(ordinal / 50) * 50, page = prior(`home-entries:${offset}`);
    if (page.kind !== "home-entries" || page.offset !== offset || !page.entries[ordinal - offset]) throw new Error("HOME_CIPHER_SOURCE_REQUIRED");
    return page.entries[ordinal - offset];
  };
  if (checkpoint.kind === "encrypted-home-entry") {
    const ordinal = checkpoint.entry.ordinal, source = sourceEntry(ordinal);
    if (checkpoint.plaintextHash !== hashChatContent(source) || canonicalJson(checkpoint.identity) !== canonicalJson(identity) ||
      checkpoint.entry.operationId !== hashChatContent([manifest.snapshotId, Math.floor(ordinal / 50) * 50])) throw new Error("HOME_CIPHER_ENTRY_CHANGED");
    verifyHomeEntry(checkpoint.encryptedSpace.scope, identity, checkpoint.entry);
    if (source.kind === "file") {
      const file = prior(`${hashChatContent(["home-file", manifest.snapshotId, ordinal])}:complete`);
      if (file.kind !== "encrypted-file-complete" || file.descriptor.sha256 !== source.blob.sha256 || file.descriptor.bytes !== source.blob.bytes ||
        file.descriptor.mime !== source.blob.mime || canonicalJson(ciphertextFileDescriptor(file.descriptor)) !== canonicalJson(checkpoint.entry.file)) throw new Error("HOME_CIPHER_FILE_CHANGED");
    } else if (checkpoint.entry.file !== null) throw new Error("HOME_CIPHER_FILE_CHANGED");
  }
  if (checkpoint.kind === "encrypted-home-manifest") {
    if (checkpoint.plaintextHash !== hashChatContent(manifest) || canonicalJson(homeCipherIdentity(checkpoint.manifest)) !== canonicalJson(identity)) throw new Error("HOME_CIPHER_MANIFEST_CHANGED");
    verifyHomeManifest(checkpoint.encryptedSpace.scope, checkpoint.manifest);
    let digest = EMPTY_HOME_CIPHER_DIGEST, bytes = 0, omitted = 0;
    for (let ordinal = 0; ordinal < manifest.entryCount; ordinal++) {
      const value = prior(`cipher-home-entry:${manifest.snapshotId}:${ordinal}`);
      if (value.kind !== "encrypted-home-entry" || canonicalJson(value.encryptedSpace) !== canonicalJson(checkpoint.encryptedSpace)) throw new Error("HOME_CIPHER_ENTRY_REQUIRED");
      digest = extendHomeCipherDigest(digest, value.entry); bytes += value.entry.packet.ciphertextBytes + (value.entry.file?.bytes ?? 0); if (!value.entry.file) omitted++;
    }
    if (digest !== checkpoint.manifest.digest || bytes !== checkpoint.manifest.bytes || omitted !== checkpoint.manifest.omittedCount) throw new Error("HOME_CIPHER_MANIFEST_CHANGED");
  }
  if (checkpoint.kind === "encrypted-home-page") {
    const { operation } = checkpoint, offset = operation.offset, source = prior(`home-entries:${offset}`), frozen = prior(`cipher-home-manifest:${manifest.snapshotId}`);
    if (source.kind !== "home-entries" || frozen.kind !== "encrypted-home-manifest" || canonicalJson(homeCipherIdentity(operation)) !== canonicalJson(identity) ||
      canonicalJson(checkpoint.encryptedSpace) !== canonicalJson(frozen.encryptedSpace) || operation.operationId !== hashChatContent([manifest.snapshotId, offset])) throw new Error("HOME_CIPHER_PAGE_CHANGED");
    const native = { chatId, incarnationId: manifest.incarnationId, executionEpoch: manifest.executionEpoch, snapshotId: manifest.snapshotId,
      operationId: operation.operationId, payloadHash: checkpoint.plaintextHash, offset, entries: source.entries };
    if (hashHomePage(native) !== checkpoint.plaintextHash || source.entries.length !== operation.entries.length) throw new Error("HOME_CIPHER_PAGE_CHANGED");
    verifyHomePage(checkpoint.encryptedSpace.scope, operation);
    for (const entry of operation.entries) {
      const frozen = prior(`cipher-home-entry:${manifest.snapshotId}:${entry.ordinal}`);
      if (frozen.kind !== "encrypted-home-entry" || canonicalJson(frozen.entry) !== canonicalJson(entry)) throw new Error("HOME_CIPHER_ENTRY_CHANGED");
    }
  }
  if (checkpoint.kind === "home-page") {
    const frozen = prior(`cipher-home-page:${checkpoint.receipt.operationId}`);
    if (frozen.kind !== "encrypted-home-page" || !checkpoint.encryptedReceipt ||
      canonicalJson(openHomeReceipt(checkpoint.encryptedReceipt, frozen)) !== canonicalJson(checkpoint.receipt)) throw new Error("HOME_CIPHER_RECEIPT_CHANGED");
  }
  if (checkpoint.kind === "home-complete") {
    const frozen = prior(`cipher-home-manifest:${manifest.snapshotId}`), status = checkpoint.encryptedStatus;
    if (frozen.kind !== "encrypted-home-manifest" || !status || status.state !== "ready" || canonicalJson(status.manifest) !== canonicalJson(frozen.manifest) ||
      status.receivedDigest !== frozen.manifest.digest || status.bytes !== frozen.manifest.bytes || status.receivedCount !== frozen.manifest.entryCount ||
      status.omittedCount !== frozen.manifest.omittedCount) throw new Error("HOME_CIPHER_COMPLETION_CHANGED");
    if (manifest.entryCount) {
      const page = prior(`home-page:${hashChatContent([manifest.snapshotId, Math.floor((manifest.entryCount - 1) / 50) * 50])}`);
      if (page.kind !== "home-page" || page.receipt.state !== "ready" || page.receipt.receivedCount !== manifest.entryCount) throw new Error("HOME_FINAL_RECEIPT_REQUIRED");
    }
  }
}
