/**
 * [INPUT]: Admitted crypto, encrypted import reads, verified private files and original SQLite generation commands.
 * [OUTPUT]: Authenticates full imported fields with bounded writes and resumes the last committed entry after restart.
 * [POS]: Main import downlink; only verified complete entries advance original Store watermarks.
 */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { canonicalJson, protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import type { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import { openImportStatus, openImportedEntry } from "@ai-chat/cloud-protocol/chats/imported/encrypted/client";
import { prepareMessageBlockReader } from "@ai-chat/cloud-protocol/chats/encrypted/messages/batch";
import { streamImportedField, type ImportFieldReader } from "@ai-chat/cloud-protocol/chats/imported/encrypted/fields";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { ImportedEntry } from "@ai-chat/cloud-protocol/chats/imported/model";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { ChatSyncStore } from "../chats/sources";
import type { AccountTransport } from "../../runtime/transport";
import type { CloudAction } from "../../../chats/sqlite/cloud/protocol";
import type { DesktopBlobStore } from "../../files/store";
type Ports = { config: CloudBuildConfig; scope: SyncScope; store: ChatSyncStore; transport: Pick<AccountTransport, "query">;
  crypto(): FileCipherPort; files: Pick<EncryptedBlobTransfer, "readFile">; cache?: Pick<DesktopBlobStore, "read">;
  signal: AbortSignal; current(): void; changed(): void };
export async function hydrateImportedHistory(ports: Ports, head: CloudChatHead) {
  if (head.kind === "native") return true;
  const { scope, store, transport, signal } = ports, crypto = ports.crypto();
  const header = { ...protocolHeader(ports.config), expectedUserId: scope.userId,
    encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
  const current = () => { signal.throwIfAborted(); ports.current(); };
  const mutate = async (action: CloudAction) => { current(); const result = await store.mutate(scope, hashChatContent(["import-downlink", scope, action]), action); current(); return result.result; };
  current(); const raw = await transport.query("chats/imported/reads:head", { ...header, chatId: head.chat.id }); current();
  if (!raw || raw.state !== "ready") return false;
  const status = await openImportStatus(raw, crypto, signal); current();
  if (status.manifest.chatId !== head.chat.id || status.manifest.incarnationId !== head.chat.incarnationId) throw new Error("IMPORT_GENERATION_CHANGED");
  const begin = await mutate({ type: "begin-import-download", chatId: head.chat.id, bodyRevision: head.bodyRevision, status });
  if (begin.type !== "begin-import-download") throw new Error("IMPORT_DOWNLOAD_UNAVAILABLE");
  const checkpoint = await store.read(scope, { type: "import-download", chatId: head.chat.id }); current();
  if (checkpoint.type !== "import-download" || !checkpoint.value || checkpoint.value.status.manifest.generationId !== status.manifest.generationId) throw new Error("IMPORT_GENERATION_CHANGED");
  if (checkpoint.value.complete) return true;
  let beforeSeq = checkpoint.value.beforeSeq;
  const generationId = status.manifest.generationId, owner = { kind: "chat" as const, id: head.chat.id };
  const reader: ImportFieldReader = { read: async (file, sink, signal) => {
    current();
    if (!ports.cache) { await ports.files.readFile(file, crypto, sink, undefined, signal, "background"); current(); return; }
    const cached = await ports.cache.read(file, owner, signal); current();
    if (canonicalJson(cached.descriptor) !== canonicalJson(file)) throw new Error("IMPORT_FILE_CHANGED");
    const handle = await open(cached.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const initial = await handle.stat(); if (!initial.isFile() || initial.size !== file.bytes) throw new Error("IMPORT_FILE_CHANGED");
      const buffer = Buffer.alloc(32 * 1024);
      try {
        for (let offset = 0; offset < initial.size;) {
          current(); const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, initial.size - offset), offset);
          if (!bytesRead) throw new Error("IMPORT_FILE_CHANGED"); await sink.write(buffer.subarray(0, bytesRead)); offset += bytesRead;
        }
        const final = await handle.stat();
        if (initial.size !== final.size || initial.mtimeMs !== final.mtimeMs || initial.ctimeMs !== final.ctimeMs) throw new Error("IMPORT_FILE_CHANGED");
        current(); await sink.commit(file);
      } finally { buffer.fill(0); }
    } catch (error) { await sink.abort(); throw error; } finally { await handle.close(); }
  } };
  async function field(entry: ImportedEntry, descriptor: ImportedEntry["fields"][number]) {
    let ordinal = 0;
    await streamImportedField(descriptor, reader, async content => {
      await mutate({ type: "write-import-field", chatId: head.chat.id, generationId, entry, field: descriptor.field, ordinal: ordinal++, content });
    }, signal); current();
  }
  for (;;) {
    current(); const page = await transport.query("chats/imported/reads:page", { ...header, chatId: head.chat.id, generationId, revision: status.revision, beforeSeq, limit: 50 }); current();
    const blocks = await prepareMessageBlockReader(page.entries, batch => transport.query("chats/body/reads:blocks", { ...header, chatId: head.chat.id, blocks: batch }), signal); current();
    for (const message of [...page.entries].reverse()) {
      if (message.membership.chatId !== head.chat.id || message.membership.incarnationId !== head.chat.incarnationId || message.membership.generationId !== generationId) throw new Error("IMPORT_ENTRY_IDENTITY_CHANGED");
      const entry = await openImportedEntry(message, crypto, blockId => blocks(message.bodyHash, blockId), signal); current();
      const started = await mutate({ type: "begin-import-entry", chatId: head.chat.id, generationId, entry });
      if (started.type !== "begin-import-entry") throw new Error("IMPORT_ENTRY_UNAVAILABLE");
      if (!started.value.ready) for (const descriptor of entry.fields) await field(entry, descriptor);
      await mutate({ type: "commit-import-entry", chatId: head.chat.id, generationId, entry, beforeSeq }); beforeSeq = entry.deliverySeq;
    }
    if (page.complete) break;
    if (!page.entries.length || page.next !== beforeSeq) throw new Error("IMPORT_PAGE_INVALID");
  }
  const latest = await transport.query("chats/imported/reads:head", { ...header, chatId: head.chat.id }); current();
  if (canonicalJson(latest) !== canonicalJson(raw)) throw new Error("IMPORT_GENERATION_CHANGED");
  await mutate({ type: "complete-import-download", chatId: head.chat.id, generationId }); current(); ports.changed(); return true;
}
