/**
 * [INPUT]: Original import entries/manifests and immutable ciphertext predecessors in the Chat outbox.
 * [OUTPUT]: Rejects substituted generation identities, plaintext/ciphertext hash pairs and page receipts.
 * [POS]: Synchronous Store admission for encrypted imported history; scheduling stays with the original outbox.
 */
import { canonicalJson } from "@ai-chat/cloud-protocol";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { hashImportPage } from "@ai-chat/cloud-protocol/chats/imported/model";
import { hashEncryptedImportPage, validateImportManifest } from "@ai-chat/cloud-protocol/chats/imported/encrypted";
import type { ChatDeliveryCheckpoint } from "../contracts";
export function validateImportedEncryptionCheckpoint(value: ChatDeliveryCheckpoint, chatId: string, userId: string,
  prior: (key: string) => ChatDeliveryCheckpoint) {
  if (value.kind === "encrypted-import-intent" && (value.chatId !== chatId || value.userId !== userId)) throw new Error("IMPORT_CIPHER_OWNER_MISMATCH");
  if (value.kind === "encrypted-message-intent" && value.membership.source === "imported") {
    const intent = prior("encrypted-import-intent"), entry = prior(`import-entry:${value.membership.seq}`);
    if (intent.kind !== "encrypted-import-intent" || entry.kind !== "import-entry" || intent.chatId !== chatId || intent.userId !== userId ||
      value.membership.generationId !== intent.generationId || value.membership.incarnationId !== intent.incarnationId ||
      value.plaintextHash !== hashChatContent(entry.entry) || value.membership.messageRole !== entry.entry.role ||
      value.membership.originalCreatedAt !== entry.entry.createdAt) throw new Error("IMPORT_CIPHER_ENTRY_MISMATCH");
  }
  if (value.kind === "encrypted-import-manifest") {
    const intent = prior("encrypted-import-intent"), original = prior("import-manifest"), wire = value.transport;
    if (intent.kind !== "encrypted-import-intent" || original.kind !== "import-manifest" || intent.userId !== userId ||
      wire.chatId !== chatId || wire.incarnationId !== intent.incarnationId || wire.generationId !== intent.generationId ||
      wire.executionEpoch !== intent.executionEpoch || wire.expectedRevision !== intent.expectedRevision ||
      value.plaintextHash !== hashChatContent(original.manifest) || wire.entryCount !== original.manifest.entryCount) throw new Error("IMPORT_CIPHER_MANIFEST_MISMATCH");
    validateImportManifest(value.encryptedSpace.scope, wire);
  }
  if (value.kind === "encrypted-import-page") {
    const manifest = prior("encrypted-import-manifest"), wire = value.transport;
    if (manifest.kind !== "encrypted-import-manifest" || wire.chatId !== chatId || wire.generationId !== manifest.transport.generationId ||
      wire.incarnationId !== manifest.transport.incarnationId || wire.executionEpoch !== manifest.transport.executionEpoch ||
      hashEncryptedImportPage(wire) !== wire.ciphertextHash) throw new Error("IMPORT_CIPHER_PAGE_MISMATCH");
    const entries = wire.entries.map(message => {
      const entry = prior(`import-entry:${message.membership.seq}`), complete = prior(`import-message:${message.membership.seq}:complete`);
      if (entry.kind !== "import-entry" || complete.kind !== "encrypted-message-complete" || complete.plaintextHash !== hashChatContent(entry.entry) ||
        canonicalJson(complete.message) !== canonicalJson(message)) throw new Error("IMPORT_CIPHER_PAGE_MISMATCH");
      return entry.entry;
    });
    const { ciphertextHash: _hash, ...operation } = wire;
    if (hashImportPage({ ...operation, payloadHash: "0".repeat(64), entries }) !== value.plaintextHash) throw new Error("IMPORT_CIPHER_HASH_PAIR_MISMATCH");
  }
  if (value.kind === "import-page") {
    const frozen = prior(`cipher-import-page:${value.receipt.operationId}`);
    if (frozen.kind !== "encrypted-import-page" || value.receipt.payloadHash !== frozen.plaintextHash ||
      value.receipt.chatId !== chatId || value.receipt.generationId !== frozen.transport.generationId ||
      value.receipt.receivedCount !== frozen.transport.offset + frozen.transport.entries.length) throw new Error("IMPORT_CIPHER_RECEIPT_MISMATCH");
  }
}
