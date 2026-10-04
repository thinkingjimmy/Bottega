/**
 * [INPUT]: Existing account transport, admitted crypto owner and original Chat delivery checkpoints.
 * [OUTPUT]: Request-bound heads, receipt-first recovery for every prepared operation, exactly frozen ciphertext metadata delivery, and the idempotent R-35 workflow-role repair.
 * [POS]: Main metadata codec adapter; original SQLite outbox remains the only durable task owner.
 */
import { protocolHeader, canonicalJson, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { frozenChatMetadataSchema } from "@ai-chat/cloud-protocol/chats/encrypted";
import { openChatHeadForRequest, openChatMetadataReceipt, prepareChatMetadataOperation, type ChatCipherPort } from "@ai-chat/cloud-protocol/chats/encrypted/client";
import { hashChatMetadataOperation, type ChatMetadataOperation } from "@ai-chat/cloud-protocol/chats/metadata";
import type { ChatWorkflowRole, CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { AccountTransport } from "../../../runtime/transport/transport";
import type { ChatDeliveryCheckpoints } from "../checkpoints";
export class EncryptedChatMetadata {
  constructor(private readonly input: { config: CloudBuildConfig; userId: string; crypto(): ChatCipherPort;
    transport: Pick<AccountTransport, "query" | "mutate"> }) {}
  get header() {
    const crypto = this.input.crypto(); if (crypto.session.userId !== this.input.userId) throw new Error("cloud-request-superseded");
    return { ...protocolHeader(this.input.config), expectedUserId: this.input.userId,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
  }
  async head(chatId: string, signal?: AbortSignal) {
    const crypto = this.input.crypto(), value = await this.input.transport.query("chats/metadata:head", { ...this.header, chatId });
    signal?.throwIfAborted(); return value ? openChatHeadForRequest(value, chatId, crypto, signal) : null;
  }
  async receipt(operationId: string, signal?: AbortSignal) {
    const crypto = this.input.crypto(), value = await this.input.transport.query("chats/metadata:receipt", { ...this.header, operationId });
    signal?.throwIfAborted(); return value ? openChatMetadataReceipt(value, crypto, signal) : null;
  }
  /**
   * R-35 repair: set a workflow Chat's missing role from its current head. Idempotent on the server (the same role is converged),
   * so no checkpoint is kept: a lost response is settled by the next pass reading the role on the head.
   */
  async setWorkflowRole(head: CloudChatHead, workflowRole: ChatWorkflowRole, signal?: AbortSignal) {
    const crypto = this.input.crypto(), header = this.header;
    const operation = { operationId: hashChatContent(["workflow-role", head.chat.id, head.chat.incarnationId, workflowRole, String(head.chat.cloudRevision)]),
      chatId: head.chat.id, payloadHash: "0".repeat(64),
      command: { kind: "set-workflow-role" as const, incarnationId: head.chat.incarnationId, expectedRevision: head.chat.cloudRevision, workflowRole } };
    const original = { ...operation, payloadHash: hashChatMetadataOperation(operation) };
    const frozen = await prepareChatMetadataOperation(original, head, crypto, signal);
    const receipt = await this.input.transport.mutate("chats/metadata:apply", { ...header, operation: frozen.transport });
    return openChatMetadataReceipt(receipt, crypto, signal);
  }
  async deliver(checkpoints: ChatDeliveryCheckpoints, operation: ChatMetadataOperation, signal?: AbortSignal) {
    const crypto = this.input.crypto(), header = this.header, key = `cipher-metadata:${operation.operationId}`;
    let raw = await checkpoints.get(key);
    // Frozen ciphertext that predates this attempt is the only evidence that the mutate may already have been received.
    const attempted = Boolean(raw);
    if (!raw) {
      const current = operation.command.kind === "create" ? null : await this.head(operation.chatId, signal);
      const candidate = await prepareChatMetadataOperation(operation, current, crypto, signal);
      signal?.throwIfAborted();
      try { raw = await checkpoints.save(candidate); }
      catch (error) { raw = await checkpoints.get(key); if (!raw) throw error; }
    }
    const frozen = frozenChatMetadataSchema.parse(raw);
    if (frozen.plaintextHash !== operation.payloadHash || frozen.transport.operationId !== operation.operationId ||
      frozen.transport.chatId !== operation.chatId || canonicalJson(frozen.encryptedSpace) !== canonicalJson(header.encryptedSpace)) throw new Error("CHAT_CIPHER_MAPPING_MISMATCH");
    signal?.throwIfAborted();
    // A first attempt has nothing to recover, so it publishes straight away; every later attempt stays receipt-first.
    let receipt = attempted ? await this.input.transport.query("chats/metadata:receipt", { ...header, operationId: operation.operationId }) : null;
    signal?.throwIfAborted();
    if (!receipt) receipt = await this.input.transport.mutate("chats/metadata:apply", { ...header, operation: frozen.transport });
    signal?.throwIfAborted();
    if (receipt.ciphertextHash !== frozen.transport.ciphertextHash || canonicalJson(receipt.commit) !== canonicalJson(frozen.transport)) throw new Error("CHAT_CIPHER_RECEIPT_MISMATCH");
    return openChatMetadataReceipt(receipt, crypto, signal);
  }
}
