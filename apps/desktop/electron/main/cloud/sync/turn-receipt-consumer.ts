/**
 * [INPUT]: Depends on formal turn receipts, authenticated body reading and ChatStore's atomic settlement command.
 * [OUTPUT]: Records open/sealing receipts and atomically installs settled outcomes, file indexes, divergent custody and acknowledgements.
 * [POS]: Background receipt consumer shared by downlink, login recovery and publication reconciliation.
 */
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { encryptedTurnReceiptSchema, type EncryptedTurnReceipt } from "@ai-chat/cloud-protocol/turns/encrypted/model";
import { openTurnReceipt, type TurnReceiptReader } from "@ai-chat/cloud-protocol/turns/encrypted/receipt";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { hashChatContent, type ChatBody } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { readChatBody } from "@ai-chat/cloud-protocol/chats/transcript/reader";
import type { AccountTransport } from "../runtime/transport";
import type { SyncScope } from "../../../../shared/local-storage/contracts";
import type { ChatSyncStore } from "./chats/sources";
export class TurnReceiptConsumer {
  private get header() { const crypto = this.ports.crypto(); return { ...protocolHeader(this.ports.config), expectedUserId: this.ports.scope.userId,
    encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } }; }
  private readonly installed = new Set<string>();
  constructor(private readonly ports: { config: CloudBuildConfig; scope: SyncScope; store: ChatSyncStore;
    transport: Pick<AccountTransport, "query">; crypto(): FileCipherPort; signal: AbortSignal; changed(): void }) {}
  async poll(chatId: string, turnId: string) {
    const receipt = await this.ports.transport.query("turns/reads:receipt", { ...this.header, chatId, turnId });
    if (receipt) await this.consume(receipt); return receipt;
  }
  private reader(): TurnReceiptReader {
    const readPrefixPage: TurnReceiptReader["readPrefixPage"] = async (chatId, turnId, afterSeq, throughSeq, signal) => {
      signal.throwIfAborted(); const page = await this.ports.transport.query("turns/reads:page", { ...this.header, chatId, turnId, afterSeq, throughSeq }); signal.throwIfAborted(); return page;
    };
    return { readPrefixPage, readResult: async (chatId, incarnationId, messageId, bodyHash, signal) => {
      signal.throwIfAborted(); const projection = await this.ports.transport.query("chats/body/reads:get", { ...this.header, chatId, messageId });
      if (!projection || projection.bodyHash !== bodyHash) throw new Error("TURN_BODY_UNAVAILABLE");
      return readChatBody(projection, { id: chatId, incarnationId }, { crypto: this.ports.crypto, readPrefixPage,
        readBlock: async (chatId, bodyHash, blockId, current) => {
          current.throwIfAborted(); const block = await this.ports.transport.query("chats/body/reads:block", { ...this.header, chatId, bodyHash, blockId }); current.throwIfAborted(); return block;
        } }, signal);
    } };
  }
  async consume(raw: EncryptedTurnReceipt) {
    const wire = encryptedTurnReceiptSchema.parse(raw), { store, scope, signal } = this.ports, reader = this.reader();
    let body: ChatBody | null | undefined;
    reader.openedResult = value => { body = value; };
    const receipt = await openTurnReceipt(wire, this.ports.crypto(), reader, signal);
    signal.throwIfAborted();
    const target = await store.read(scope, { type: "turn-target", chatId: receipt.chatId });
    if (target.type !== "turn-target" || !target.value || target.value.incarnationId !== receipt.incarnationId) throw new Error("TURN_TARGET_UNAVAILABLE");
    if (receipt.settlementState === "settled" && receipt.resultKind === "message" && body === undefined) {
      const result = wire.result!, bodyHash = result.kind === "prefix" ? result.prefix.bodyHash : result.kind === "adopted" ? result.bodyHash :
        result.final.result.kind === "message" ? result.final.result.bodyHash : null;
      if (!bodyHash) throw new Error("TURN_BODY_UNAVAILABLE");
      body = await reader.readResult(receipt.chatId, receipt.incarnationId, receipt.assistantMessageId, bodyHash, signal);
    }
    if (receipt.settlementState === "settled" && receipt.resultKind === "message" && (!body || body.message.role !== "assistant" || body.message.resultHash !== receipt.resultHash)) throw new Error("TURN_RESULT_HASH_CHANGED");
    signal.throwIfAborted();
    const action = { type: "settle-turn" as const, receipt, message: body?.message ?? null, ...(body?.subagents ? { subagents: body.subagents } : {}),
      deferReplacement: true,
      ...(body ? { files: { attachments: body.attachments, media: body.media } } : {}),
      expectedMessageRevision: target.value.messageRevision, expectedOutboxDigest: target.value.outboxDigest,
      cursor: hashChatContent([receipt.chatId, receipt.turnId, receipt.settlementState, receipt.resultHash ?? null]) };
    const operationId = hashChatContent(["turn-consume", scope, action]); if (this.installed.has(operationId)) return;
    const result = await store.mutate(scope, operationId, action);
    if (result.result.type === "settle-turn" && receipt.settlementState === "settled" && !result.result.value.settled) return;
    if (this.installed.size >= 1000) this.installed.delete(this.installed.values().next().value!);
    this.installed.add(operationId); this.ports.changed();
  }
}
