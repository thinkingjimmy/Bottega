/**
 * [INPUT]: Canonical Chat identities/messages, plugin admission, immutable custody/outbox and injected document retention/Fork ports.
 * [OUTPUT]: Authorized snapshot/reference reads, turn projection, exact Fork aliases and durable Chat deletion/retention reconciliation.
 * [POS]: Main artifact domain authority; renderer references never become filesystem paths.
 */
import { join } from "node:path";
import { readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { readArtifactFences, type ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { ChatMessage, ChatRecord } from "../../../../shared/ipc/content/chats-ipc";
import { artifactRefSchema, type ArtifactRef } from "../../../../shared/ipc/apps/artifact-ipc";
import type { BridgeEntry, AgentContext } from "../../agent/bridge/bridge-types";
import type { ChatStore } from "../../chats/chat-store";
import { ensureDurableDirectory } from "../../persistence/durable-json";
import { admitArtifact, type ArtifactRoots } from "../admission/files";
import { SnapshotCustody } from "../storage/snapshot-custody";
import { ArtifactPublisher } from "../storage/publish";
import { ArtifactGateway } from "../render/gateway-route";
import { ArtifactProjection } from "../discovery/projection";
import { artifactEnabled, assertArtifactAdmission } from "../admission/state";
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
  remote: import("../access/remote").RemoteArtifacts | null = null;
  readonly custody: SnapshotCustody;
  readonly publisher: ArtifactPublisher;
  readonly gateway: ArtifactGateway;
  private readonly active = new Set<string>();
  private readonly acquisitions = new Map<string, Promise<void>>();
  private readonly sessionRoots = new Map<string, string | null>();
  constructor(readonly root: string, private readonly chats: ChatStore, libraryRoot: () => string | null) {
    this.custody = new SnapshotCustody(root, libraryRoot); this.publisher = new ArtifactPublisher(root); this.gateway = new ArtifactGateway(this);
  }
  async initialize() {
    await this.custody.initialize(); await this.publisher.initialize();
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
    let count = 0;
    const createProjection = (requestId: string) => new ArtifactProjection({ roots, requestId, admissionOpen: artifactEnabled,
      snapshot: async (reference, id) => {
        assertArtifactAdmission();
        if (++count > 8) throw new Error("budget");
        this.assert(ref(id));
        const snapshot = await admitArtifact(roots, reference, id);
        this.assert(ref(id));
        await this.custody.retain({ ref: ref(id), fence: snapshot.fence, messageId: entry.messageId, committed: false }, snapshot.data);
        await this.publisher.enqueue(ref(id), snapshot.fence);
        return snapshot.fence;
      }, release: id => this.release(ref(id)),
    });
    const projection = createProjection(entry.requestId), children = new Map<string, ArtifactProjection>();
    const child = (id: string) => { let value = children.get(id); if (!value) { value = createProjection(entry.requestId + "-child-" + id); children.set(id, value); } return value; };
    const bindSession = async (id: string) => {
      if (entry.backend !== "codex" || !/^[a-f0-9-]{36}$/i.test(id)) return;
      roots.sessionId = id;
      const cached = this.sessionRoots.get(id);
      if (cached !== undefined) { if (cached) roots.session = cached; return; }
      const root = join(homedir(), ".codex", "visualizations");
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
  async resolve(ref: ArtifactRef) {
    await this.validate(ref);
    let record = this.custody.lookup(ref);
    if (record) {
      if (record.derivedFrom) {
        const parentRef = { ...ref, artifactId: record.derivedFrom.artifactId };
        if (this.custody.lookup(parentRef)?.derivedFrom) throw new Error("artifact-export-parent");
        const parent = await this.resolve(parentRef);
        if (parent.record.derivedFrom || parent.record.fence.sha256 !== record.derivedFrom.sha256) throw new Error("artifact-unavailable");
      } else if (record.remote) {
        const current = await this.remote?.resolve(ref);
        if (current?.fence.sha256 !== record.fence.sha256) throw new Error("artifact-unavailable");
      } else if (!this.active.has(record.messageId)) {
        const message = await this.chats.getNativeMessage(ref.chatId, { kind: "id", messageId: record.messageId });
        if (!message || !messageArtifactFences(message, (await this.saved(ref.chatId)).subagents).some(fence => fence.id === ref.artifactId && fence.sha256 === record!.fence.sha256)) throw new Error("artifact-unavailable");
      }
    } else {
      const { messages, subagents } = await this.saved(ref.chatId);
      const localCandidate = messages.flatMap(message => messageArtifactFences(message, subagents).map(fence => ({ message, fence })))
        .find(value => value.fence.id === ref.artifactId && value.fence.sha256);
      const remoteCandidate = !localCandidate ? await this.remote?.resolve(ref) : null;
      const candidate = localCandidate ? { fence: localCandidate.fence, messageId: localCandidate.message.id } : remoteCandidate;
      if (!candidate) throw new Error("artifact-unavailable");
      const key = JSON.stringify(ref);
      let flight = this.acquisitions.get(key);
      if (!flight) {
        flight = (async () => {
          try {
            await this.custody.retain({ ref, fence: candidate.fence, messageId: candidate.messageId, committed: true });
            return;
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          const data = await this.publisher.download(ref, candidate.fence, AbortSignal.timeout(60_000));
          this.assert(ref);
          await this.custody.retain({ ref, fence: candidate.fence, messageId: candidate.messageId, committed: true, ...(remoteCandidate ? { remote: this.remote!.key() } : {}) }, data);
        })().finally(() => this.acquisitions.delete(key));
        this.acquisitions.set(key, flight);
      }
      await flight; record = this.custody.lookup(ref);
    }
    this.assert(ref);
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
      const fences = new Map(message ? messageArtifactFences(message, subagents).map(fence => [fence.id, fence]) : []);
      for (const record of records.filter(record => record.messageId === messageId)) {
        const expected = record.derivedFrom ?? { artifactId: record.fence.id, sha256: record.fence.sha256 };
        if (this.chats.getIncarnationId(chatId) !== record.ref.incarnationId || fences.get(expected.artifactId)?.sha256 !== expected.sha256) await this.release(record.ref);
        else await this.publisher.enqueue(record.ref, record.fence);
      }
      await this.custody.commit(chatId, messageId, new Set(fences.keys()));
    }
  }
  async fork(sourceChatId: string, child: ChatRecord) {
    const sourceIncarnation = this.chats.getIncarnationId(sourceChatId);
    if (!sourceIncarnation) return;
    const copied: string[] = [];
    for (const message of child.messages) for (const fence of messageArtifactFences(message, child.subagents)) {
      if (!fence.sha256) continue;
      const source = { chatId: sourceChatId, incarnationId: sourceIncarnation, artifactId: fence.id };
      const target = { chatId: child.id, incarnationId: child.incarnationId, artifactId: fence.id };
      await this.resolve(source);
      await this.custody.fork(source, target, message.id);
      await this.publisher.enqueue(target, fence);
      if (fence.design) copied.push(fence.id);
    }
    await this.designFork?.(sourceChatId, sourceIncarnation, child, copied);
  }
  async release(ref: ArtifactRef) {
    for (const child of this.custody.records().filter(record => record.ref.chatId === ref.chatId && record.ref.incarnationId === ref.incarnationId && record.derivedFrom?.artifactId === ref.artifactId)) {
      await this.publisher.release(child.ref); await this.custody.release(child.ref);
    }
    await this.publisher.release(ref); await this.custody.release(ref);
  }
  async releaseChat(chatId: string, incarnationId: string) {
    for (const job of this.publisher.jobs()) if (job.ref.chatId === chatId && job.ref.incarnationId === incarnationId) await this.publisher.release(job.ref);
    await this.custody.releaseChat(chatId, incarnationId);
    for (const release of this.designRetention) await release(chatId, incarnationId);
  }
  async close() { await this.publisher.close(); await Promise.allSettled(this.acquisitions.values()); await this.custody.close(); }
}
