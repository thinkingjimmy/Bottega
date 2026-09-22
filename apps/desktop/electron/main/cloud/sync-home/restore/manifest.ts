/**
 * [INPUT]: Depends on admitted crypto, ciphertext Home reads, the confirmed Chat head, this device identity and native path validators.
 * [OUTPUT]: Authenticates complete ciphertext and native digest chains before returning any restorable path.
 * [POS]: Read-only Home preparation phase; it does not touch the destination filesystem.
 */
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { EMPTY_HOME_DIGEST, extendHomeDigest, type HomeEntry } from "@ai-chat/cloud-protocol/chats/home/model";
import { encryptedHomeStatusSchema, homeCipherIdentity, EMPTY_HOME_CIPHER_DIGEST, extendHomeCipherDigest } from "@ai-chat/cloud-protocol/chats/home/encrypted";
import { openHomeManifest, openHomeEntry } from "@ai-chat/cloud-protocol/chats/home/encrypted/client";
import type { EncryptedFileDescriptor, FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted/model";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { AccountTransport } from "../../runtime/transport";
export async function readHomeManifest(input: { config: CloudBuildConfig; userId: string; crypto(): FileCipherPort; transport: Pick<AccountTransport, "query"> },
  head: CloudChatHead, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!head.homeSnapshotId) {
    if (head.homeState !== "none") throw new Error("HOME_SNAPSHOT_PENDING");
    return null;
  }
  const crypto = input.crypto(); if (crypto.session.userId !== input.userId) throw new Error("HOME_SCOPE_CHANGED");
  const args = { ...protocolHeader(input.config), expectedUserId: input.userId,
    encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint }, chatId: head.chat.id, snapshotId: head.homeSnapshotId };
  const result = await input.transport.query("chats/home/reads:head", args); signal.throwIfAborted();
  if (!result) throw new Error("HOME_SNAPSHOT_UNAVAILABLE");
  const status = encryptedHomeStatusSchema.parse(result), encryptedManifest = status.manifest;
  const manifest = await openHomeManifest(crypto, encryptedManifest, signal); signal.throwIfAborted();
  if (status.state !== "ready" || manifest.chatId !== head.chat.id || manifest.incarnationId !== head.chat.incarnationId ||
    manifest.snapshotId !== head.homeSnapshotId ||
    status.receivedCount !== manifest.entryCount || status.receivedDigest !== encryptedManifest.digest ||
    status.bytes !== encryptedManifest.bytes || status.omittedCount !== manifest.omittedCount) throw new Error("HOME_SNAPSHOT_INCOMPLETE");
  const entries: HomeEntry[] = [], paths = new Set<string>(), files = new Set<string>(), directories = new Set<string>();
  const descriptors = new Map<string, EncryptedFileDescriptor>();
  let after = 0, digest = EMPTY_HOME_DIGEST, cipherDigest = EMPTY_HOME_CIPHER_DIGEST, cipherBytes = 0, bytes = 0, omitted = 0;
  for (;;) {
    signal.throwIfAborted();
    const page = await input.transport.query("chats/home/reads:page", { ...args, after, limit: 50 }); signal.throwIfAborted();
    if (page.entries.length > 50 || page.next !== after + page.entries.length || page.next > manifest.entryCount ||
      page.complete !== (page.next === manifest.entryCount) || !page.complete && !page.entries.length) throw new Error("HOME_SNAPSHOT_PAGE_CHANGED");
    for (const [index, value] of page.entries.entries()) {
      if (value.ordinal !== after + index) throw new Error("HOME_SNAPSHOT_PAGE_CHANGED");
      const decoded = await openHomeEntry(crypto, homeCipherIdentity(encryptedManifest), value, signal); signal.throwIfAborted();
      const entry = decoded.entry, folded = entry.path.normalize("NFC").toLowerCase();
      cipherDigest = extendHomeCipherDigest(cipherDigest, value); cipherBytes += value.packet.ciphertextBytes + (value.file?.bytes ?? 0);
      if (entries.length && entries.at(-1)!.path >= entry.path || paths.has(folded)) throw new Error("HOME_SNAPSHOT_PATH_CONFLICT");
      const segments = folded.split("/");
      for (let count = 1; count < segments.length; count++) {
        const parent = segments.slice(0, count).join("/");
        if (files.has(parent)) throw new Error("HOME_SNAPSHOT_PATH_CONFLICT"); directories.add(parent);
      }
      if (entry.kind === "file" && directories.has(folded)) throw new Error("HOME_SNAPSHOT_PATH_CONFLICT");
      if (entry.kind === "file") {
        if (!decoded.file) throw new Error("HOME_FILE_MANIFEST_REQUIRED");
        descriptors.set(entry.path, decoded.file); files.add(folded); bytes += entry.blob.bytes;
      } else omitted++;
      paths.add(folded); entries.push(entry); digest = extendHomeDigest(digest, entry);
    }
    if (bytes > manifest.bytes || omitted > manifest.omittedCount || cipherBytes > encryptedManifest.bytes) throw new Error("HOME_SNAPSHOT_TOTAL_CHANGED");
    after = page.next; if (page.complete) break;
  }
  if (digest !== manifest.digest || entries.length !== manifest.entryCount || bytes !== manifest.bytes || omitted !== manifest.omittedCount ||
    cipherDigest !== encryptedManifest.digest || cipherBytes !== encryptedManifest.bytes) throw new Error("HOME_SNAPSHOT_DIGEST_CHANGED");
  return { manifest, entries, descriptors };
}
