/**
 * [INPUT]: Canonical Chat identities/messages, plugin admission, immutable custody/outbox and injected document retention/Fork ports.
 * [OUTPUT]: Verified fence metadata without snapshot reads, authorized snapshots, persisted-child-aware same-reference capture recovery, separate settlement receipts, Fork intents and Chat retention.
 * [POS]: Main artifact domain authority; renderer references never become filesystem paths.
 */
import { TurnSettlementJournal } from "../storage/settlements";
import { ArtifactRecovery } from "../storage/recovery";
import { ArtifactForkIntents } from "./forks/intent";
import { basename, join, resolve as resolvePath } from "node:path";
import { readdir, realpath } from "node:fs/promises";
import { codexHomePath } from "../../providers/codex/environment";
import { ArtifactFailure, artifactFailure } from "../storage/failure";
import { readArtifactFences, type ArtifactReference, type ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { ChatMessage, ChatRecord } from "../../../../shared/ipc/content/chats-ipc";
import { artifactRefSchema, type ArtifactRef } from "../../../../shared/ipc/apps/artifact-ipc";
import type { BridgeEntry, AgentContext } from "../../agent/bridge/bridge-types";
import type { ChatStore } from "../../chats/chat-store";
import { ensureDurableDirectory } from "../../persistence/durable-json";
import { admitArtifact, type ArtifactRoots } from "../admission/files";
import { SnapshotCustody, type ArtifactRecord } from "../storage/snapshot-custody";
import { ArtifactPublisher } from "../storage/publish";
import { ArtifactGateway } from "../render/gateway-route";
import { ArtifactProjection } from "../discovery/projection";
import { artifactEnabled, artifactGeneration, assertArtifactGeneration } from "../admission/state";
export function messageArtifactFences(message: ChatMessage, subagents?: ChatRecord["subagents"]): ArtifactFence[] {
  const texts = [message.content];
  const seen = new Set<string>();
  const visit = (parts: NonNullable<Extract<ChatMessage, { role: "assistant" }>["parts"]>) => {
    for (const part of parts) {
      if (part.type === "text") texts.push(part.text);
      if (part.type === "subagent" && !seen.has(part.agentThreadId)) { seen.add(part.agentThreadId); visit(subagents?.[part.agentThreadId]?.parts ?? []); }
    }
  };
  if (message.role === "assistant") visit(message.parts ?? []);
  return [...new Map(texts.flatMap(readArtifactFences).map(fence => [fence.id, fence])).values()];
}
export class ArtifactService {
  private readonly designRetention: ((chatId: string, incarnationId: string) => Promise<void>)[] = [];
  configureDesignRetention(release: (chatId: string, incarnationId: string) => Promise<void>) { this.designRetention.push(release); }
  private designFork: ((sourceChatId: string, sourceIncarnationId: string, child: ChatRecord, artifactIds: string[]) => Promise<void>) | undefined;
  configureDesignFork(fork: NonNullable<ArtifactService["designFork"]>) { this.designFork = fork; }
  private designDelivery: ((chatId: string, incarnationId: string, path: string) => ArtifactFence | undefined) | undefined;
  deliveredDesign(chatId: string, incarnationId: string, path: string) { return this.designDelivery?.(chatId, incarnationId, path); }
  configureDesignDelivery(resolve: NonNullable<ArtifactService["designDelivery"]>) { this.designDelivery = resolve; }
  remote: import("../access/remote").RemoteArtifacts | null = null;
  readonly settlements: TurnSettlementJournal;
  readonly recovery: ArtifactRecovery;
  private readonly recoveryControllers = new Set<AbortController>();
  private readonly recoveryFlights = new Map<string, Promise<ArtifactFence>>();
  readonly forks: ArtifactForkIntents;
  readonly custody: SnapshotCustody;
  readonly publisher: ArtifactPublisher;
  readonly gateway: ArtifactGateway;
  private readonly active = new Set<string>();
  private readonly acquisitions = new Map<string, Promise<void>>();
  private readonly sessionRoots = new Map<string, string | null>();
  constructor(readonly root: string, private readonly chats: ChatStore, libraryRoot: () => string | null) {
    this.settlements = new TurnSettlementJournal(root); this.recovery = new ArtifactRecovery(root); this.forks = new ArtifactForkIntents(root);
    this.custody = new SnapshotCustody(root, libraryRoot); this.publisher = new ArtifactPublisher(root); this.gateway = new ArtifactGateway(this);
  }
  async initialize() {
    await this.settlements.initialize(); await this.recovery.initialize(); await this.forks.initialize(); await this.custody.initialize(); await this.publisher.initialize();
  }
  /* Reconciliation only prunes custody the first frame never reads, so startup runs it
     after the window instead of paying for every retained chat before painting. */
  async reconcileAll() {
    for (const chatId of new Set(this.custody.records().map(record => record.ref.chatId))) await this.reconcileChat(chatId);
  }
  async directory(chatId: string) {
    const home = this.chats.getHomeDir(chatId);
    if (!home) throw new Error("artifact-home-unavailable");
    const directory = join(await realpath(home), "artifacts");
    await ensureDurableDirectory(directory); return directory;
  }
  begin(entry: BridgeEntry, context: AgentContext) {
    const incarnationId = this.chats.getIncarnationId(entry.conversationId);
    if (!incarnationId) return undefined;
    const home = this.chats.getHomeDir(entry.conversationId);
    if (!home) return undefined;
    const roots: ArtifactRoots = { workspace: context.workspace, artifacts: join(home, "artifacts") };
    const ref = (artifactId: string): ArtifactRef => ({ chatId: entry.conversationId, incarnationId, artifactId });
    this.active.add(entry.messageId);
    const admitted = new Set<string>(), generation = artifactGeneration();
    const createProjection = (requestId: string) => new ArtifactProjection({ roots, requestId,
      admissionOpen: () => artifactEnabled() && generation === artifactGeneration(),
      deliveredDesign: reference => this.designDelivery?.(entry.conversationId, incarnationId, resolvePath(roots.workspace, reference.path)),
      snapshot: async (reference, id, signal) => {
        const check = () => { signal?.throwIfAborted(); assertArtifactGeneration(generation); this.assert(ref(id)); };
        check();
        if (!admitted.has(id)) { if (admitted.size >= 8) throw new ArtifactFailure("budget", "admission"); admitted.add(id); }
        let stage = "retain", retained = false;
        try {
          await this.recovery.prepare({ ref: ref(id), roots: { ...roots }, reference, generation, messageId: entry.messageId });
          stage = "admission";
          const snapshot = await this.captured(ref(id), roots, reference);
          check(); stage = "retain";
          await this.custody.retain({ ref: ref(id), fence: snapshot.fence, messageId: entry.messageId, committed: false }, snapshot.data);
          retained = true; check(); stage = "enqueue";
          await this.publisher.enqueue(ref(id), snapshot.fence);
          check(); await this.recovery.complete(ref(id), snapshot.fence); check(); return snapshot.fence;
        } catch (cause) {
          if (retained) { try { check(); } catch { await this.cancelCapture(ref(id)); } }
          throw artifactFailure(cause, stage);
        }
      }, release: id => this.cancelCapture(ref(id)),
    });
    const projection = createProjection(entry.requestId), children = new Map<string, ArtifactProjection>();
    const child = (id: string) => { let value = children.get(id); if (!value) { value = createProjection(entry.requestId + "-child-" + id); children.set(id, value); } return value; };
    const bindSession = async (id: string) => {
      if (entry.backend !== "codex" || !/^[a-f0-9-]{36}$/i.test(id)) return;
      roots.sessionId = id;
      const cached = this.sessionRoots.get(id);
      if (cached !== undefined) { if (cached) roots.session = cached; return; }
      const root = join(codexHomePath(), "visualizations");
      // Newest first: the session being bound was almost always created today.
      const descend = async (directory: string, pattern: RegExp) => (await readdir(directory).catch(() => [])).filter(name => pattern.test(name)).sort().reverse();
      for (const year of await descend(root, /^\d{4}$/)) {
        for (const month of await descend(join(root, year), /^\d{2}$/)) {
          for (const day of await descend(join(root, year, month), /^\d{2}$/)) {
            const path = join(root, year, month, day, id);
            if (await realpath(path).catch(() => null) === path) { this.sessionRoots.set(id, path); roots.session = path; return; }
          }
        }
      }
      this.sessionRoots.set(id, null);
    };
    return { projection, bindSession, child, children };
  }
  ownsChat(ref: ArtifactRef) { return !this.custody.lookup(ref)?.remote && this.chats.getIncarnationId(ref.chatId) === ref.incarnationId; }
  assert(ref: ArtifactRef) {
    artifactRefSchema.parse(ref);
    if (this.custody.lookup(ref)?.remote || this.chats.getIncarnationId(ref.chatId) !== ref.incarnationId) {
      if (!this.remote) throw new Error("artifact-stale-chat"); this.remote.assert(ref);
    }
  }
  /** Journal-owned delivery replays the same reference and bytes after a lost response. */
  async retainDocument(ref: ArtifactRef, fence: ArtifactFence, messageId: string, data: Uint8Array) {
    this.assert(ref);
    await this.custody.retain({ ref, fence, messageId, committed: true }, data);
    await this.publisher.enqueue(ref, fence);
  }
  /** An export keeps its frozen parent's authority and the existing custody/outbox lifetime. */
  async retainExport(parent: ArtifactRef, fence: ArtifactFence, data: Uint8Array) {
    const source = await this.resolve(parent);
    if (!source.record.fence.design || source.record.derivedFrom) throw new Error("artifact-export-parent");
    const ref = { ...parent, artifactId: fence.id };
    await this.custody.retain({ ref, fence, messageId: source.record.messageId, committed: true,
      derivedFrom: { artifactId: parent.artifactId, sha256: source.record.fence.sha256! } }, data);
    await this.publisher.enqueue(ref, fence);
    await this.resolve(parent); return fence;
  }
  async validate(ref: ArtifactRef) {
    const record = this.custody.lookup(ref);
    if (record?.remote || this.chats.getIncarnationId(ref.chatId) !== ref.incarnationId) {
      if (!this.remote) throw new Error("artifact-unavailable");
      await this.remote.validate(ref);
      if (record?.remote && record.remote !== this.remote.key()) throw new Error("artifact-account-changed");
    }
    this.assert(ref);
  }
  async metadata(ref: ArtifactRef): Promise<ArtifactRecord> {
    await this.validate(ref);
    let record = this.custody.lookup(ref);
    const remoteKey = this.ownsChat(ref) ? undefined : this.remote!.key();
    if (record) {
      if (record.derivedFrom) {
        const parentRef = { ...ref, artifactId: record.derivedFrom.artifactId };
        if (this.custody.lookup(parentRef)?.derivedFrom) throw new Error("artifact-export-parent");
        const parent = await this.metadata(parentRef);
        if (parent.derivedFrom || parent.fence.sha256 !== record.derivedFrom.sha256) throw new Error("artifact-unavailable");
      } else if (record.remote) {
        const current = await this.remote?.resolve(ref);
        if (current?.fence.sha256 !== record.fence.sha256) throw new Error("artifact-unavailable");
      } else if (!this.active.has(record.messageId)) {
        const message = await this.chats.getNativeMessage(ref.chatId, { kind: "id", messageId: record.messageId });
        if (!message || !messageArtifactFences(message, (await this.saved(ref.chatId)).subagents).some(fence => fence.id === ref.artifactId && (fence.sha256 === record!.fence.sha256 || Boolean(fence.rejected) && this.recovery.read(ref)?.fence?.sha256 === record!.fence.sha256))) throw new Error("artifact-unavailable");
      }
    } else {
      const { messages, subagents } = this.ownsChat(ref) ? await this.saved(ref.chatId) : { messages: [], subagents: undefined };
      const localCandidate = messages.flatMap(message => messageArtifactFences(message, subagents).map(fence => ({ message,
        fence: fence.rejected ? this.recovery.read({ ...ref, artifactId: fence.id })?.fence ?? fence : fence })))
        .find(value => value.fence.id === ref.artifactId && value.fence.sha256);
      const remoteCandidate = !localCandidate && remoteKey ? await this.remote?.resolve(ref) : null;
      const candidate = localCandidate ? { fence: localCandidate.fence, messageId: localCandidate.message.id } : remoteCandidate;
      if (!candidate) throw new Error("artifact-unavailable");
      record = { ref, fence: candidate.fence, messageId: candidate.messageId, committed: true, ...(remoteCandidate ? { remote: remoteKey } : {}) };
    }
    this.assert(ref);
    if (remoteKey && remoteKey !== this.remote?.key()) throw new Error("artifact-account-changed");
    return record;
  }
  async resolve(ref: ArtifactRef) {
    const metadata = await this.metadata(ref);
    if (metadata.derivedFrom) {
      const parent = await this.resolve({ ...ref, artifactId: metadata.derivedFrom.artifactId });
      if (parent.record.derivedFrom || parent.record.fence.sha256 !== metadata.derivedFrom.sha256) throw new Error("artifact-unavailable");
    }
    if (!this.custody.lookup(ref)) {
      const key = JSON.stringify(ref);
      let flight = this.acquisitions.get(key);
      if (!flight) {
        flight = (async () => {
          try { await this.custody.retain(metadata); return; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          const data = await this.publisher.download(ref, metadata.fence, AbortSignal.timeout(60_000));
          this.assert(ref);
          if (metadata.remote && metadata.remote !== this.remote?.key()) throw new Error("artifact-account-changed");
          await this.custody.retain(metadata, data);
        })().finally(() => this.acquisitions.delete(key));
        this.acquisitions.set(key, flight);
      }
      await flight;
    }
    await this.validate(ref);
    const record = this.custody.lookup(ref);
    if (!record) throw new Error("artifact-unavailable");
    try { return await this.custody.read(ref); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const data = await this.publisher.download(ref, record.fence, AbortSignal.timeout(60_000));
      this.assert(ref); await this.custody.retain(record, data);
      return this.custody.read(ref);
    }
  }
  private async saved(chatId: string) {
    if (this.chats.library) return this.chats.library.transcript(chatId);
    return { messages: await this.chats.getNativeMessages(chatId).catch(() => null) ?? [],
      subagents: await this.chats.getNativeSubagents(chatId).catch(() => null) ?? undefined };
  }
  async settled(entry: BridgeEntry, stored: boolean) {
    this.active.delete(entry.messageId);
    if (!stored) {
      for (const record of this.custody.records()) if (record.ref.chatId === entry.conversationId && record.messageId === entry.messageId) await this.release(record.ref);
      return;
    }
    await this.reconcileChat(entry.conversationId);
  }
  async reconcileChat(chatId: string) {
    const records = this.custody.records().filter(record => record.ref.chatId === chatId && !record.remote && !this.active.has(record.messageId));
    if (!records.length) return;
    const { subagents } = await this.saved(chatId);
    for (const messageId of new Set(records.map(record => record.messageId))) {
      const message = await this.chats.getNativeMessage(chatId, { kind: "id", messageId });
      const fences = new Map(message ? messageArtifactFences(message, subagents).map(fence => [fence.id, this.recovery.read({ chatId, incarnationId: records[0]!.ref.incarnationId, artifactId: fence.id })?.fence ?? fence]) : []);
      for (const record of records.filter(record => record.messageId === messageId)) {
        const expected = record.derivedFrom ?? { artifactId: record.fence.id, sha256: record.fence.sha256 };
        if (this.chats.getIncarnationId(chatId) !== record.ref.incarnationId || fences.get(expected.artifactId)?.sha256 !== expected.sha256) await this.release(record.ref);
        else await this.publisher.enqueue(record.ref, record.fence);
      }
      await this.custody.commit(chatId, messageId, new Set(fences.keys()));
    }
  }
  async prepareFork(sourceChatId: string, sourceIncarnationId: string, childChatId: string, childIncarnationId: string, messages: ChatMessage[], subagents?: ChatRecord["subagents"]) {
    if (this.chats.getIncarnationId(sourceChatId) !== sourceIncarnationId) throw new Error("artifact-fork-source-stale");
    const artifactIds = [...new Set(messages.flatMap(message => messageArtifactFences(message, subagents)).filter(fence => fence.sha256 || this.recovery.read({ chatId: sourceChatId, incarnationId: sourceIncarnationId, artifactId: fence.id })?.fence?.sha256).map(fence => fence.id))].sort();
    await this.forks.prepare({ sourceChatId, sourceIncarnationId, childChatId, childIncarnationId, artifactIds, complete: false });
  }
  async fork(sourceChatId: string, child: ChatRecord) {
    let intent = this.forks.read(child.id);
    if (!intent) {
      const incarnation = this.chats.getIncarnationId(sourceChatId);
      if (!incarnation) throw new Error("artifact-fork-incomplete: Original source custody is unavailable");
      await this.prepareFork(sourceChatId, incarnation, child.id, child.incarnationId, child.messages, child.subagents);
      intent = this.forks.read(child.id)!;
    }
    if (intent.sourceChatId !== sourceChatId || intent.childIncarnationId !== child.incarnationId) throw new Error("artifact-fork-intent-conflict");
    const sourceIncarnation = intent.sourceIncarnationId;
    const copied: string[] = [];
    for (const message of child.messages) for (const fence of messageArtifactFences(message, child.subagents)) {
      const recovered = this.recovery.read({ chatId: sourceChatId, incarnationId: sourceIncarnation, artifactId: fence.id })?.fence;
      const retainedFence = recovered ?? fence;
      if (!retainedFence.sha256) continue;
      const source = { chatId: sourceChatId, incarnationId: sourceIncarnation, artifactId: fence.id };
      const target = { chatId: child.id, incarnationId: child.incarnationId, artifactId: fence.id };
      if (!intent.artifactIds.includes(fence.id)) throw new Error("artifact-fork-reference-conflict");
      if (!this.custody.lookup(source)) await this.resolve(source);
      if (this.custody.lookup(source)?.fence.sha256 !== retainedFence.sha256) throw new Error("artifact-fork-source-identity-changed");
      await this.custody.fork(source, target, message.id);
      await this.publisher.enqueue(target, retainedFence);
      const recovery = this.recovery.read(source);
      if (recovery?.fence) { await this.recovery.prepare({ ...recovery, ref: target, messageId: message.id }); }
      if (retainedFence.design) copied.push(fence.id);
    }
    await this.designFork?.(sourceChatId, sourceIncarnation, child, copied);
    await this.forks.complete(child.id);
  }
  async recoverSettlements(deliver: NonNullable<import("../../agent/bridge/bridge-types").AgentBridgeOptions["onTurnSettled"]>, eligible: (requestId: string) => boolean = () => true) {
    for (const receipt of this.settlements.pending()) {
      if (!eligible(receipt.requestId)) continue;
      if (this.chats.getIncarnationId(receipt.conversationId) !== receipt.incarnationId) continue;
      const message = await this.chats.getNativeMessage(receipt.conversationId, { kind: "id", messageId: receipt.assistantMessageId });
      const outcome = receipt.outcome ?? (message?.role === "assistant" && message.turnId === receipt.requestId ? "stored" : undefined);
      if (!outcome) continue;
      await this.settlements.patch(receipt.requestId, { outcome });
      if (!receipt.business) {
        try { await deliver({ conversationId: receipt.conversationId, requestId: receipt.requestId, assistantMessageId: receipt.assistantMessageId,
          planRequested: receipt.planRequested, terminal: receipt.terminal, cleanup: receipt.cleanup, outcome, ...(message ? { assistantMessage: message } : {}) });
          await this.settlements.patch(receipt.requestId, { business: true });
        } catch { console.warn("[agent] business settlement recovery remains pending", { requestId: receipt.requestId }); }
      }
      if (!receipt.artifact) {
        try { await this.settled({ conversationId: receipt.conversationId, messageId: receipt.assistantMessageId } as BridgeEntry, outcome === "stored");
          await this.settlements.patch(receipt.requestId, { artifact: true });
        } catch { console.warn("[artifact] settlement recovery remains pending", { requestId: receipt.requestId }); }
      }
    }
  }
  private async captured(ref: ArtifactRef, roots: ArtifactRoots, reference: ArtifactReference) {
    const record = this.custody.lookup(ref);
    if (record) return { fence: record.fence, data: (await this.custody.read(ref)).data };
    const candidate = this.recovery.read(ref)?.candidate;
    if (candidate) return { fence: candidate, data: (await this.custody.readSnapshot(ref, candidate)).data };
    return admitArtifact(roots, reference, ref.artifactId);
  }
  private async cancelCapture(ref: ArtifactRef) {
    // Unattempted publication has no remote effect. Keep private retry arguments for the same canonical fence.
    if (!this.recovery.read(ref)?.fence && await this.publisher.discardUnpublished(ref)) {
      const record = this.custody.lookup(ref);
      if (record) await this.recovery.preserve(ref, record.fence);
      await this.custody.release(ref);
    }
  }
  captureStatus(ref: ArtifactRef) { this.assert(ref); const saved = this.recovery.read(ref); return saved?.fence ?? saved?.failure ?? null; }
  retryCapture(ref: ArtifactRef) {
    const key = JSON.stringify(ref), current = this.recoveryFlights.get(key);
    if (current) return current;
    const saved = this.recovery.read(ref);
    if (!saved) return Promise.reject(new Error("artifact-recovery-unavailable"));
    const controller = new AbortController(); this.recoveryControllers.add(controller);
    const scope = () => { this.assert(ref); assertArtifactGeneration(saved.generation); };
    const check = () => { controller.signal.throwIfAborted(); scope(); };
    const rejected = (cause: unknown, stage: string): ArtifactFence => {
      const failure = artifactFailure(cause, stage);
      console.warn("[artifact] capture retry failed", { artifactId: ref.artifactId, stage: failure.stage, code: failure.code, errno: failure.errno, retryable: failure.retryable });
      return { v: 1, id: ref.artifactId, kind: "file", title: (saved.reference.title || basename(saved.reference.path) || "Artifact").slice(0, 250), rejected: failure.code };
    };
    const operation = (async () => {
      let stage = "admission";
      try {
        check(); if (saved.fence) return saved.fence;
        const message = await this.chats.getNativeMessage(ref.chatId, { kind: "id", messageId: saved.messageId }); check();
        const subagents = await this.chats.getNativeSubagents(ref.chatId); check();
        if (!message || !messageArtifactFences(message, subagents ?? undefined).some(fence => fence.id === ref.artifactId && fence.rejected)) throw new Error("artifact-recovery-owner-changed");
        const snapshot = await this.captured(ref, saved.roots, saved.reference);
        check(); stage = "retain"; await this.custody.retain({ ref, fence: snapshot.fence, messageId: saved.messageId, committed: true }, snapshot.data);
        check(); stage = "enqueue"; await this.publisher.enqueue(ref, snapshot.fence);
        check(); await this.recovery.complete(ref, snapshot.fence); check(); return snapshot.fence;
      } catch (cause) {
        try { check(); } catch { await this.cancelCapture(ref); }
        scope(); const fence = rejected(cause, stage); await this.recovery.fail(ref, fence); return fence;
      }
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<ArtifactFence>(resolve => {
      controller.signal.addEventListener("abort", () => {
        const fence = rejected(controller.signal.reason, "capture");
        void this.recovery.fail(ref, fence).catch(() => undefined); resolve(fence);
      }, { once: true });
      timer = setTimeout(() => controller.abort(new ArtifactFailure("unavailable", "capture")), 10_000); timer.unref();
    });
    const task = Promise.race([operation, expired]); this.recoveryFlights.set(key, task);
    // A timed-out call stays single-flight until its late writer has acknowledged cancellation.
    void operation.finally(() => { clearTimeout(timer); this.recoveryControllers.delete(controller); if (this.recoveryFlights.get(key) === task) this.recoveryFlights.delete(key); }).catch(() => undefined);
    return task;
  }

  async release(ref: ArtifactRef) {
    for (const child of this.custody.records().filter(record => record.ref.chatId === ref.chatId && record.ref.incarnationId === ref.incarnationId && record.derivedFrom?.artifactId === ref.artifactId)) {
      await this.publisher.release(child.ref); await this.custody.release(child.ref);
    }
    await this.publisher.release(ref); await this.custody.release(ref); await this.recovery.release(ref);
  }
  async releaseChat(chatId: string, incarnationId: string) {
    if (this.forks.held(chatId, incarnationId)) throw new Error("artifact-fork-incomplete: Finish the retained child before deleting source bytes");
    for (const job of this.publisher.jobs()) if (job.ref.chatId === chatId && job.ref.incarnationId === incarnationId) await this.publisher.release(job.ref);
    for (const record of this.custody.records()) if (record.ref.chatId === chatId && record.ref.incarnationId === incarnationId) await this.recovery.release(record.ref);
    await this.recovery.releaseChat(chatId, incarnationId);
    await this.custody.releaseChat(chatId, incarnationId);
    for (const release of this.designRetention) await release(chatId, incarnationId);
  }
  async close() { for (const controller of this.recoveryControllers) controller.abort(new ArtifactFailure("unavailable", "capture")); await this.publisher.close(); await Promise.allSettled(this.acquisitions.values()); await this.custody.close(); await this.forks.close(); await this.recovery.close(); await this.settlements.close(); }
}
