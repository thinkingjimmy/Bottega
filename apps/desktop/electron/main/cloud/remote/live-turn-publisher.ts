/**
 * [INPUT]: Depends on approved account scope, original SQLite outboxes, verified bodies and formal turn RPCs.
 * [OUTPUT]: Publishes frozen ciphertext in bounded ordered batches across four independent Chat lanes, reuses successful final-body staging only within its current invocation, preserves recovery staging and final watermarks, and seals replaced unknown turns against the next durable admission; wakes rescan idle lanes while other Chats remain in flight, with bounded retries and a paced follow-up.
 * [POS]: Main synchronization publisher; it never starts or stops Agents and never renews an execution lease.
 */
import { recoveryDiagnostics } from "../runtime/diagnostics/timeline";
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { hashChatContent, type ChatBody } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { readChatBody } from "@ai-chat/cloud-protocol/chats/transcript/reader";
import { sameTurnBodySource } from "@ai-chat/cloud-protocol/turns/encrypted/journal";
import { turnStartSchema, hashTurnIdentity } from "@ai-chat/cloud-protocol/turns/model";
import { TURN_APPEND_BATCH_BYTES, TURN_APPEND_BATCH_CHUNKS } from "@ai-chat/cloud-protocol/turns/functions";
import type { EncryptedTurnChunk, EncryptedTurnReceipt } from "@ai-chat/cloud-protocol/turns/encrypted/model";
import { prepareTurnStart, prepareTurnChunk, prepareTurnFinal } from "@ai-chat/cloud-protocol/turns/encrypted/client";
import { cipherTurnIdentity, validateTurnStart, validateTurnChunk, validateTurnFinal } from "@ai-chat/cloud-protocol/turns/encrypted/wire";
import { sealChatPacket } from "@ai-chat/cloud-protocol/chats/encrypted/client";
import { createLiveProjection, reduceLiveProjection } from "@ai-chat/cloud-protocol/turns/projection";
import { hashTurnChunk, type LiveProjection } from "@ai-chat/cloud-protocol/turns/live";
import type { TurnStart, TurnFinal } from "@ai-chat/cloud-protocol/turns/model";
import type { SyncScope } from "../../../../shared/local-storage/contracts";
import { localTurnAdmissionSchema, type LocalTurnAdmission } from "../../chats/sqlite/cloud/delivery/turns/model";
import { cloudActionSchema } from "../../chats/sqlite/cloud/protocol";
import type { AccountTransport } from "../runtime/transport/transport";
import { ChatDeliveryCheckpoints } from "../sync/chats/checkpoints";
import { projectNativeBody, type ChatBodyBytePorts } from "../sync/chats/bodies";
import { stageChatBody } from "../sync/chats/body-publisher";
import { chatIdOf, readOutboxSource, type ChatSyncStore, type ChatOutboxItem, type NativeSnapshot } from "../sync/chats/sources";
import { TurnReceiptConsumer } from "../sync/turn-receipt-consumer";
import { readChatOutbox, readTurnOutbox, type HandoffEvidence } from "./sources";
import { messageSchema, subagentsSchema } from "../../chats/schema/chat-schema";
type ResultEvidence = Pick<HandoffEvidence, "resultKind" | "resultMessage" | "dispatch" | "terminal" | "subagents">;
// One macrotask hop per 64 chunks keeps the main process responsive without turning a long replay into hundreds of event-loop turns.
const REPLAY_STRIDE = 64;
/* Each Chat gets four attempts without progress per drain. A final wake carries to a paced next drain. */
const FLUSH_ROUNDS = 4;
const CHAT_LANES = 4;
type ReplayLane = { value: { id: string; sequence: number; projection: LiveProjection } | null; progressed: boolean };
export class LiveTurnPublisher {
  private get crypto() { return this.ports.bytes.files.crypto; }
  private get header() { return { ...protocolHeader(this.ports.config), expectedUserId: this.ports.scope.userId,
    encryptedSpace: { scope: this.crypto.scope, keyPackageFingerprint: this.crypto.keyPackageFingerprint } }; }
  private readonly lanes: ReplayLane[] = Array.from({ length: CHAT_LANES }, () => ({ value: null, progressed: false }));
  private readonly controller = new AbortController();
  private readonly consumer: TurnReceiptConsumer;
  private flight: Promise<void> | null = null;
  private scanFlight: Promise<void> | null = null;
  private scanRequested = false;
  private readonly active = new Map<string, { flight: Promise<void>; lane: ReplayLane }>();
  private readonly queued = new Map<string, ChatOutboxItem[]>();
  private readonly dirty = new Set<string>();
  private readonly attempts = new Map<string, number>();
  private failures: unknown[] = [];
  private deferred = false;
  private continuation: ReturnType<typeof setTimeout> | null = null;
  private completion: { resolve(): void; reject(error: unknown): void } | null = null;
  constructor(private readonly ports: { config: CloudBuildConfig; scope: SyncScope; deviceId: string; store: ChatSyncStore;
    transport: Pick<AccountTransport, "query" | "mutate">; bytes: ChatBodyBytePorts;
    current(): void; changed(): void }) {
    this.consumer = new TurnReceiptConsumer({ ...ports, crypto: () => this.crypto, signal: this.controller.signal });
  }
  flush() {
    if (this.controller.signal.aborted) return Promise.resolve();
    if (this.continuation) clearTimeout(this.continuation); this.continuation = null;
    if (this.flight) {
      // A durable capture wake can contain new chunks for a Chat whose unchanged scans hit the bound.
      this.attempts.clear(); this.deferred = false; this.requestScan(); return this.flight;
    }
    this.failures = []; this.attempts.clear(); this.deferred = false;
    const flight = new Promise<void>((resolve, reject) => { this.completion = { resolve, reject }; });
    this.flight = flight; this.requestScan(); return flight;
  }
  private failed(error: unknown) { if (this.failures.length < 64) this.failures.push(error); }
  private current() { this.controller.signal.throwIfAborted(); this.ports.current(); }
  private requestScan() {
    if (this.controller.signal.aborted) return;
    if (this.scanFlight) { this.scanRequested = true; return; }
    this.scanRequested = false;
    const scan = Promise.resolve().then(() => this.scan()).catch(error => { this.failed(error); }).finally(() => {
      if (this.scanFlight === scan) this.scanFlight = null;
      if (this.scanRequested && !this.controller.signal.aborted) this.requestScan();
      this.drain(); this.complete();
    });
    this.scanFlight = scan;
  }
  private async scan() {
    const items = await readTurnOutbox(this.ports.store, this.ports.scope), blocked = new Set<string>();
    this.current();
    const admissions = items.filter(item => item.kind === "live-turn").sort((a, b) => a.seq_or_revision - b.seq_or_revision || a.id.localeCompare(b.id));
    const chats = new Map<string, ChatOutboxItem[]>();
    for (const item of admissions) {
      let chatId: string;
      try { chatId = chatIdOf(item); }
      catch (error) {
        // Retained ownership is independent of the damaged envelope. It only closes this Chat's publication gate.
        const owner = await this.ports.store.read(this.ports.scope, { type: "outbox-chat", id: item.id }); this.current();
        if (owner.type !== "outbox-chat" || !owner.value) throw new Error("OUTBOX_CHAT_IDENTITY_UNAVAILABLE");
        this.failed(error); blocked.add(owner.value); continue;
      }
      const queue = chats.get(chatId) ?? []; queue.push(item); chats.set(chatId, queue);
    }
    this.current();
    for (const chatId of this.queued.keys()) if (!chats.has(chatId) || blocked.has(chatId)) this.queued.delete(chatId);
    for (const [chatId, queue] of chats) {
      if (blocked.has(chatId)) continue;
      if (this.active.has(chatId)) { this.queued.delete(chatId); this.dirty.add(chatId); continue; }
      if ((this.attempts.get(chatId) ?? 0) >= FLUSH_ROUNDS) { this.queued.delete(chatId); this.deferred = true; continue; }
      // Updating an existing Map entry keeps waiters ahead of Chats that just released a lane.
      this.queued.set(chatId, queue);
    }
  }
  private drain() {
    if (this.controller.signal.aborted) { this.queued.clear(); this.dirty.clear(); return; }
    for (const lane of this.lanes) {
      if (!this.queued.size) break;
      if ([...this.active.values()].some(work => work.lane === lane)) continue;
      const [chatId, queue] = this.queued.entries().next().value!; this.queued.delete(chatId);
      this.attempts.set(chatId, (this.attempts.get(chatId) ?? 0) + 1);
      lane.progressed = false;
      const flight = Promise.resolve().then(() => this.deliverChat(chatId, queue, lane)).catch(error => { this.failed(error); }).finally(() => {
        this.active.delete(chatId);
        if (lane.progressed) this.attempts.delete(chatId);
        if (this.dirty.delete(chatId)) {
          if ((this.attempts.get(chatId) ?? 0) < FLUSH_ROUNDS) this.requestScan();
          else this.deferred = true;
        }
        this.drain(); this.complete();
      });
      this.active.set(chatId, { flight, lane });
    }
  }
  private async deliverChat(chatId: string, queue: ChatOutboxItem[], lane: ReplayLane) {
    for (const [index, item] of queue.entries()) {
      this.current();
      try {
        const source = await readOutboxSource(this.ports.store, this.ports.scope, item);
        const admission = localTurnAdmissionSchema.parse(source.payload);
        if (admission.chat.id !== chatId || source.chatId !== chatId) throw new Error("TURN_SOURCE_IDENTITY_CHANGED");
        if (!await this.deliverTurn(item, admission, lane, queue[index + 1])) break;
      } catch (error) { this.current(); recoveryDiagnostics.record({ stage: "settlement", code: "failed", objectId: item.entity_id }); this.failed(error); break; }
    }
  }
  private complete() {
    if (!this.completion || this.scanFlight || this.active.size || this.queued.size) return;
    const completion = this.completion; this.completion = null; this.flight = null;
    if (this.failures.length === 1) completion.reject(this.failures[0]);
    else if (this.failures.length) completion.reject(new AggregateError(this.failures, "TURN_PUBLICATION_FAILED"));
    else completion.resolve();
    if (this.deferred && !this.controller.signal.aborted) {
      this.continuation = setTimeout(() => { this.continuation = null; void this.flush().catch(() => {}); }, 200);
      this.continuation.unref();
    }
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
    recoveryDiagnostics.record({ stage: "body", code: "started", objectId: admission.turnId });
    this.current(); const cipher = await stageChatBody({ checkpoints, body: saved.body, bodyHash: saved.bodyHash, outboxId: item.id, bytes, header: this.header, transport, signal,
      identity: { chatId: admission.chat.id, incarnationId: admission.chat.incarnationId } });
    recoveryDiagnostics.record({ stage: "body", code: "ready", objectId: admission.turnId });
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
        const action = cloudActionSchema.parse({ type: "handoff-turn", chatId: admission.chat.id, turnId, evidence });
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
        ownerDeviceId: admission.ownerDeviceId, backend: admission.options.backend, options: admission.options,
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
          sourceDeviceId: admission.ownerDeviceId, agent: saved.start.backend, agentRevision: saved.start.expectedAgentRevision + Number(saved.start.noticeSeq !== undefined),
          expectedRevision: admission.chat.cloudRevision, archivedAt: null, references: [] } }, { options: saved.start.options }, signal);
      const start = await prepareTurnStart(saved.start, { userBodyHash: user.ciphertextHash, noticeBodyHashes: notices.map(value => value.ciphertextHash), optionsPacket }, this.crypto, signal);
      this.current(); frozen = await checkpoints.save({ kind: "encrypted-turn-start", encryptedSpace: this.header.encryptedSpace, plaintextHash: saved.start.identityHash, start });
    }
    if (frozen.kind !== "encrypted-turn-start" || frozen.plaintextHash !== saved.start.identityHash) throw new Error("TURN_CIPHER_START_CHANGED");
    return { local: saved.start, wire: validateTurnStart(this.crypto.scope, frozen.start) };
  }
  private async projection(item: ChatOutboxItem, start: TurnStart, through: number, checkpoints: ChatDeliveryCheckpoints, lane: ReplayLane) {
    if (!lane.value || lane.value.id !== item.id || lane.value.sequence > through) lane.value = { id: item.id, sequence: 0, projection: createLiveProjection(start.createdAt) };
    const replay = lane.value;
    while (replay.sequence < through) {
      this.current(); const saved = await checkpoints.get(`turn-chunk:${replay.sequence + 1}`);
      if (!saved || saved.kind !== "turn-chunk" || saved.chunk.payloadHash !== hashTurnChunk(saved.chunk)) throw new Error("TURN_LOCAL_CHUNK_MISSING");
      replay.projection = reduceLiveProjection(replay.projection, saved.chunk.events); replay.sequence++;
      if (replay.sequence % REPLAY_STRIDE === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return replay.projection;
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
  private async deliverTurn(item: ChatOutboxItem, admission: LocalTurnAdmission, lane: ReplayLane, next?: ChatOutboxItem) {
    const { store, scope, transport } = this.ports, checkpoints = new ChatDeliveryCheckpoints(store, scope, item);
    const metadata = await store.read(scope, { type: "chat-metadata", chatId: admission.chat.id });
    if (metadata.type !== "chat-metadata" || !metadata.value.head) return false;
    let receipt = await transport.query("turns/reads:receipt", { ...this.header, chatId: admission.chat.id, turnId: admission.turnId }); this.current();
    if (receipt?.settlementState === "settled") return this.finish(item, admission, receipt, lane);
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
    if (receipt.settlementState === "settled") return this.finish(item, admission, receipt, lane);
    const identity = cipherTurnIdentity(start.wire);
    if (final && final.kind !== "turn-final") throw new Error("TURN_FINAL_CHECKPOINT_INVALID");
    let state = await transport.query("turns/reads:state", { ...this.header, chatId: start.local.chatId, turnId: start.local.turnId });
    if (!state || state.receipt.settlementState !== "open") return false;
    const local = await store.read(scope, { type: "turn-delivery", id: item.id }); if (local.type !== "turn-delivery") throw new Error("TURN_DELIVERY_UNAVAILABLE");
    const throughSeq = final ? final.final.expectedHighSeq : local.value.highSeq;
    if (state.chunkHighSeq > throughSeq) throw new Error("TURN_REMOTE_WATERMARK_CHANGED");
    for (let seq = state.chunkHighSeq + 1; seq <= throughSeq;) {
      const chunks: EncryptedTurnChunk[] = [];
      let previousHash = state.lastCiphertextHash;
      // Drain only the durable prefix already available; never wait to fill a batch.
      for (; seq <= throughSeq && chunks.length < TURN_APPEND_BATCH_CHUNKS; seq++) {
        this.current();
        const chunk = await checkpoints.get(`turn-chunk:${seq}`); if (!chunk || chunk.kind !== "turn-chunk") throw new Error("TURN_LOCAL_CHUNK_MISSING");
        let frozen = await checkpoints.get(`cipher-turn-chunk:${seq}`);
        if (!frozen) {
          const prepared = await prepareTurnChunk(chunk.chunk, identity, previousHash, await this.projection(item, start.local, seq - 1, checkpoints, lane), this.crypto, this.controller.signal);
          this.current(); frozen = await checkpoints.save({ kind: "encrypted-turn-chunk", encryptedSpace: this.header.encryptedSpace, plaintextHash: chunk.chunk.payloadHash, chunk: prepared.chunk });
          lane.value = { id: item.id, sequence: seq, projection: prepared.projection };
        }
        if (frozen.kind !== "encrypted-turn-chunk" || frozen.plaintextHash !== chunk.chunk.payloadHash) throw new Error("TURN_CIPHER_CHUNK_CHANGED");
        const ciphertext = validateTurnChunk(this.crypto.scope, identity, frozen.chunk);
        if (chunks.length && Buffer.byteLength(JSON.stringify([...chunks, ciphertext])) > TURN_APPEND_BATCH_BYTES) break;
        chunks.push(ciphertext); previousHash = ciphertext.packet.ciphertextHash;
      }
      this.current(); state = await transport.mutate("turns/api:appendBatch", { ...this.header, turn: identity, chunks });
      lane.progressed = true;
      recoveryDiagnostics.record({ stage: "chunks", code: "progress", objectId: admission.turnId, progress: state.chunkHighSeq });
    }
    if (!final && evidence?.resultKind === "pending" && evidence.dispatch !== "not-started") {
      if (!evidence.terminal && state.state !== "unknown") { this.current(); await transport.mutate("turns/api:unconfirmed", { ...this.header, turn: identity }); }
      if (next) {
        const successor = localTurnAdmissionSchema.parse((await readOutboxSource(store, scope, next)).payload);
        const replacement = await this.start(next, successor); this.current();
        receipt = await transport.mutate("turns/api:supersede", { ...this.header, turn: identity, replacement: replacement.wire });
        if (receipt.settlementState === "settled") return this.finish(item, admission, receipt, lane);
        await this.consumer.consume(receipt); return false;
      }
      return false;
    }
    let stagedBody: { bodyHash: string; ciphertextHash: string } | null = null;
    if (!final) {
      if (!evidence) return false;
      const body = evidence.resultMessage ? await this.body(item, admission, evidence.resultMessage, evidence.subagents ?? {}) : null;
      if (body) stagedBody = { bodyHash: body.bodyHash, ciphertextHash: body.ciphertextHash };
      final = await checkpoints.save({ kind: "turn-final", final: { ...cipherTurnIdentity(start.local), expectedHighSeq: state.chunkHighSeq,
        resultHash: body ? this.resultHash(body.body) : hashChatContent(null), result: body ? { kind: "message", bodyHash: body.bodyHash } : { kind: "empty" },
        terminal: evidence.terminal ?? "cancelled" } });
    }
    if (final.kind !== "turn-final") throw new Error("TURN_FINAL_CHECKPOINT_INVALID");
    if (final.final.result.kind === "message") {
      const saved = await checkpoints.get(`body:${admission.sequences.assistantSeq}`);
      if (!saved || saved.kind !== "native-body" || saved.bodyHash !== final.final.result.bodyHash) throw new Error("TURN_FINAL_BODY_SOURCE_CHANGED");
      if (hashChatContent(saved.body) !== saved.bodyHash) throw new Error("CHAT_BODY_SOURCE_CHANGED");
      // Only this invocation's successful stage replaces recovery's status/restage round trips.
      if (stagedBody?.bodyHash !== saved.bodyHash) await stageChatBody({ checkpoints, body: saved.body, bodyHash: saved.bodyHash, outboxId: item.id, bytes: this.ports.bytes,
        header: this.header, transport, signal: this.controller.signal, identity: { chatId: admission.chat.id, incarnationId: admission.chat.incarnationId } });
    }
    this.current(); receipt = await transport.mutate("turns/api:finalize", { ...this.header, final: await this.freezeFinal(checkpoints, final.final, start, stagedBody?.ciphertextHash) });
    if (receipt.settlementState === "settled") return this.finish(item, admission, receipt, lane);
    await this.consumer.consume(receipt); return false;
  }
  private resultHash(body: ChatBody) { if (body.message.role !== "assistant" || !body.message.resultHash) throw new Error("TURN_RESULT_HASH_MISSING"); return body.message.resultHash; }
  private async finish(item: ChatOutboxItem, admission: LocalTurnAdmission, receipt: EncryptedTurnReceipt, lane: ReplayLane) {
    if (item.entity_id !== admission.turnId || receipt.turnId !== admission.turnId) throw new Error("TURN_RECEIPT_IDENTITY_CHANGED");
    const installed = await this.consumer.consume(receipt); this.current();
    if (!installed) return false;
    lane.progressed = true; recoveryDiagnostics.record({ stage: "settlement", code: "ready", objectId: admission.turnId }); if (lane.value?.id === item.id) lane.value = null;
    return true;
  }
  async close() {
    this.controller.abort(new Error("TURN_PUBLISHER_CLOSED"));
    if (this.continuation) clearTimeout(this.continuation); this.continuation = null;
    this.queued.clear(); this.dirty.clear(); this.scanRequested = false;
    await this.flight?.catch(() => {}); for (const lane of this.lanes) lane.value = null;
  }
}
