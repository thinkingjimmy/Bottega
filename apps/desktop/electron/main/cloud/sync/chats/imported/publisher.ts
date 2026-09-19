/**
 * [INPUT]: Retained original imports, admitted encrypted file transport and immutable Chat outbox checkpoints.
 * [OUTPUT]: Publishes authenticated import generations with one source stream per pass, running page byte accounting and original receipt hash semantics.
 * [POS]: Imported-history delivery owner; original source retention and scheduling remain in ChatStore.
 */
import { canonicalJson, protocolHeader, type CloudBuildConfig, type FileProgress } from "@ai-chat/cloud-protocol";
import type { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import { openChatHeadForRequest } from "@ai-chat/cloud-protocol/chats/encrypted/client";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { importManifestSchema, EMPTY_IMPORT_DIGEST, extendImportDigest, importEntryBytes, hashImportPage, type ImportedEntry } from "@ai-chat/cloud-protocol/chats/imported/model";
import { encryptedImportIntentSchema, frozenImportManifestSchema, frozenImportPageSchema, importCipherEntryBytes,
  extendImportCipherDigest, hashEncryptedImportPage } from "@ai-chat/cloud-protocol/chats/imported/encrypted";
import { prepareImportManifest, openImportStatus } from "@ai-chat/cloud-protocol/chats/imported/encrypted/client";
import { frozenMessageCompleteSchema, type EncryptedMessage } from "@ai-chat/cloud-protocol/chats/encrypted/messages";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { AccountTransport } from "../../../runtime/transport";
import { ChatDeliveryCheckpoints } from "../checkpoints";
import type { ChatSyncStore, ChatOutboxItem, NativeSnapshot } from "../sources";
import { readOutboxSource, nativeSnapshotSchema } from "../sources";
import { readImportedSources, frozenImportSchema } from "./sources";
import { encodeImportedEntry } from "./fields";
import { prepareImportedMessage, stageImportedMessage } from "./messages";
// The encrypted page wire caps entries at 32; the byte guard above stays the binding limit for larger entries.
const IMPORT_PAGE_ENTRIES = 32;
export class ImportedHistoryPublisher {
  private get header() { const crypto = this.input.files.crypto;
    return { ...protocolHeader(this.input.config), expectedUserId: this.input.scope.userId,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } }; }
  constructor(private readonly input: { config: CloudBuildConfig; scope: SyncScope; store: ChatSyncStore; transport: Pick<AccountTransport, "query" | "mutate">;
    files: Pick<EncryptedBlobTransfer, "crypto" | "uploadFile">; progress?: (value: FileProgress) => void }) {}
  async deliver(item: ChatOutboxItem, signal: AbortSignal) {
    const { store, scope, transport, files } = this.input, source = await readOutboxSource(store, scope, item), snapshot = nativeSnapshotSchema.parse(source.payload);
    if (item.entity_kind !== "generation" || source.chatId !== snapshot.chat.id || snapshot.lifecycleKind !== "external-readonly") throw new Error("IMPORT_DELIVERY_IDENTITY_INVALID");
    signal.throwIfAborted(); const raw = await transport.query("chats/metadata:head", { ...this.header, chatId: source.chatId });
    if (!raw) throw new Error("IMPORT_DELIVERY_IDENTITY_CHANGED");
    const head = await openChatHeadForRequest(raw, source.chatId, files.crypto, signal);
    if (head.chat.incarnationId !== snapshot.chat.incarnationId) throw new Error("IMPORT_DELIVERY_IDENTITY_CHANGED");
    const status = await this.publish(item, snapshot, head, signal); signal.throwIfAborted();
    if (!status || status.state !== "ready") throw new Error("IMPORT_GENERATION_INCOMPLETE");
    const latest = await transport.query("chats/metadata:head", { ...this.header, chatId: source.chatId }); signal.throwIfAborted();
    const current = latest ? await openChatHeadForRequest(latest, source.chatId, files.crypto, signal) : null;
    signal.throwIfAborted();
    await store.mutate(scope, hashChatContent(["import-ack", item.id, item.payload_digest]), { type: "ack-outbox", id: item.id, payloadDigest: item.payload_digest });
    if (current) await store.mutate(scope, hashChatContent(["import-head", scope, current]), { type: "accept-chat-head", head: current });
  }
  async publish(item: ChatOutboxItem, snapshot: NativeSnapshot, head: CloudChatHead, signal: AbortSignal) {
    if (!snapshot.imported) return null;
    const { store, scope, transport, files } = this.input, frozen = frozenImportSchema.parse(snapshot.imported), checkpoints = new ChatDeliveryCheckpoints(store, scope, item);
    const done = await checkpoints.get("import-complete"); if (done?.kind === "import-complete") return done.status;
    if (item.entity_kind === "generation" && (item.execution_epoch !== head.executionEpoch || head.kind !== "external-readonly")) throw new Error("IMPORT_SOURCE_FROZEN");
    let intentRaw = await checkpoints.get("encrypted-import-intent");
    if (!intentRaw) {
      const active = await transport.query("chats/imported/reads:head", { ...this.header, chatId: snapshot.chat.id }); signal.throwIfAborted();
      if (active) await openImportStatus(active, files.crypto, signal);
      intentRaw = await checkpoints.save({ kind: "encrypted-import-intent", userId: scope.userId, chatId: snapshot.chat.id,
        incarnationId: snapshot.chat.incarnationId, executionEpoch: head.executionEpoch, expectedRevision: active?.revision ?? 0, generationId: globalThis.crypto.randomUUID() });
    }
    const intent = encryptedImportIntentSchema.parse(intentRaw);
    if (intent.chatId !== snapshot.chat.id || intent.incarnationId !== snapshot.chat.incarnationId || intent.executionEpoch !== head.executionEpoch || intent.userId !== scope.userId) throw new Error("IMPORT_DELIVERY_IDENTITY_CHANGED");
    let manifest = await checkpoints.get("import-manifest"), cipherRaw = await checkpoints.get("encrypted-import-manifest");
    let sequences: number[] | null = null;
    if (!cipherRaw) {
      let count = 0, bytes = 0, digest = EMPTY_IMPORT_DIGEST, ciphertextBytes = 0, ciphertextDigest = EMPTY_IMPORT_DIGEST;
      sequences = [];
      for await (const source of readImportedSources(store, scope, frozen, signal)) {
        sequences.push(source.metadata.deliverySeq);
        const prior = await checkpoints.get(`import-entry:${source.metadata.deliverySeq}`);
        const entry = prior?.kind === "import-entry" ? prior.entry : await encodeImportedEntry(source,
          { chatId: snapshot.chat.id, generationId: intent.generationId, outboxId: item.id }, files.crypto, checkpoints.fileJournal(), signal);
        if (!prior) await checkpoints.save({ kind: "import-entry", entry });
        const message = await prepareImportedMessage(entry, { ...intent, outboxId: item.id }, files, checkpoints, signal);
        bytes += importEntryBytes(entry); digest = extendImportDigest(digest, entry); count++;
        ciphertextBytes += importCipherEntryBytes(message.message); ciphertextDigest = extendImportCipherDigest(ciphertextDigest, message.message);
      }
      if (count !== frozen.generation.entry_count) throw new Error("IMPORT_GENERATION_COUNT_CHANGED");
      const planned = importManifestSchema.parse({ chatId: intent.chatId, incarnationId: intent.incarnationId, executionEpoch: intent.executionEpoch,
        generationId: intent.generationId, expectedRevision: intent.expectedRevision, sourceKind: frozen.generation.source_kind,
        entryCount: count, bytes, digest, incompleteTail: frozen.generation.incomplete_tail });
      if (manifest && (manifest.kind !== "import-manifest" || canonicalJson(manifest.manifest) !== canonicalJson(planned))) throw new Error("IMPORT_MANIFEST_CHANGED");
      manifest ??= await checkpoints.save({ kind: "import-manifest", manifest: planned });
      cipherRaw = await checkpoints.save(await prepareImportManifest(planned, { bytes: ciphertextBytes, digest: ciphertextDigest }, files.crypto, signal));
    }
    if (manifest?.kind !== "import-manifest") throw new Error("IMPORT_MANIFEST_INVALID");
    const cipher = frozenImportManifestSchema.parse(cipherRaw), planned = manifest.manifest;
    if (cipher.plaintextHash !== hashChatContent(planned)) throw new Error("IMPORT_MANIFEST_CHANGED");
    const started = await transport.mutate("chats/imported/api:begin", { ...this.header, manifest: cipher.transport }); signal.throwIfAborted();
    if (canonicalJson(started.manifest) !== canonicalJson(cipher.transport)) throw new Error("IMPORT_MANIFEST_CHANGED");
    await openImportStatus(started, files.crypto, signal);
    if (started.state === "superseded") throw new Error("IMPORT_GENERATION_SUPERSEDED");
    let offset = 0, pageBytes = 0, page: Array<{ entry: ImportedEntry; message: EncryptedMessage }> = [];
    const publishPage = async () => {
      signal.throwIfAborted(); const operationId = hashChatContent([planned.generationId, offset]), key = `cipher-import-page:${operationId}`;
      const identity = { chatId: intent.chatId, incarnationId: intent.incarnationId, executionEpoch: intent.executionEpoch, generationId: intent.generationId, operationId, offset };
      const plaintextHash = hashImportPage({ ...identity, payloadHash: "0".repeat(64), entries: page.map(value => value.entry) });
      let raw = await checkpoints.get(key);
      // Frozen ciphertext that predates this attempt is the only evidence that the publish may already have been received.
      const attempted = Boolean(raw);
      if (!raw) {
        const operation = { ...identity, ciphertextHash: "0".repeat(64), entries: page.map(value => value.message) };
        operation.ciphertextHash = hashEncryptedImportPage(operation);
        raw = await checkpoints.save({ kind: "encrypted-import-page", plaintextHash, transport: operation });
      }
      const frozenPage = frozenImportPageSchema.parse(raw), operation = frozenPage.transport;
      if (frozenPage.plaintextHash !== plaintextHash || canonicalJson(operation.entries) !== canonicalJson(page.map(value => value.message))) throw new Error("IMPORT_PAGE_CHANGED");
      const saved = await checkpoints.get(`import-page:${operationId}`);
      if (saved?.kind === "import-page") { offset += page.length; pageBytes = 0; page = []; return; }
      // A page prepared in this attempt has never been sent; a resumed one stays receipt-first.
      let receipt = attempted ? await transport.query("chats/imported/api:receipt", { ...this.header, operationId }) : null; signal.throwIfAborted();
      if (!receipt) {
        for (const value of page) await stageImportedMessage({ ...value, executionEpoch: intent.executionEpoch, files, checkpoints, header: this.header, signal, transport });
        receipt = await transport.mutate("chats/imported/api:publish", { ...this.header, operation }); signal.throwIfAborted();
      }
      if (receipt.chatId !== intent.chatId || receipt.operationId !== operationId || receipt.ciphertextHash !== operation.ciphertextHash ||
        receipt.receivedCount !== offset + page.length || receipt.generationId !== intent.generationId ||
        receipt.state !== (offset + page.length === planned.entryCount ? "ready" : "receiving") ||
        receipt.revision !== (receipt.state === "ready" ? planned.expectedRevision + 1 : 0)) throw new Error("IMPORT_RECEIPT_IDENTITY_CHANGED");
      const { ciphertextHash: _ciphertextHash, ...original } = receipt;
      await checkpoints.save({ kind: "import-page", receipt: { ...original, payloadHash: plaintextHash } }); offset += page.length; pageBytes = 0; page = [];
    };
    // The manifest pass above already streamed every source; only a resumed publication has to read them again.
    const order = sequences ?? (async function* () {
      for await (const source of readImportedSources(store, scope, frozen, signal)) yield source.metadata.deliverySeq;
    })();
    for await (const deliverySeq of order) {
      const checkpoint = await checkpoints.get(`import-entry:${deliverySeq}`);
      if (checkpoint?.kind !== "import-entry") throw new Error("IMPORT_ENTRY_CHECKPOINT_UNAVAILABLE");
      const message = frozenMessageCompleteSchema.parse(await checkpoints.get(`import-message:${deliverySeq}:complete`));
      if (message.plaintextHash !== hashChatContent(checkpoint.entry)) throw new Error("IMPORT_ENTRY_CHECKPOINT_CHANGED");
      // `canonicalJson` of an array is the entries plus one separator each and the two brackets; accumulating avoids re-serializing the page per entry.
      const messageBytes = Buffer.byteLength(canonicalJson(message.message));
      if (page.length && pageBytes + messageBytes + page.length + 2 > 450_000) await publishPage();
      page.push({ entry: checkpoint.entry, message: message.message }); pageBytes += messageBytes;
      if (page.length === IMPORT_PAGE_ENTRIES) await publishPage();
    }
    if (page.length) await publishPage();
    const raw = await transport.query("chats/imported/reads:head", { ...this.header, chatId: intent.chatId }); signal.throwIfAborted();
    if (!raw || canonicalJson(raw.manifest) !== canonicalJson(cipher.transport) || raw.state !== "ready") throw new Error("IMPORT_GENERATION_INCOMPLETE");
    const current = await openImportStatus(raw, files.crypto, signal);
    if (canonicalJson(current.manifest) !== canonicalJson(planned)) throw new Error("IMPORT_GENERATION_INCOMPLETE");
    await checkpoints.save({ kind: "import-complete", status: current }); return current;
  }
}
