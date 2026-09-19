/**
 * [INPUT]: Depends on the sole ChatStore outbox, frozen source/checkpoint readers and scoped formal cloud/file ports.
 * [OUTPUT]: Publishes frozen snapshots, recovers incomplete archived/native content with atomic identity claims and explicit-conflict rebasing, and adopts completed cloud content.
 * [POS]: Main Chat uploader; it does not acknowledge imports/Home or create another business queue.
 */
import { canonicalJson, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { hashChatMetadataOperation } from "@ai-chat/cloud-protocol/chats/metadata";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { chatInitialManifestSchema, extendChatBodyDigest, EMPTY_CHAT_BODY_DIGEST, hashChatInitialPage } from "@ai-chat/cloud-protocol/chats/transcript/initial";
import { frozenInitialManifestSchema, frozenInitialPageSchema } from "@ai-chat/cloud-protocol/chats/encrypted/initial";
import { prepareInitialManifest, prepareInitialPage, openInitialReceipt } from "@ai-chat/cloud-protocol/chats/encrypted/initial-client";
import { openChatHead } from "@ai-chat/cloud-protocol/chats/encrypted/client";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { EncryptedChatMetadata } from "./encryption/metadata";
import type { ChatCipherPort } from "@ai-chat/cloud-protocol/chats/encrypted/client";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { AccountTransport } from "../../runtime/transport";
import { ChatDeliveryCheckpoints } from "./checkpoints";
import { readNativeSnapshot, type ChatOutboxItem, type ChatSyncStore } from "./sources";
import { projectNativeBody, type ChatBodyBytePorts } from "./bodies";
import { stageChatBody } from "./body-publisher";
type Ports = { crypto(): ChatCipherPort; store: ChatSyncStore; scope: SyncScope; config: CloudBuildConfig; deviceId: string;
  transport: Pick<AccountTransport, "query" | "mutate">; bytes: ChatBodyBytePorts };
// The page bound in chatInitialPageSchema; partial publication has to stay observable, so the stride is the wire page size.
const PAGE_HASHES = 16;
type ChatIdentity = Awaited<ReturnType<NativeChatInitialization["readIdentity"]>>;
export class NativeChatInitialization {
  private readonly encrypted: EncryptedChatMetadata;
  private get header() { return this.encrypted.header; }
  private readonly flights = new Map<string, Promise<void>>();
  private readonly identities = new Map<string, Promise<ChatIdentity>>();
  private readonly controller = new AbortController();
  constructor(private readonly ports: Ports) {
    if (ports.scope.environment !== ports.config.environmentId) throw new Error("environment-mismatch");
    this.encrypted = new EncryptedChatMetadata({ ...ports, userId: ports.scope.userId });
  }
  publish(item: ChatOutboxItem): Promise<void> {
    if (this.controller.signal.aborted) return Promise.reject(new Error("CHAT_UPLOAD_CLOSED"));
    const previous = this.flights.get(item.id); if (previous) return previous;
    const flight = this.publishSnapshot(item).catch(error => { this.retire([item]); throw error; }); this.flights.set(item.id, flight);
    void flight.finally(() => { if (this.flights.get(item.id) === flight) this.flights.delete(item.id); }).catch(() => undefined);
    return flight;
  }
  // Decoding and hash-verifying a whole transcript is expensive; one pass reuses the same identity for every phase of the item.
  createIdentity(item: ChatOutboxItem): Promise<ChatIdentity> {
    const key = `${item.id}:${item.payload_digest}`;
    const previous = this.identities.get(key); if (previous) return previous;
    const flight = this.readIdentity(item); this.identities.set(key, flight);
    void flight.catch(() => { if (this.identities.get(key) === flight) this.identities.delete(key); });
    return flight;
  }
  retire(items: readonly ChatOutboxItem[]) { for (const item of items) this.identities.delete(`${item.id}:${item.payload_digest}`); }
  private async readIdentity(item: ChatOutboxItem) {
    const { store, scope } = this.ports, signal = this.controller.signal;
    const snapshot = await readNativeSnapshot(store, scope, item);
    signal.throwIfAborted();
    const checkpoints = new ChatDeliveryCheckpoints(store, scope, item);
    let creation = await checkpoints.get("metadata-operation");
    if (!creation) {
      const existing = await this.encrypted.head(snapshot.chat.id, signal);
      if (existing) {
        const recovery = await checkpoints.get("native-recovery"), body = await this.ports.transport.query("chats/body/reads:head", { ...this.header, chatId: snapshot.chat.id });
        const completedElsewhere = body.state === "ready" && (!recovery || body.initialization?.manifestId !== hashChatContent(["chat-native", item.id]));
        if (existing.chat.incarnationId !== snapshot.chat.incarnationId || completedElsewhere || existing.kind === "external-readonly") return { snapshot, checkpoints, head: existing, adopted: true };
        if (!recovery) await checkpoints.save({ kind: "native-recovery", head: existing, initialization: body.initialization ?? null });
        const recovered = await this.recoverHead(item, checkpoints, existing, signal);
        return { snapshot, checkpoints, ...recovered, recovery: true };
      }
    }
    if (!creation) {
      const operation = { operationId: hashChatContent(["chat-create", item.id]), chatId: snapshot.chat.id, payloadHash: EMPTY_CHAT_BODY_DIGEST,
        command: { kind: "create" as const, chat: snapshot.chat, lifecycleKind: snapshot.lifecycleKind, archivedAt: snapshot.archivedAt } };
      creation = await checkpoints.save({ kind: "metadata-operation", basis: null, operation: { ...operation, payloadHash: hashChatMetadataOperation(operation) } });
    }
    if (creation.kind !== "metadata-operation" || creation.operation.command.kind !== "create") throw new Error("CHAT_CREATION_CHECKPOINT_INVALID");
    signal.throwIfAborted();
    let metadata = await checkpoints.get("metadata-receipt");
    if (!metadata) {
      const receipt = await this.encrypted.deliver(checkpoints, creation.operation, signal);
      signal.throwIfAborted();
      if (receipt.payloadHash !== creation.operation.payloadHash || receipt.operationId !== creation.operation.operationId || receipt.chatId !== snapshot.chat.id || receipt.sourceDeviceId !== this.ports.deviceId) throw new Error("CHAT_CREATION_RECEIPT_MISMATCH");
      metadata = await checkpoints.save({ kind: "metadata-receipt", receipt });
    }
    if (metadata.kind !== "metadata-receipt") throw new Error("CHAT_CREATION_CHECKPOINT_INVALID");
    if (metadata.receipt.status !== "applied") {
      const head = await this.encrypted.head(snapshot.chat.id, signal);
      if (head) return { snapshot, checkpoints, head, adopted: true };
      throw new Error("CHAT_CREATION_DELETED");
    }
    if (!metadata.receipt.head) throw new Error("CHAT_CREATION_CONFLICT");
    const head = metadata.receipt.head;
    if (head.executorDeviceId !== this.ports.deviceId || head.chat.incarnationId !== snapshot.chat.incarnationId) throw new Error("CHAT_CREATION_AUTHORITY_CHANGED");
    const current = await this.encrypted.head(snapshot.chat.id, signal);
    if (current && (current.executionEpoch !== head.executionEpoch || current.executorDeviceId !== this.ports.deviceId)) return { snapshot, checkpoints, head: current, adopted: true };
    return { snapshot, checkpoints, head, adopted: false };
  }
  private async recoverHead(item: ChatOutboxItem, checkpoints: ChatDeliveryCheckpoints, current: CloudChatHead, signal: AbortSignal) {
    const basis = await checkpoints.get("native-recovery");
    if (basis?.kind !== "native-recovery") throw new Error("NATIVE_RECOVERY_REQUIRED");
    let expectedEpoch = basis.head.executionEpoch;
    for (let attempt = 0; attempt < 50; attempt++) {
      let confirmed = await checkpoints.get(`native-recovery-head:${expectedEpoch}`);
      if (!confirmed) {
        const wire = await this.ports.transport.mutate("chats/body/recovery:claim", { ...this.header, chatId: basis.head.chat.id,
          incarnationId: basis.head.chat.incarnationId, expectedEpoch, operationId: hashChatContent(["recover-initial", item.id, expectedEpoch]) });
        const head = await openChatHead(wire.head, this.ports.crypto(), signal);
        if (head.chat.id !== basis.head.chat.id || head.chat.incarnationId !== basis.head.chat.incarnationId ||
          wire.status === "claimed" && head.executorDeviceId !== this.ports.deviceId) throw new Error("NATIVE_RECOVERY_HEAD_CHANGED");
        confirmed = await checkpoints.save({ kind: "native-recovery-head", expectedEpoch, ...wire, head });
      }
      if (confirmed.kind !== "native-recovery-head") throw new Error("NATIVE_RECOVERY_REQUIRED");
      if (confirmed.status === "conflict") { expectedEpoch = confirmed.head.executionEpoch; continue; }
      const head = current.executionEpoch > confirmed.head.executionEpoch ? current : confirmed.head;
      return { head, adopted: confirmed.status === "adopted" || head.executionEpoch !== confirmed.head.executionEpoch,
        initialization: confirmed.initialization };
    }
    throw new Error("NATIVE_RECOVERY_CONTENTION");
  }
  async recoveredHead(item: ChatOutboxItem) {
    const identity = await this.createIdentity(item);
    return "recovery" in identity ? this.encrypted.head(identity.snapshot.chat.id, this.controller.signal) : null;
  }
  private async publishSnapshot(item: ChatOutboxItem) {
    const { transport, bytes } = this.ports, signal = this.controller.signal;
    const source = await this.createIdentity(item), { snapshot, checkpoints, head, adopted } = source;
    if (adopted) return;
    if (await checkpoints.get("native-complete")) return;
    const identity = { chatId: snapshot.chat.id, incarnationId: snapshot.chat.incarnationId, executionEpoch: head.executionEpoch };
    const hashes: string[] = [], ciphertextHashes: string[] = [];
    if (Object.keys(snapshot.subagents).length && !snapshot.messages.some(message => message.role === "assistant")) throw new Error("CHAT_SUBAGENT_PARENT_UNAVAILABLE");
    for (const message of snapshot.messages) {
      signal.throwIfAborted();
      let checkpoint = await checkpoints.get(`body:${message.seq}`);
      if (!checkpoint) {
        const body = await projectNativeBody(snapshot, message, bytes, this.header, item.id, signal, checkpoints.fileJournal());
        signal.throwIfAborted();
        checkpoint = await checkpoints.save({ kind: "native-body", body, bodyHash: hashChatContent(body) });
      }
      if (checkpoint.kind !== "native-body" || checkpoint.body.message.id !== message.id) throw new Error("CHAT_BODY_CHECKPOINT_INVALID");
      const encrypted = await stageChatBody({ checkpoints, body: checkpoint.body, bodyHash: checkpoint.bodyHash, identity, outboxId: item.id,
        bytes, header: this.header, signal, transport });
      hashes.push(encrypted.plaintextHash); ciphertextHashes.push(encrypted.ciphertextHash);
    }
    const manifest = chatInitialManifestSchema.parse({ ...identity, manifestId: hashChatContent(["chat-native", item.id]), messageCount: hashes.length,
      throughSeq: snapshot.messages.at(-1)?.seq ?? 0, reservedThroughSeq: snapshot.nextSeq - 1, lastCommittedUserSeq: snapshot.lastCommittedUserSeq,
      digest: hashes.reduce(extendChatBodyDigest, EMPTY_CHAT_BODY_DIGEST) });
    await checkpoints.save({ kind: "native-manifest", manifest }); signal.throwIfAborted();
    let frozenManifest = await checkpoints.get("encrypted-native-manifest");
    if (!frozenManifest) frozenManifest = await checkpoints.save(await prepareInitialManifest(manifest,
      ciphertextHashes.reduce(extendChatBodyDigest, EMPTY_CHAT_BODY_DIGEST), this.ports.crypto(), signal));
    const cipherManifest = frozenInitialManifestSchema.parse(frozenManifest);
    if (cipherManifest.plaintextHash !== hashChatContent(manifest)) throw new Error("CHAT_INITIAL_MANIFEST_MISMATCH");
    let replacement = "initialization" in source ? source.initialization : null;
    const begin = async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try { return await transport.mutate("chats/body/initial:begin", { ...this.header, manifest: cipherManifest.transport,
          ...(replacement ? { replaceIncomplete: replacement } : {}) }); }
        catch (error) {
          // Only a definite rejection permits a new predecessor proof; lost replies reuse the frozen manifest.
          if (!("recovery" in source) || !String(error).includes("chat-initial-identity-conflict")) throw error;
          const current = await this.encrypted.head(identity.chatId, signal);
          const body = await transport.query("chats/body/reads:head", { ...this.header, chatId: identity.chatId });
          if (!current || current.executorDeviceId !== this.ports.deviceId || current.executionEpoch !== identity.executionEpoch ||
            body.incarnationId !== identity.incarnationId || body.state === "ready") throw error;
          replacement = body.initialization ?? null;
        }
      }
      throw new Error("NATIVE_RECOVERY_CONTENTION");
    };
    let progress = await begin(); signal.throwIfAborted();
    while (progress.state === "resetting") { progress = await begin(); signal.throwIfAborted(); }
    if (progress.manifestId !== manifest.manifestId || progress.ciphertextHash !== hashChatContent(cipherManifest.transport) || progress.messageCount !== hashes.length) throw new Error("CHAT_INITIAL_MANIFEST_MISMATCH");
    for (let offset = 0; offset < hashes.length; offset += PAGE_HASHES) {
      signal.throwIfAborted();
      const value = { ...identity, manifestId: manifest.manifestId, operationId: hashChatContent(["chat-native-page", item.id, offset]),
        offset, bodyHashes: hashes.slice(offset, offset + PAGE_HASHES), payloadHash: EMPTY_CHAT_BODY_DIGEST };
      const operation = { ...value, payloadHash: hashChatInitialPage(value) };
      let frozenPage = await checkpoints.get(`cipher-native-page:${operation.operationId}`);
      // Frozen ciphertext that predates this attempt is the only evidence that the publish may already have been received.
      const attempted = Boolean(frozenPage);
      if (!frozenPage) frozenPage = await checkpoints.save(await prepareInitialPage(operation, ciphertextHashes.slice(offset, offset + PAGE_HASHES), this.ports.crypto(), signal));
      const cipherPage = frozenInitialPageSchema.parse(frozenPage);
      if (cipherPage.plaintextHash !== operation.payloadHash) throw new Error("CHAT_INITIAL_PAGE_MISMATCH");
      let checkpoint = await checkpoints.get(`page:${operation.operationId}`);
      if (!checkpoint) {
        // A page prepared in this attempt has never been sent; a resumed one stays receipt-first.
        let raw = attempted ? await transport.query("chats/body/initial:receipt", { ...this.header, operationId: operation.operationId }) : null;
        signal.throwIfAborted();
        if (!raw) raw = await transport.mutate("chats/body/initial:publish", { ...this.header, operation: cipherPage.transport });
        if (canonicalJson(raw.commit) !== canonicalJson(cipherPage.transport)) throw new Error("CHAT_INITIAL_RECEIPT_MISMATCH");
        const receipt = await openInitialReceipt(raw, this.ports.crypto(), signal);
        signal.throwIfAborted();
        if (receipt.operationId !== operation.operationId || receipt.payloadHash !== operation.payloadHash || receipt.chatId !== identity.chatId ||
          receipt.manifestId !== manifest.manifestId || receipt.sourceDeviceId !== this.ports.deviceId || receipt.receivedCount !== offset + operation.bodyHashes.length) throw new Error("CHAT_INITIAL_RECEIPT_MISMATCH");
        checkpoint = await checkpoints.save({ kind: "native-page", receipt });
      }
      if (checkpoint.kind !== "native-page") throw new Error("CHAT_INITIAL_CHECKPOINT_INVALID");
    }
    progress = await begin(); signal.throwIfAborted();
    if (progress.state !== "ready" || progress.receivedCount !== hashes.length || progress.digest !== cipherManifest.transport.digest || progress.ciphertextHash !== hashChatContent(cipherManifest.transport)) throw new Error("CHAT_INITIAL_INCOMPLETE");
    await checkpoints.save({ kind: "native-complete", manifest });
  }

  async close() { this.controller.abort(new Error("CHAT_UPLOAD_CLOSED")); this.identities.clear(); await Promise.allSettled(this.flights.values()); }
}
