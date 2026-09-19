/**
 * [INPUT]: Depends on approved account scope, original-epoch SQLite outboxes, verified bodies and formal turn RPCs.
 * [OUTPUT]: Publishes ordered turns from turn-scoped outbox scans with frozen final watermarks, and seals replaced unknown turns against the next durable admission.
 * [POS]: Main synchronization publisher; it never starts or stops Agents and never renews an execution lease.
 */
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { hashChatContent, type ChatBody } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { readChatBody } from "@ai-chat/cloud-protocol/chats/transcript/reader";
import { sameTurnBodySource } from "@ai-chat/cloud-protocol/turns/encrypted/journal";
import { turnStartSchema, hashTurnIdentity } from "@ai-chat/cloud-protocol/turns/model";
import type { EncryptedTurnReceipt } from "@ai-chat/cloud-protocol/turns/encrypted/model";
import { prepareTurnStart, prepareTurnChunk, prepareTurnFinal } from "@ai-chat/cloud-protocol/turns/encrypted/client";
import { cipherTurnIdentity, validateTurnStart, validateTurnChunk, validateTurnFinal } from "@ai-chat/cloud-protocol/turns/encrypted/wire";
import { sealChatPacket } from "@ai-chat/cloud-protocol/chats/encrypted/client";
import { createLiveProjection, reduceLiveProjection } from "@ai-chat/cloud-protocol/turns/projection";
import { hashTurnChunk, type LiveProjection } from "@ai-chat/cloud-protocol/turns/live";
import type { TurnStart, TurnFinal } from "@ai-chat/cloud-protocol/turns/model";
import type { SyncScope } from "../../../../shared/local-storage/contracts";
import { localTurnAdmissionSchema, type LocalTurnAdmission } from "../../chats/sqlite/cloud/delivery/turns/model";
import { cloudActionSchema } from "../../chats/sqlite/cloud/protocol";
import type { AccountTransport } from "../runtime/transport";
import { ChatDeliveryCheckpoints } from "../sync/chats/checkpoints";
import { projectNativeBody, type ChatBodyBytePorts } from "../sync/chats/bodies";
import { stageChatBody } from "../sync/chats/body-publisher";
import { readOutboxSource, type ChatSyncStore, type ChatOutboxItem, type NativeSnapshot } from "../sync/chats/sources";
import { TurnReceiptConsumer } from "../sync/turn-receipt-consumer";
import { readChatOutbox, readTurnOutbox, type HandoffEvidence } from "./sources";
import { messageSchema, subagentsSchema } from "../../chats/chat-schema";
type ResultEvidence = Pick<HandoffEvidence, "resultKind" | "resultMessage" | "dispatch" | "terminal" | "subagents">;
// One macrotask hop per 64 chunks keeps the main process responsive without turning a long replay into hundreds of event-loop turns.
const REPLAY_STRIDE = 64;
export class LiveTurnPublisher {
  private get crypto() { return this.ports.bytes.files.crypto; }
  private get header() { return { ...protocolHeader(this.ports.config), expectedUserId: this.ports.scope.userId,
    encryptedSpace: { scope: this.crypto.scope, keyPackageFingerprint: this.crypto.keyPackageFingerprint } }; }
  private replay: { id: string; sequence: number; projection: LiveProjection } | null = null;
  private readonly controller = new AbortController();
  private readonly consumer: TurnReceiptConsumer;
  private flight: Promise<void> | null = null;
  constructor(private readonly ports: { config: CloudBuildConfig; scope: SyncScope; deviceId: string; store: ChatSyncStore;
    transport: Pick<AccountTransport, "query" | "mutate">; bytes: ChatBodyBytePorts;
    current(): void; changed(): void }) {
    this.consumer = new TurnReceiptConsumer({ ...ports, crypto: () => this.crypto, signal: this.controller.signal });
  }
  flush() {
    if (this.controller.signal.aborted) return Promise.resolve(); if (this.flight) return this.flight;
    const flight = this.deliver(); this.flight = flight;
    void flight.finally(() => { if (this.flight === flight) this.flight = null; }).catch(() => {}); return flight;
  }
  private current() { this.controller.signal.throwIfAborted(); this.ports.current(); }
  private async deliver() {
    const items = await readTurnOutbox(this.ports.store, this.ports.scope), blocked = new Set<string>(), failures: unknown[] = [];
    const admissions = items.filter(item => item.kind === "live-turn").sort((a, b) => a.seq_or_revision - b.seq_or_revision || a.id.localeCompare(b.id));
    const nextById = new Map<string, ChatOutboxItem>(), following = new Map<string, ChatOutboxItem>();
    for (let index = admissions.length - 1; index >= 0; index--) {
      const item = admissions[index]!, chatId = JSON.parse(item.payload_json).chatId, next = following.get(chatId);
      if (next) nextById.set(item.id, next); following.set(chatId, item);
    }
    for (const item of admissions) {
      this.current(); const admission = localTurnAdmissionSchema.parse((await readOutboxSource(this.ports.store, this.ports.scope, item)).payload);
      if (blocked.has(admission.chat.id)) continue;
      const next = nextById.get(item.id);
      try { const settled = await this.deliverTurn(item, admission, next); if (!settled) blocked.add(admission.chat.id); }
      catch (error) { failures.push(error); blocked.add(admission.chat.id); }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, "TURN_PUBLICATION_FAILED");
  }
  private async body(item: ChatOutboxItem, admission: LocalTurnAdmission, message: NativeSnapshot["messages"][number], subagents: NativeSnapshot["subagents"] = {}) {
    const { store, scope, transport, bytes } = this.ports, signal = this.controller.signal, checkpoints = new ChatDeliveryCheckpoints(store, scope, item);
    const snapshot: NativeSnapshot = { chat: admission.chat, lifecycleKind: "native", archivedAt: null, nextSeq: admission.sequences.assistantSeq + 1,
      lastCommittedUserSeq: admission.sequences.userSeq, messages: [...admission.notices, admission.user, ...(message.role === "assistant" ? [message] : [])], subagents, branches: [] };
    let saved = await checkpoints.get(`body:${message.seq}`);
    const body = saved?.kind === "native-body" ? saved.body : await projectNativeBody(snapshot, message, bytes, this.header, item.id, signal, checkpoints.fileJournal());
    this.current();
    if (saved && saved.kind === "native-body" && saved.bodyHash !== hashChatContent(body)) throw new Error("TURN_BODY_SOURCE_CHANGED");
    if (!saved) {
      saved = await checkpoints.save({ kind: "native-body", bodyHash: hashChatContent(body), body });
    }
    if (saved.kind !== "native-body") throw new Error("TURN_BODY_CHECKPOINT_INVALID");
    if (saved.body.message.role !== "assistant") {
      let canonical = await checkpoints.get(`cipher-turn-body:${message.seq}`);
      if (!canonical && !await checkpoints.get("encrypted-turn-start")) {
        const projection = await transport.query("chats/body/reads:get", { ...this.header, chatId: admission.chat.id, messageId: message.id });
        this.current();
        if (projection) {
          if (projection.storage.kind !== "encrypted") throw new Error("TURN_CANONICAL_PREFIX_CHANGED");
          const opened = await readChatBody(projection, { id: admission.chat.id, incarnationId: admission.chat.incarnationId }, { crypto: () => this.crypto,
            readBlock: (chatId, bodyHash, blockId) => transport.query("chats/body/reads:block", { ...this.header, chatId, bodyHash, blockId }),
            readPrefixPage: (chatId, turnId, afterSeq, throughSeq) => transport.query("turns/reads:page", { ...this.header, chatId, turnId, afterSeq, throughSeq }) }, signal);
          this.current();
          if (!opened || !sameTurnBodySource(saved.body, opened, scope.userId)) throw new Error("TURN_CANONICAL_BODY_SOURCE_CHANGED");
          canonical = await checkpoints.save({ kind: "encrypted-turn-canonical-body", encryptedSpace: this.header.encryptedSpace,
            plaintextHash: saved.bodyHash, openedPlaintextHash: hashChatContent(opened), openedBody: opened, message: projection.storage.message });
        }
      }
      if (canonical) {
        if (canonical.kind !== "encrypted-turn-canonical-body" || canonical.plaintextHash !== saved.bodyHash) throw new Error("TURN_CANONICAL_BODY_CHECKPOINT_CHANGED");
        return { ...saved, ciphertextHash: canonical.message.bodyHash };
      }
    }
    this.current(); const cipher = await stageChatBody({ checkpoints, body: saved.body, bodyHash: saved.bodyHash, outboxId: item.id, bytes, header: this.header, transport, signal,
      identity: { chatId: admission.chat.id, incarnationId: admission.chat.incarnationId, executionEpoch: admission.executionEpoch } });
    return { ...saved, ciphertextHash: cipher.ciphertextHash };
  }
  private async evidence(admission: LocalTurnAdmission, items: ChatOutboxItem[]): Promise<ResultEvidence | null> {
    const { store, scope } = this.ports;
    let fallback: ResultEvidence | null = null;
    for (const item of items) {
      if (JSON.parse(item.payload_json).chatId !== admission.chat.id) continue;
      if (item.kind === "ledger-handoff" && item.entity_id === admission.turnId) {
        const { turnId, ...evidence } = (await readOutboxSource(store, scope, item)).payload as HandoffEvidence & { turnId: string };
        if (turnId !== admission.turnId) throw new Error("TURN_HANDOFF_IDENTITY_CONFLICT");
        const action = cloudActionSchema.parse({ type: "handoff-turn", chatId: admission.chat.id, turnId, executionEpoch: admission.executionEpoch, evidence });
        if (action.type !== "handoff-turn") throw new Error("TURN_HANDOFF_INVALID");
        if (!fallback || fallback.resultKind === "pending") fallback = action.evidence;
      } else if (item.entity_kind !== "turn") {
        const source = (await readOutboxSource(store, scope, item)).payload as { message?: unknown; messages?: unknown[]; subagents?: unknown };
        for (const raw of [source.message, ...(source.messages ?? [])].filter(Boolean)) {
          const message = messageSchema.parse(raw);
          if (message.id !== admission.assistantMessageId || message.seq !== admission.sequences.assistantSeq || message.role !== "assistant" ||
              message.turnId !== admission.turnId || !message.resultHash || !message.completion) continue;
          return { resultKind: "message", resultMessage: message, dispatch: "dispatched",
            terminal: message.completion === "complete" ? "done" : message.completionReason === "source-cancelled" ? "cancelled" : "error",
            subagents: subagentsSchema.parse(source.subagents ?? {}) };
        }
      }
    }
    return fallback;
  }
  private async start(item: ChatOutboxItem, admission: LocalTurnAdmission) {
    const checkpoints = new ChatDeliveryCheckpoints(this.ports.store, this.ports.scope, item), signal = this.controller.signal;
    const user = await this.body(item, admission, admission.user), notices = [];
    for (const notice of admission.notices) notices.push(await this.body(item, admission, notice));
    let saved = await checkpoints.get("turn-start");
    if (!saved) {
      const source = { chatId: admission.chat.id, incarnationId: admission.chat.incarnationId, turnId: admission.turnId,
        executorDeviceId: admission.executorDeviceId, executionEpoch: admission.executionEpoch, backend: admission.options.backend, options: admission.options,
        expectedAgentRevision: admission.expectedAgentRevision, planRequested: admission.planRequested, createdAt: admission.createdAt,
        userMessageId: admission.user.id, assistantMessageId: admission.assistantMessageId, ...admission.sequences,
        userBodyHash: user.bodyHash, noticeBodyHashes: notices.map(value => value.bodyHash) };
      saved = await checkpoints.save({ kind: "turn-start", start: turnStartSchema.parse({ ...source, identityHash: hashTurnIdentity(source) }) });
    }
    if (saved.kind !== "turn-start") throw new Error("TURN_START_CHECKPOINT_INVALID");
    let frozen = await checkpoints.get("encrypted-turn-start");
    if (!frozen) {
      const classification = admission.chat.classification;
      const optionsPacket = await sealChatPacket(this.crypto, admission.chat.id, { operationId: hashChatContent(["turn-options", item.id]), role: "options",
        metadata: { incarnationId: admission.chat.incarnationId, classification: { kind: classification.conversationKind, projectId: classification.projectId, appId: classification.appId },
          sourceDeviceId: admission.executorDeviceId, agent: saved.start.backend, agentRevision: saved.start.expectedAgentRevision + Number(saved.start.noticeSeq !== undefined),
          expectedRevision: admission.chat.cloudRevision, executionEpoch: admission.executionEpoch, archivedAt: null, references: [] } }, { options: saved.start.options }, signal);
      const start = await prepareTurnStart(saved.start, { userBodyHash: user.ciphertextHash, noticeBodyHashes: notices.map(value => value.ciphertextHash), optionsPacket }, this.crypto, signal);
      this.current(); frozen = await checkpoints.save({ kind: "encrypted-turn-start", encryptedSpace: this.header.encryptedSpace, plaintextHash: saved.start.identityHash, start });
    }
    if (frozen.kind !== "encrypted-turn-start" || frozen.plaintextHash !== saved.start.identityHash) throw new Error("TURN_CIPHER_START_CHANGED");
    return { local: saved.start, wire: validateTurnStart(this.crypto.scope, frozen.start) };
  }
  private async projection(item: ChatOutboxItem, start: TurnStart, through: number, checkpoints: ChatDeliveryCheckpoints) {
    if (!this.replay || this.replay.id !== item.id || this.replay.sequence > through) this.replay = { id: item.id, sequence: 0, projection: createLiveProjection(start.createdAt) };
    while (this.replay.sequence < through) {
      this.current(); const saved = await checkpoints.get(`turn-chunk:${this.replay.sequence + 1}`);
      if (!saved || saved.kind !== "turn-chunk" || saved.chunk.payloadHash !== hashTurnChunk(saved.chunk)) throw new Error("TURN_LOCAL_CHUNK_MISSING");
      this.replay.projection = reduceLiveProjection(this.replay.projection, saved.chunk.events); this.replay.sequence++;
      if (this.replay.sequence % REPLAY_STRIDE === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return this.replay.projection;
  }
  private async freezeFinal(checkpoints: ChatDeliveryCheckpoints, local: TurnFinal, start: Awaited<ReturnType<LiveTurnPublisher["start"]>>, ciphertextBodyHash?: string) {
    let frozen = await checkpoints.get("encrypted-turn-final");
    if (!frozen) {
      const previous = local.expectedHighSeq ? await checkpoints.get(`cipher-turn-chunk:${local.expectedHighSeq}`) : null;
      if (local.expectedHighSeq > 0 && (!previous || previous.kind !== "encrypted-turn-chunk")) throw new Error("TURN_CIPHER_CHUNK_MISSING");
      const priorHash = previous?.kind === "encrypted-turn-chunk" ? previous.chunk.packet.ciphertextHash : start.wire.identityHash;
      if (local.result.kind === "message" && !ciphertextBodyHash) {
        const body = await checkpoints.get(`message:${local.result.bodyHash}:complete`);
        if (!body || body.kind !== "encrypted-message-complete") throw new Error("TURN_CIPHER_BODY_MISSING"); ciphertextBodyHash = body.message.bodyHash;
      }
      const final = await prepareTurnFinal(local, cipherTurnIdentity(start.wire), local.result.kind === "message" ? { kind: "message", bodyHash: ciphertextBodyHash! } : { kind: "empty" }, priorHash, this.crypto, this.controller.signal);
      this.current(); frozen = await checkpoints.save({ kind: "encrypted-turn-final", encryptedSpace: this.header.encryptedSpace, plaintextHash: hashChatContent(local), final });
    }
    if (frozen.kind !== "encrypted-turn-final" || frozen.plaintextHash !== hashChatContent(local)) throw new Error("TURN_CIPHER_FINAL_CHANGED");
    return validateTurnFinal(this.crypto.scope, frozen.final);
  }
  private async deliverTurn(item: ChatOutboxItem, admission: LocalTurnAdmission, next?: ChatOutboxItem) {
    const { store, scope, transport } = this.ports, checkpoints = new ChatDeliveryCheckpoints(store, scope, item);
    const metadata = await store.read(scope, { type: "chat-metadata", chatId: admission.chat.id });
    if (metadata.type !== "chat-metadata" || !metadata.value.head) return false;
    let receipt = await transport.query("turns/reads:receipt", { ...this.header, chatId: admission.chat.id, turnId: admission.turnId }); this.current();
    if (receipt?.settlementState === "settled") { await this.finish(item, admission, receipt); return true; }
    if (receipt?.settlementState === "sealing") { await this.consumer.consume(receipt); return false; }
    if (!receipt) {
      const head = await transport.query("chats/body/reads:head", { ...this.header, chatId: admission.chat.id }); this.current();
      if (head.state !== "ready") return false;
    }
    const start = await this.start(item, admission);
    let final = await checkpoints.get("turn-final");
    if (final && final.kind !== "turn-final") throw new Error("TURN_FINAL_CHECKPOINT_INVALID");
    const evidence = final ? null : await this.evidence(admission, await readChatOutbox(store, scope, admission.chat.id));
    if (!receipt && !final && (evidence?.resultKind === "empty" || evidence?.resultKind === "pending" && evidence.dispatch === "not-started")) {
      const head = await transport.query("chats/body/reads:head", { ...this.header, chatId: admission.chat.id });
      if (head.headSeq >= admission.sequences.assistantSeq) {
        const original: TurnFinal = { ...cipherTurnIdentity(start.local), expectedHighSeq: 0, resultHash: hashChatContent(null), result: { kind: "empty" }, terminal: evidence.terminal ?? "cancelled" };
        final = await checkpoints.save({ kind: "turn-final", final: original });
        receipt = await transport.mutate("turns/adoption:empty", { ...this.header, turn: start.wire, final: await this.freezeFinal(checkpoints, original, start) });
        if (!receipt) throw new Error("TURN_INITIAL_ADOPTION_NOT_READY");
      }
    }
    if (!receipt) { this.current(); receipt = await transport.mutate("turns/api:start", { ...this.header, turn: start.wire }); }
    if (receipt.identityHash !== start.wire.identityHash) throw new Error("TURN_RECEIPT_IDENTITY_CONFLICT");
    if (receipt.settlementState === "settled") { await this.finish(item, admission, receipt); return true; }
    const identity = cipherTurnIdentity(start.wire);
    if (final && final.kind !== "turn-final") throw new Error("TURN_FINAL_CHECKPOINT_INVALID");
    let state = await transport.query("turns/reads:state", { ...this.header, chatId: start.local.chatId, turnId: start.local.turnId });
    if (!state || state.receipt.settlementState !== "open") return false;
    const local = await store.read(scope, { type: "turn-delivery", id: item.id }); if (local.type !== "turn-delivery") throw new Error("TURN_DELIVERY_UNAVAILABLE");
    const throughSeq = final ? final.final.expectedHighSeq : local.value.highSeq;
    if (state.chunkHighSeq > throughSeq) throw new Error("TURN_REMOTE_WATERMARK_CHANGED");
    for (let seq = state.chunkHighSeq + 1; seq <= throughSeq; seq++) {
      const chunk = await checkpoints.get(`turn-chunk:${seq}`); if (!chunk || chunk.kind !== "turn-chunk") throw new Error("TURN_LOCAL_CHUNK_MISSING");
      let frozen = await checkpoints.get(`cipher-turn-chunk:${seq}`);
      if (!frozen) {
        const prepared = await prepareTurnChunk(chunk.chunk, identity, state.lastCiphertextHash, await this.projection(item, start.local, seq - 1, checkpoints), this.crypto, this.controller.signal);
        this.current(); frozen = await checkpoints.save({ kind: "encrypted-turn-chunk", encryptedSpace: this.header.encryptedSpace, plaintextHash: chunk.chunk.payloadHash, chunk: prepared.chunk });
        this.replay = { id: item.id, sequence: seq, projection: prepared.projection };
      }
      if (frozen.kind !== "encrypted-turn-chunk" || frozen.plaintextHash !== chunk.chunk.payloadHash) throw new Error("TURN_CIPHER_CHUNK_CHANGED");
      const ciphertext = validateTurnChunk(this.crypto.scope, identity, frozen.chunk);
      this.current(); state = await transport.mutate("turns/api:append", { ...this.header, turn: identity, chunk: ciphertext });
    }
    if (!final && evidence?.resultKind === "pending" && evidence.dispatch !== "not-started") {
      if (!evidence.terminal && state.state !== "unknown") { this.current(); await transport.mutate("turns/api:unconfirmed", { ...this.header, turn: identity }); }
      if (next) {
        const successor = localTurnAdmissionSchema.parse((await readOutboxSource(store, scope, next)).payload);
        const replacement = await this.start(next, successor); this.current();
        receipt = await transport.mutate("turns/api:supersede", { ...this.header, turn: identity, replacement: replacement.wire });
        await this.consumer.consume(receipt); return receipt.settlementState === "settled";
      }
      return false;
    }
    if (!final) {
      if (!evidence) return false;
      const body = evidence.resultMessage ? await this.body(item, admission, evidence.resultMessage, evidence.subagents ?? {}) : null;
      final = await checkpoints.save({ kind: "turn-final", final: { ...cipherTurnIdentity(start.local), expectedHighSeq: state.chunkHighSeq,
        resultHash: body ? this.resultHash(body.body) : hashChatContent(null), result: body ? { kind: "message", bodyHash: body.bodyHash } : { kind: "empty" },
        terminal: evidence.terminal ?? "cancelled" } });
    }
    if (final.kind !== "turn-final") throw new Error("TURN_FINAL_CHECKPOINT_INVALID");
    if (final.final.result.kind === "message") {
      const saved = await checkpoints.get(`body:${admission.sequences.assistantSeq}`);
      if (!saved || saved.kind !== "native-body" || saved.bodyHash !== final.final.result.bodyHash) throw new Error("TURN_FINAL_BODY_SOURCE_CHANGED");
      await stageChatBody({ checkpoints, body: saved.body, bodyHash: saved.bodyHash, outboxId: item.id, bytes: this.ports.bytes,
        header: this.header, transport, signal: this.controller.signal, identity: { chatId: admission.chat.id, incarnationId: admission.chat.incarnationId, executionEpoch: admission.executionEpoch } });
    }
    this.current(); receipt = await transport.mutate("turns/api:finalize", { ...this.header, final: await this.freezeFinal(checkpoints, final.final, start) });
    await this.consumer.consume(receipt);
    if (receipt.settlementState !== "settled") return false;
    await this.finish(item, admission, receipt); return true;
  }
  private resultHash(body: ChatBody) { if (body.message.role !== "assistant" || !body.message.resultHash) throw new Error("TURN_RESULT_HASH_MISSING"); return body.message.resultHash; }
  private async finish(item: ChatOutboxItem, admission: LocalTurnAdmission, receipt: EncryptedTurnReceipt) {
    if (item.entity_id !== admission.turnId || receipt.turnId !== admission.turnId) throw new Error("TURN_RECEIPT_IDENTITY_CHANGED");
    await this.consumer.consume(receipt); this.current(); if (this.replay?.id === item.id) this.replay = null;
  }
  async close() { this.replay = null; this.controller.abort(new Error("TURN_PUBLISHER_CLOSED")); await this.flight?.catch(() => {}); }
}
