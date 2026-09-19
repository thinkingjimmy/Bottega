/**
 * [INPUT]: Depends on verified native Home custody, admitted file crypto and original ChatStore ciphertext checkpoints.
 * [OUTPUT]: Delivers exact encrypted Home pages, resumes from local page receipts and preserves native hashes and branch-owned files after acknowledgement.
 * [POS]: Main Home publisher; original operation identities survive response loss and process restarts.
 */
import { canonicalJson, type CloudBuildConfig, type FileProgress } from "@ai-chat/cloud-protocol";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { homeStatusSchema } from "@ai-chat/cloud-protocol/chats/home/model";
import { openHomeReceipt } from "@ai-chat/cloud-protocol/chats/home/encrypted/client";
import type { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { SyncScope } from "../../../../shared/local-storage/contracts";
import type { ChatHomeService } from "../../chat-home/chat-home-service";
import type { AccountTransport } from "../runtime/transport";
import { EncryptedChatMetadata } from "../sync/chats/encryption/metadata";
import { ChatDeliveryCheckpoints } from "../sync/chats/checkpoints";
import type { ChatSyncStore, ChatOutboxItem } from "../sync/chats/sources";
import { chatIdOf, readOutboxSource } from "../sync/chats/sources";
import { homeJobSchema } from "../../chats/sqlite/cloud/home/contracts";
import { HomeSourceCustody } from "./custody";
import { readFrozenHome, saveFrozenHome } from "./encryption/source";
import { prepareHomeCiphertext, frozenHomePage, uploadHomeFiles } from "./encryption/producer";
export class HomeSnapshotPublisher {
  private readonly metadata;
  constructor(private readonly input: { config: CloudBuildConfig; scope: SyncScope; userData: string; store: ChatSyncStore; homes: ChatHomeService;
    transport: Pick<AccountTransport, "query" | "mutate">; files: EncryptedBlobTransfer; progress?: (value: FileProgress) => void }) {
    this.metadata = new EncryptedChatMetadata({ ...input, userId: input.scope.userId, crypto: () => input.files.crypto });
  }
  async deliver(item: ChatOutboxItem, signal: AbortSignal) {
    const { store, scope } = this.input, checkpoints = new ChatDeliveryCheckpoints(store, scope, item);
    const source = await readOutboxSource(store, scope, item), job = homeJobSchema.parse(source.payload);
    if (item.entity_kind !== "home-snapshot" || job.id !== item.id || job.chatId !== source.chatId) throw new Error("HOME_JOB_IDENTITY_CHANGED");
    if (!await readFrozenHome(checkpoints)) return;
    const head = await this.metadata.head(job.chatId, signal); signal.throwIfAborted();
    if (!head || head.chat.incarnationId !== job.incarnationId) throw new Error("HOME_OWNER_UNAVAILABLE");
    const completed = await checkpoints.get("home-complete");
    if (completed?.kind === "home-complete" && !completed.encryptedStatus) throw new Error("HOME_CIPHER_COMPLETION_REQUIRED");
    if (!completed && head.executionEpoch > job.executionEpoch) {
      await store.mutate(scope, hashChatContent(["home-head", scope, head]), { type: "accept-chat-head", head });
      await store.mutate(scope, hashChatContent(["home-archive", item.id, item.payload_digest]), { type: "archive-home-job", id: item.id, payloadDigest: item.payload_digest }); return;
    }
    if (!completed) {
      if (head.executionEpoch !== job.executionEpoch || head.executorDeviceId !== job.sourceDeviceId) throw new Error("HOME_EXECUTOR_CHANGED");
      if (head.headSeq < job.throughSeq) return;
      await this.publish(item, head, signal);
    }
    signal.throwIfAborted();
    await store.mutate(scope, hashChatContent(["home-ack", item.id, item.payload_digest]), { type: "ack-outbox", id: item.id, payloadDigest: item.payload_digest });
    const current = await this.metadata.head(job.chatId, signal); signal.throwIfAborted();
    if (current) await store.mutate(scope, hashChatContent(["home-head", scope, current]), { type: "accept-chat-head", head: current });
    await this.release(item);
  }
  async publish(item: ChatOutboxItem, head: CloudChatHead, signal: AbortSignal) {
    const { scope, store, transport, files } = this.input, checkpoints = new ChatDeliveryCheckpoints(store, scope, item);
    const custody = new HomeSourceCustody(this.input.userData, scope, item.id), header = this.metadata.header;
    if (head.kind === "external-readonly" || head.chat.classification.conversationKind !== "ordinary") return null;
    const completed = await checkpoints.get("home-complete");
    if (completed?.kind === "home-complete") {
      if (!completed.encryptedStatus) throw new Error("HOME_CIPHER_COMPLETION_REQUIRED");
      await this.confirmHead(head.chat.id, signal); return completed.status;
    }
    let source = await readFrozenHome(checkpoints);
    if (!source) {
      if (item.entity_kind === "home-snapshot") throw new Error("HOME_SNAPSHOT_CAPTURE_PENDING");
      const current = await this.metadata.head(head.chat.id, signal); signal.throwIfAborted();
      if (!current || current.chat.incarnationId !== head.chat.incarnationId || current.executionEpoch !== head.executionEpoch || current.executorDeviceId !== head.executorDeviceId) throw new Error("HOME_EXECUTOR_CHANGED");
      source = await custody.capture(this.input.homes, { ...head, headSeq: current.headSeq }, hashChatContent([scope, item.id, "home"]), signal);
      signal.throwIfAborted(); await saveFrozenHome(checkpoints, source);
    }
    const { manifest } = source;
    if (!(await checkpoints.get("home-manifest"))) await saveFrozenHome(checkpoints, source);
    const encrypted = await prepareHomeCiphertext(source, checkpoints, custody, files, header, signal);
    let status = await transport.mutate("chats/home/api:begin", { ...header, manifest: encrypted.manifest.manifest }); signal.throwIfAborted();
    if (canonicalJson(status.manifest) !== canonicalJson(encrypted.manifest.manifest)) throw new Error("HOME_MANIFEST_IDENTITY_CHANGED");
    if (status.state === "superseded") throw new Error("HOME_SNAPSHOT_SUPERSEDED");
    for (let offset = 0; offset < source.entries.length; offset += 50) {
      signal.throwIfAborted();
      // Frozen ciphertext that predates this attempt is the only evidence that the publish may already have been received.
      const operationId = hashChatContent([manifest.snapshotId, offset]), attempted = Boolean(await checkpoints.get(`cipher-home-page:${operationId}`));
      const frozen = await frozenHomePage(source, encrypted.entries, offset, checkpoints, files), operation = frozen.operation;
      if (operation.operationId !== operationId) throw new Error("HOME_CIPHER_PAGE_CHANGED");
      if (await checkpoints.get(`home-page:${operationId}`)) continue;
      let encryptedReceipt = attempted ? await transport.query("chats/home/api:receipt", { ...header, operationId }) : null; signal.throwIfAborted();
      if (!encryptedReceipt) {
        await uploadHomeFiles(encrypted.entries.slice(offset, offset + 50), checkpoints, files, header, signal, this.input.progress);
        encryptedReceipt = await transport.mutate("chats/home/api:publish", { ...header, operation }); signal.throwIfAborted();
      }
      const receipt = openHomeReceipt(encryptedReceipt, frozen);
      await checkpoints.save({ kind: "home-page", receipt, encryptedReceipt });
    }
    status = await transport.query("chats/home/reads:head", { ...header, chatId: head.chat.id, snapshotId: manifest.snapshotId }) ?? status; signal.throwIfAborted();
    if (status.state !== "ready" || canonicalJson(status.manifest) !== canonicalJson(encrypted.manifest.manifest) || status.receivedDigest !== status.manifest.digest ||
      status.receivedCount !== manifest.entryCount || status.bytes !== status.manifest.bytes || status.omittedCount !== manifest.omittedCount) throw new Error("HOME_SNAPSHOT_INCOMPLETE");
    const nativeStatus = homeStatusSchema.parse({ manifest, state: "ready", receivedCount: manifest.entryCount, receivedDigest: manifest.digest,
      bytes: manifest.bytes, omittedCount: manifest.omittedCount });
    await checkpoints.save({ kind: "home-complete", status: nativeStatus, encryptedStatus: status }); await this.confirmHead(head.chat.id, signal); return nativeStatus;
  }
  private async confirmHead(chatId: string, signal: AbortSignal) {
    const { store, scope } = this.input;
    const head = await this.metadata.head(chatId, signal); signal.throwIfAborted();
    if (head) await store.mutate(scope, hashChatContent(["home-head", scope, head]), { type: "accept-chat-head", head });
  }
  async release(item: ChatOutboxItem) {
    const { scope, store } = this.input, chatId = chatIdOf(item);
    const retained = await store.read(scope, { type: "recovery-home-retained", chatId, jobId: item.id });
    if (retained.type !== "recovery-home-retained") throw new Error("HOME_RECOVERY_CUSTODY_UNAVAILABLE");
    if (!retained.value) await new HomeSourceCustody(this.input.userData, scope, item.id).release();
  }
}
