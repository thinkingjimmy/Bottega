/**
 * [INPUT]: Depends on bounded Zod diagnostics, approved binding, the four Store outboxes, artifact publication and formal entity/file publishers.
 * [OUTPUT]: Delivers deletions before uploads, publishes a named Chat's metadata on its own fast lane, completes recovered native body/import/Home publication through convergence and isolates entity failures within bounded lanes.
 * [POS]: Main synchronization composition; an entity remains pending until every required content component is confirmed.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { ZodError } from "zod";
import { DesktopSkillsSync } from "../skills/service";
import { DesktopChatConvergence } from "../convergence/service";
import type { RecoverySave } from "../../chat/recovery/save";
import { DesktopChatDownlink } from "../downlink/chats";
import { hydrateLibraryFiles } from "../../../library/assets/remote";
import { artifactRuntime } from "../../../artifacts/runtime";
import { hashCanonical, type BlobTransferPorts, type CloudBuildConfig, type FileProgress } from "@ai-chat/cloud-protocol";
import { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import type { SyncProgress } from "../../../../../shared/cloud/sync";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { CleanupOwners } from "../account/cleanup/plan";
import type { SyncBindingStore } from "../account/binding";
import type { AccountTransport } from "../../runtime/transport";
import type { BasePromotionService } from "../../../bases/base-promotion-service";
import { DesktopBaseSync } from "../bases/base-sync";
import { captureInitialBase } from "../bases/initial";
import { BaseFilePublisher } from "../bases/files";
import { DesktopProjectSync } from "../projects/project-sync";
import { NativeChatInitialization } from "../chats/initial";
import { DesktopChatMetadataSync } from "../chats/metadata";
import { chatIdOf, type ChatOutboxItem } from "../chats/sources";
import { ChatDeliveryCheckpoints } from "../chats/checkpoints";
import type { ChatBodyBytePorts } from "../chats/bodies";
import { DesktopAppPublisher } from "../apps/publisher";
import { HomeSnapshotPublisher } from "../../sync-home/publisher";
import { ImportedHistoryPublisher } from "../chats/imported/publisher";
import { LiveTurnPublisher } from "../../remote/live-turn-publisher";
import type { LocalTurnRecorder } from "../../remote/recorder";
import { DesktopDownlink } from "../downlink/controller";
import { DesktopBlobStore } from "../../files/store";
import { IncrementalChatPublisher } from "../chats/incremental/publisher";
import { DesktopDeletionPublisher } from "../deletion/publisher";
import { DesktopChatDeletions } from "../deletion/downlink";
import { DesktopBaseDeletions } from "../deletion/bases";
import { DesktopAppDeletions, type AppRetirement } from "../deletion/apps";
import { DesktopAppDeletionPublisher } from "../deletion/app-publisher";
import { DesktopProjectDeletions } from "../deletion/projects/downlink";
import { DesktopClassificationPublisher } from "../chats/classification/publisher";
import { forEachIsolated, RetrySchedule } from "./schedule";
// A whole chat is one unit of upload work; four lanes keep the latency-bound path busy without exceeding the crypto queue's waiting budget.
const CHAT_LANES = 4, FLUSH_INTERVAL = 30_000, FLUSH_CEILING = 60_000, TURN_INTERVAL = 30_000, WAKE_DELAY = 250;
export class DesktopSyncRun {
  private readonly signal = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private turnWake: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setInterval> | null = null;
  private flight: Promise<void> | null = null;
  private closed = false;
  private readonly retry = new RetrySchedule(FLUSH_INTERVAL, FLUSH_CEILING);
  private failureDigest: string | null = null;
  private woken = false;
  private items: ChatOutboxItem[] | null = null;
  private lateRetained = new Map<string, string>();
  private detachOutbox: (() => void) | null = null;
  private detachBases: (() => void) | null = null;
  private readonly scope: SyncScope;
  private readonly manifestId: string;
  private readonly files: EncryptedBlobTransfer;
  private readonly skills: DesktopSkillsSync | null;
  private readonly convergence: DesktopChatConvergence | null;
  private readonly cache: DesktopBlobStore;
  private readonly baseFiles: BaseFilePublisher;
  private readonly bases: DesktopBaseSync;
  private readonly projects: DesktopProjectSync;
  private readonly chats: NativeChatInitialization;
  private readonly metadata: DesktopChatMetadataSync;
  private readonly apps: DesktopAppPublisher;
  private readonly homes: HomeSnapshotPublisher;
  private readonly imports: ImportedHistoryPublisher;
  private readonly turns: LiveTurnPublisher;
  private readonly downlink: DesktopDownlink;
  private readonly incremental: IncrementalChatPublisher;
  private readonly deletions: DesktopDeletionPublisher;
  private readonly deletedChats: DesktopChatDeletions;
  private readonly deletedBases: DesktopBaseDeletions;
  private readonly deletedApps: DesktopAppDeletions;
  private readonly deletedProjects: DesktopProjectDeletions;
  private readonly appDeletions: DesktopAppDeletionPublisher;
  private readonly classifications: DesktopClassificationPublisher;
  private readonly failures = new AsyncLocalStorage<{ all: Error[]; required: Error[]; participant: boolean }>();
  private readonly knownProjects = new Set<string>();
  constructor(private readonly input: { crypto(): FileCipherPort; config: CloudBuildConfig; userData: string; deviceId: string; owners: CleanupOwners;
    binding: SyncBindingStore; transport: Pick<AccountTransport, "query" | "mutate" | "watchSkillsCatalog">; filePorts: BlobTransferPorts; bytes: Omit<ChatBodyBytePorts, "files">;
    recorder?: LocalTurnRecorder; promotion?: BasePromotionService; retireApp?: AppRetirement; recovery?: Pick<RecoverySave, "save">; assertIdle?(chatId: string): void;
    changed(value: Partial<SyncProgress>): void; dataChanged(): void }) {
    const binding = input.binding.snapshot(); if (!binding || binding.phase === "closing") throw new Error("SYNC_SCOPE_INACTIVE");
    this.scope = { environment: input.config.environmentId, userId: binding.userId }; this.manifestId = binding.manifestId;
    const progress = (value: FileProgress) => { if (!this.closed) input.changed({ phase: "files", uploadedBytes: value.bytes, totalBytes: value.total }); };
    this.files = new EncryptedBlobTransfer(input.filePorts);
    this.cache = new DesktopBlobStore(input.userData, { environmentId: input.config.environmentId, deploymentId: input.config.deploymentId, userId: binding.userId }, input.filePorts);
    this.baseFiles = new BaseFilePublisher({ store: input.owners.bases, config: input.config, userId: binding.userId, files: this.files, progress });
    this.skills = input.owners.skills ? new DesktopSkillsSync({ ...input, store: input.owners.skills.library, files: this.files, current: () => this.assertCurrent(), wake: () => this.wake(), changed: () => input.owners.skills!.remountFolder() }) : null;
    this.convergence = input.recovery ? new DesktopChatConvergence({ scope: this.scope, deviceId: input.deviceId, chats: input.owners.chats,
      recovery: input.recovery, current: () => this.assertCurrent(), assertIdle: id => input.assertIdle?.(id), changed: () => { input.dataChanged(); this.woken = true; } }) : null;
    const common = { crypto: input.crypto, config: input.config, scope: this.scope, transport: input.transport, changed: () => input.dataChanged(), failure: (_id: unknown, error: unknown) => { this.fail(error); } };
    this.bases = new DesktopBaseSync({ ...common, store: input.owners.bases, files: this.baseFiles });
    this.projects = new DesktopProjectSync({ ...common, store: input.owners.projects });
    this.chats = new NativeChatInitialization({ ...common, store: input.owners.chats.sync, deviceId: input.deviceId, bytes: { ...input.bytes, files: this.files } });
    this.metadata = new DesktopChatMetadataSync({ ...common, store: input.owners.chats.sync, deviceId: input.deviceId });
    this.incremental = new IncrementalChatPublisher({ ...input, scope: this.scope, store: input.owners.chats.sync, current: () => this.assertCurrent() });
    this.classifications = new DesktopClassificationPublisher({ ...input, scope: this.scope, store: input.owners.chats.sync, current: () => this.assertCurrent(), changed: input.dataChanged });
    this.deletions = new DesktopDeletionPublisher({ ...input, scope: this.scope, store: input.owners.chats.sync, current: () => this.assertCurrent(), changed: input.dataChanged });
    this.appDeletions = new DesktopAppDeletionPublisher({ ...input, scope: this.scope, apps: input.owners.apps, current: () => this.assertCurrent(), changed: input.dataChanged });
    this.deletedChats = new DesktopChatDeletions({ ...input, scope: this.scope, store: input.owners.chats.sync, bases: input.owners.bases,
      current: () => this.assertCurrent(), changed: () => input.dataChanged() });
    this.deletedBases = new DesktopBaseDeletions({ ...input, scope: this.scope, store: input.owners.chats.sync, bases: input.owners.bases, projects: input.owners.projects,
      current: () => this.assertCurrent(), changed: input.dataChanged, forget: id => this.bases.forget(id) });
    this.deletedApps = new DesktopAppDeletions({ ...input, scope: this.scope, store: input.owners.chats.sync, baseFiles: this.baseFiles,
      current: () => this.assertCurrent(), changed: input.dataChanged, forget: id => this.bases.forget(id) });
    this.deletedProjects = new DesktopProjectDeletions({ ...input, scope: this.scope, store: input.owners.chats.sync,
      projects: input.owners.projects, current: () => this.assertCurrent(), changed: input.dataChanged });
    this.apps = new DesktopAppPublisher({ ...input, scope: this.scope, manifestId: this.manifestId, files: this.files, progress });
    const content = { ...input, scope: this.scope, store: input.owners.chats.sync, files: this.files, progress };
    this.homes = new HomeSnapshotPublisher({ ...content, homes: input.owners.homes }); this.imports = new ImportedHistoryPublisher(content);
    this.turns = new LiveTurnPublisher({ ...input, scope: this.scope, store: input.owners.chats.sync,
      bytes: { ...input.bytes, files: this.files }, current: () => this.assertCurrent(), changed: () => input.dataChanged() });
    this.downlink = new DesktopDownlink({ ...common, promotion: input.promotion, chats: input.owners.chats.sync, projects: input.owners.projects,
      apps: input.owners.apps, bases: input.owners.bases, baseFiles: this.baseFiles, files: this.files, cache: this.cache,
      afterBody: head => hydrateLibraryFiles({ root: () => input.owners.homes.libraryRoot, store: input.owners.chats.sync,
        scope: this.scope, head, files: this.files, crypto: input.crypto, current: () => this.assertCurrent(), signal: this.signal.signal }),
      current: () => this.assertCurrent(), wake: () => this.wake(), failure: error => { this.fail(error); },
      beforeReceipts: head => this.convergence?.reconcile(head) ?? Promise.resolve(),
      refreshBase: target => { void this.bases.flush(target); } });
  }
  start() {
    this.downlink.start(); this.schedule();
    if (!this.turnTimer) { this.turnTimer = setInterval(() => { void this.turns.flush().catch(() => {}); }, TURN_INTERVAL); this.turnTimer.unref(); }
    // Local commits reach the cloud on the append hook; both timers only cover retries and work this process did not enqueue itself.
    this.detachOutbox ??= this.input.owners.chats.sync.onOutboxAppended((entityKind, chatId) => this.failures.exit(() => {
      if (this.closed) return;
      this.wakeTurns();
      if (entityKind === "turn") return;
      if (chatId) this.wakeMetadata(chatId);
      this.wake();
    }));
    // A Base the user just opened becomes live now, not at the next pass; a Base nothing shows keeps no subscription.
    this.detachBases ??= this.input.owners.bases.onSurfaceRead((ownerKey, baseId) => {
      if (this.closed) return;
      try { this.bases.observe({ ownerKey, baseId }); } catch (error) { this.fail(error); }
    });
    void this.queuedMetadata().catch(() => {});
    return this.flush();
  }
  /* One Chat's queued metadata is its own unit of work: the metadata sync is single-flight per Chat and reports through
     its own async failure context, so a title, archive or drag never waits behind a slow lane. A Chat that still owes
     its initial publication stays with the pass, which alone owns identity adoption and recovery. */
  private async fastMetadata(chatId: string) {
    this.assertCurrent();
    const queue = await this.input.owners.chats.sync.read(this.scope, { type: "metadata-outbox", chatId, limit: 100 });
    if (queue.type !== "metadata-outbox" || queue.value.some(item => item.kind === "initialize") ||
      !queue.value.some(item => item.metadata_status === "queued")) return;
    this.assertCurrent(); await this.metadata.flush(chatId);
  }
  // A superseded run or an unreadable queue is the pass's to report; the wake below always schedules one.
  private wakeMetadata(chatId: string) { this.failures.exit(() => { void this.fastMetadata(chatId).catch(() => {}); }); }
  // Edits committed while this process was not running deserve the same lane as the ones it just saw.
  private async queuedMetadata() {
    const queued = (await this.readOutbox()).filter(item => item.metadata_status === "queued" && item.kind !== "initialize");
    for (const chatId of new Set(queued.map(chatIdOf))) this.wakeMetadata(chatId);
  }
  private schedule(delay = this.retry.delay) {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, delay); this.timer.unref();
  }
  // New work that lands mid-pass is not lost: the pass in flight may already have read past it.
  wake() { this.retry.reset(); if (this.flight) { this.woken = true; return; } this.schedule(WAKE_DELAY); }
  private wakeTurns() {
    if (this.turnWake || this.closed) return;
    this.turnWake = setTimeout(() => { this.turnWake = null; void this.turns.flush().catch(() => {}); }, 200);
    this.turnWake.unref();
  }
  private assertCurrent() {
    this.signal.signal.throwIfAborted(); const binding = this.input.binding.snapshot();
    if (this.closed || !binding || binding.manifestId !== this.manifestId || binding.userId !== this.scope.userId || binding.paused || binding.phase === "closing") throw new Error("cloud-request-superseded");
  }
  private async checkpoint(participant: "projects" | "chats" | "bases" | "apps" | "files" | "homes", evidence: unknown) {
    this.assertCurrent();
    if (!this.input.binding.snapshot()!.checkpoints.some(item => item.participant === participant)) await this.input.binding.checkpoint(this.manifestId, participant, hashCanonical([this.manifestId, participant, evidence]));
  }
  // A thrown non-Error is legal JavaScript; normalizing at the single entry keeps every failure reportable and rethrowable.
  private fail(error: unknown) {
    const pass = this.failures.getStore(); if (!pass) return;
    const failure = error instanceof Error ? error : new Error(String(error));
    pass.all.push(failure); if (pass.participant) pass.required.push(failure);
  }
  private peripheral<T>(run: () => Promise<T>) {
    const pass = this.failures.getStore()!;
    return this.failures.run({ ...pass, participant: false }, run);
  }
  // One pass reads the outbox once per mutation boundary instead of once per consumer.
  private async outbox() { return this.items ??= await this.readOutbox(); }
  private stale() { this.items = null; }
  private async readOutbox() {
    const items: ChatOutboxItem[] = []; let afterId: string | null = null;
    for (;;) {
      this.assertCurrent();
      const result = await this.input.owners.chats.sync.read(this.scope, { type: "outbox", afterId, limit: 100 });
      if (result.type !== "outbox") throw new Error("CHAT_OUTBOX_UNAVAILABLE"); items.push(...result.value);
      if (items.length > 10000) throw new Error("CHAT_OUTBOX_READ_BUDGET");
      if (result.value.length < 100) return items; afterId = result.value.at(-1)!.id;
    }
  }
  // Only a chat whose own queue moved can have new late deletion evidence; the feed covers every other tombstone.
  private lateChanged(items: ChatOutboxItem[]) {
    const signatures = new Map<string, string>(), owned = new Map<ChatOutboxItem, string>();
    for (const item of items) {
      if (item.kind === "delete-chat") continue;
      const chatId = chatIdOf(item); owned.set(item, chatId);
      signatures.set(chatId, `${signatures.get(chatId) ?? ""}${item.id}:${item.payload_digest};`);
    }
    const changed = [...owned].filter(([, chatId]) => this.lateRetained.get(chatId) !== signatures.get(chatId)).map(([item]) => item);
    this.lateRetained = signatures; return changed;
  }
  private flush() {
    if (this.closed) return Promise.resolve(); if (this.flight) return this.flight;
    const failures = { all: [] as Error[], required: [] as Error[], participant: true };
    const flight = this.failures.run(failures, () => this.deliver()).then(() => { this.failureDigest = null; this.retry.reset(); }, error => {
      // A pass that keeps failing the same way must not flip the row between syncing and error on every retry.
      const value = String(error instanceof Error ? error.message : error);
      if (process.env.BOTTEGA_SYNC_DIAGNOSTICS === "1") console.warn("[cloud-sync-failure]", {
        name: error instanceof Error ? error.name : "UnknownError",
        code: /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : "unclassified",
        issues: failures.all.flatMap(failure => failure instanceof ZodError ? failure.issues.map(({ code, path }) => ({ code, path })) : []).slice(0, 12),
        sites: failures.all.slice(0, 4).map(failure => failure.stack?.split("\n").filter(line => /^\s*at /.test(line)).slice(0, 4)),
        serverCodes: failures.all.map(failure => failure.message.match(/\b[A-Z][A-Z0-9_-]{5,80}\b/g)?.slice(0, 8)),
        codes: [...new Set(failures.all.map(failure =>
          /^[A-Za-z0-9_-]{1,80}$/.test(failure.message) ? failure.message : "unclassified"))].slice(0, 16),
      });
      if (!this.closed && value !== this.failureDigest) this.input.changed({ status: "error", error: "upload-failed" });
      this.failureDigest = value; this.retry.failed(); throw error;
    });
    this.flight = flight; this.woken = false;
    void flight.finally(() => {
      if (this.flight !== flight) return;
      this.flight = null; this.schedule(this.woken ? WAKE_DELAY : undefined); this.woken = false;
    }).catch(() => {}); return flight;
  }
  private async deliver() {
    this.assertCurrent(); this.stale(); const { owners, binding } = this.input;
    // `lifecycle/api:head` is one global revision for every topic, so the whole pass shares a single query.
    const feed = { revision: null as number | null };
    await this.appDeletions.publish(); this.assertCurrent();
    await this.deletedApps.pull(feed); this.assertCurrent();
    await this.deletedProjects.pull(feed); this.assertCurrent();
    await this.deletedBases.pull(feed); this.assertCurrent();
    this.downlink.forget(await this.deletedChats.pull(feed));
    const queued = await this.outbox();
    await this.deletedChats.retainLate(this.lateChanged(queued));
    const removals = queued.some(item => item.kind === "delete-chat");
    await forEachIsolated(queued.filter(item => item.kind === "delete-chat"), 1, item => this.deletions.publish([item]), error => { this.assertCurrent(); this.fail(error); }); this.assertCurrent();
    if (removals) { this.stale(); feed.revision = null; }
    this.downlink.forget(await this.deletedChats.pull(feed)); this.assertCurrent();
    const initializing = binding.snapshot()!.phase === "initializing";
    if (this.failureDigest) this.input.changed({ phase: "projects" });
    else this.input.changed({ status: initializing ? "initializing" : "syncing", error: null, phase: "projects" });
    for (const project of owners.projects.list()) {
      this.assertCurrent(); if (project.localRecoveryId || project.role !== "workspace" || project.workspaceBinding.kind === "app") continue;
      if (!project.sync) await owners.projects.portable.captureInitial(this.scope, project.id, this.manifestId);
      if (!this.knownProjects.has(project.id)) { this.knownProjects.add(project.id); this.projects.observe(project.id); }
      if (!project.sync || project.sync.pending.length) await this.projects.flush(project.id);
    }
    this.assertCurrent();
    this.input.changed({ phase: "apps" });
    const appIds = [...new Set([
      ...owners.apps.list().filter(app => app.manifest?.kind === "base" && app.state === "ready").map(app => app.id),
      ...owners.apps.portable.publication.list(this.scope).filter(plan => plan.state !== "complete").map(plan => plan.operation.appId),
    ])].filter(appId => !owners.apps.portable.get(appId)?.tombstoned);
    const isolate = (error: unknown) => { this.assertCurrent(); this.fail(error); };
    await forEachIsolated(appIds, 1, async appId => { this.assertCurrent(); await this.apps.createIdentity(appId); }, isolate);
    await owners.chats.sync.mutate(this.scope, hashCanonical(["initial-capture", this.manifestId]), { type: "capture-initial", manifestId: this.manifestId });
    this.stale();
    const initial = (await this.outbox()).filter(item => item.kind === "initialize");
    this.input.changed({ phase: "chats", completed: 0, total: initial.length });
    await forEachIsolated(initial, 1, async item => {
      // Retiring immediately keeps the decoded snapshot out of memory until the publication phase actually needs it.
      try { this.assertCurrent(); await this.chats.createIdentity(item); } finally { this.chats.retire([item]); }
    }, isolate);
    await this.peripheral(() => this.downlink.discover().catch(error => this.fail(error))); this.assertCurrent();
    this.input.changed({ phase: "bases" });
    for (const { ownerKey, snapshot } of owners.bases.listAll()) {
      this.assertCurrent(); const baseId = snapshot.meta.ownerInstanceId;
      try {
      const envelope = owners.bases.sync.read(ownerKey, baseId);
      if (envelope.initialIdentityRecovery || envelope.tombstones.includes("base") || envelope.promotionExport) continue;
      if (!envelope.scope && owners.apps.portable.publication.list(this.scope).some(plan => plan.operation.baseId === baseId &&
        !plan.association && !plan.promotion && Boolean(plan.encryptedCreate))) continue;
      if (snapshot.meta.owner.kind === "project") {
        const projectId = snapshot.meta.owner.projectId, project = owners.projects.get(projectId);
        if (project?.sync && !project.sync.confirmed) {
          await this.projects.flush(projectId);
          if (!owners.projects.get(projectId)?.sync?.confirmed) continue;
        }
      }
      const currentBaseId = await captureInitialBase({ ...this.input, scope: this.scope, store: owners.bases, projects: owners.projects,
        ownerKey, baseId, files: this.baseFiles.codec({ ownerKey, baseId }), manifestId: this.manifestId, signal: this.signal.signal });
      const target = { ownerKey, baseId: currentBaseId };
      this.bases.observe(target);
      if (owners.bases.sync.read(ownerKey, currentBaseId).pendingOperations.length) await this.bases.flush(target);
      } catch (error) { this.assertCurrent(); this.fail(error); }
    }
    let completed = 0;
    await forEachIsolated(initial, CHAT_LANES, async item => {
      try {
      const identity = await this.chats.createIdentity(item);
      if (identity.adopted) {
        if (!this.convergence) throw new Error("CHAT_CONVERGENCE_UNAVAILABLE");
        const head = identity.head;
        await owners.chats.sync.mutate(this.scope, hashCanonical(["adoption-head", this.scope, head]), { type: "put-mirror-head", head });
        const download = new DesktopChatDownlink({ ...this.input, scope: this.scope, store: owners.chats.sync, files: this.files,
          cache: this.cache, current: () => this.assertCurrent(), changed: this.input.dataChanged, skipReceipts: true });
        try { if (!await download.hydrate(head)) throw new Error("MIRROR_BODY_UNAVAILABLE"); }
        finally { await download.close(); }
        await this.convergence.reconcile(head, item);
        completed++; this.input.changed({ completed }); return;
      }
      this.assertCurrent(); this.input.changed({ phase: "chats" }); await this.chats.publish(item);
      const { snapshot, head } = await this.chats.createIdentity(item);
      const checkpoints = new ChatDeliveryCheckpoints(owners.chats.sync, this.scope, item);
      if (!await checkpoints.get("native-complete")) throw new Error("CHAT_INITIAL_INCOMPLETE");
      this.input.changed({ phase: "chats" }); await this.imports.publish(item, snapshot, head, this.signal.signal);
      this.input.changed({ phase: "homes" }); await this.homes.publish(item, head, this.signal.signal);
      await this.input.recorder?.flush();
      const recovered = await this.chats.recoveredHead(item);
      if (recovered) {
        if (!this.convergence) throw new Error("CHAT_CONVERGENCE_UNAVAILABLE");
        await owners.chats.sync.mutate(this.scope, hashCanonical(["recovered-initial-head", this.scope, recovered]), { type: "put-mirror-head", head: recovered });
        const download = new DesktopChatDownlink({ ...this.input, scope: this.scope, store: owners.chats.sync, files: this.files,
          cache: this.cache, current: () => this.assertCurrent(), changed: this.input.dataChanged, skipReceipts: true });
        try { if (!await download.hydrate(recovered)) throw new Error("MIRROR_BODY_UNAVAILABLE"); } finally { await download.close(); }
        await this.convergence.reconcile(recovered, item);
        await this.downlink.open(recovered.chat.id);
      } else { this.assertCurrent(); await owners.chats.sync.mutate(this.scope, hashCanonical(["ack-initial", item.id, item.payload_digest]), {
        type: "complete-initial-chat", id: item.id, payloadDigest: item.payload_digest }); }
      this.wakeMetadata(chatIdOf(item));
      await this.homes.release(item);
      completed++; this.input.changed({ completed });
      } finally { this.chats.retire([item]); }
    }, isolate);
    if (initial.length) this.stale();
    const dirtyChats = new Set((await this.outbox()).map(chatIdOf));
    const downloading = await this.peripheral(() => this.downlink.flush(dirtyChats).catch(error => { this.fail(error); return 1; }));
    if (downloading && !this.failures.getStore()!.all.length) this.woken = true;
    this.stale();
    const queue = await this.outbox();
    const initializingChats = new Set(queue.filter(item => item.kind === "initialize").map(chatIdOf));
    const metadataChats = new Set(queue.filter(item => item.metadata_status === "queued" && !initializingChats.has(chatIdOf(item))).map(chatIdOf));
    for (const chatId of metadataChats) { this.assertCurrent(); await this.metadata.flush(chatId); }
    if (metadataChats.size) this.stale();
    const classified = await this.outbox();
    await forEachIsolated(classified.filter(item => item.kind === "classification"), 1, item => this.classifications.publish([item]), isolate); this.assertCurrent();
    if (classified.some(item => item.kind === "classification")) this.stale();
    const incremental = await this.outbox();
    for (const error of await this.incremental.publish(incremental, this.signal.signal)) this.fail(error);
    if (incremental.some(item => item.kind === "update-chat-facts")) this.stale();
    let acknowledged = false;
    for (const item of await this.outbox()) {
      if (!["metadata-edit", "metadata-recovery"].includes(item.kind) || !["applied", "converged", "discarded"].includes(item.metadata_status ?? "")) continue;
      this.assertCurrent(); await owners.chats.sync.mutate(this.scope, hashCanonical(["ack-metadata", item.id, item.payload_digest]),
        { type: "ack-outbox", id: item.id, payloadDigest: item.payload_digest }); acknowledged = true;
    }
    if (acknowledged) this.stale();
    const queuedNow = await this.outbox();
    const generations = queuedNow.filter(item => item.entity_kind === "generation").sort((a, b) => a.seq_or_revision - b.seq_or_revision || a.created_at - b.created_at || a.id.localeCompare(b.id));
    await forEachIsolated(generations, 1, async item => { this.assertCurrent(); await this.imports.deliver(item, this.signal.signal); }, isolate);
    await this.input.recorder?.flush();
    // A stuck turn must not stop Home delivery, downlink reads or retirement for everything else.
    await this.turns.flush().catch(isolate);
    if (generations.length) this.stale();
    await this.peripheral(async () => { await artifactRuntime()?.publisher.flush().catch(isolate); });
    const homeJobs = (await this.outbox()).filter(item => item.entity_kind === "home-snapshot").sort((a, b) => a.seq_or_revision - b.seq_or_revision || a.id.localeCompare(b.id));
    await forEachIsolated(homeJobs, 1, async item => { this.assertCurrent(); await this.homes.deliver(item, this.signal.signal); }, isolate);
    if (homeJobs.length) this.stale();
    await this.incremental.retire(await this.outbox()); this.stale();
    const appIssues: SyncProgress["appIssues"] = [];
    await forEachIsolated(appIds, 1, async appId => {
      this.assertCurrent(); this.input.changed({ phase: "apps" }); const result = await this.apps.publishPackage(appId);
      if (result !== "complete") appIssues.push({ appId, name: owners.apps.get(appId)?.displayName ?? owners.apps.portable.publication.get(this.scope, appId)!.operation.displayName, reason: result === "unavailable" ? "not-published" :
        owners.apps.portable.publication.get(this.scope, appId)?.publishReceipt?.reason === "atomic-migration-unavailable" ? "migration-blocked" : "version-conflict" });
    }, isolate);
    await this.peripheral(async () => { await this.skills?.flush(this.signal.signal).catch(isolate); });
    const bases = owners.bases.listAll().map(({ ownerKey, snapshot }) => owners.bases.sync.read(ownerKey, snapshot.meta.ownerInstanceId));
    const basePending = bases.reduce((sum, base) => sum + base.pendingOperations.length + Number(base.cloudState === "local-only" && !base.tombstones.includes("base") && !base.initialIdentityRecovery), 0);
    this.assertCurrent(); const failures = this.failures.getStore()!;
    const remaining = await this.outbox(), pending = remaining.length + basePending + owners.projects.list().reduce((sum, project) => sum + (project.sync?.pending.length ?? 0), 0) +
      owners.apps.portable.deletion.list(this.scope).filter(item => !item.receipt).length;
    const conflicts = bases.reduce((sum, base) => sum + base.conflictCandidates.filter(candidate => candidate.state === "unresolved").length, 0) +
      owners.projects.list().reduce((sum, project) => sum + (project.sync?.conflicts.length ?? 0), 0) + remaining.filter(item => item.metadata_status === "conflicted" || item.last_error === "CHAT_CLASSIFICATION_CONFLICT").length;
    if (initializing && !pending && !failures.required.length) {
      const state = await owners.chats.sync.read(this.scope, { type: "state" });
      const manifest = state.type === "state" && state.value && "initial_manifest_json" in state.value && state.value.initial_manifest_json ? JSON.parse(state.value.initial_manifest_json) : null;
      if (manifest?.state !== "complete" || manifest.entries.some((entry: { completionHash?: string }) => !entry.completionHash)) throw new Error("INITIAL_COMPONENTS_INCOMPLETE");
      const evidence = { chats: manifest, bases, projects: owners.projects.list().map(project => ({ id: project.id, sync: project.sync })),
        apps: owners.apps.portable.publication.list(this.scope) };
      for (const participant of ["projects", "chats", "bases", "apps", "files", "homes"] as const) await this.checkpoint(participant, evidence);
    }
    if (failures.all.length) throw failures.all[0];
    this.input.changed({ status: pending || downloading ? binding.snapshot()!.phase === "initializing" ? "initializing" : "syncing" : appIssues.length ? "partial" : "synced", pending: pending + downloading, conflicts, appIssues,
      phase: null, completed, total: initial.length, uploadedBytes: 0, totalBytes: 0 });
    this.input.dataChanged();
  }
  openChat(chatId: string) { return this.downlink.open(chatId); }
  async close() {
    this.closed = true; this.signal.abort(new Error("SYNC_RUN_CLOSED")); this.detachOutbox?.(); this.detachOutbox = null;
    this.detachBases?.(); this.detachBases = null; if (this.timer) clearTimeout(this.timer);
    if (this.turnWake) clearTimeout(this.turnWake);
    if (this.turnTimer) clearInterval(this.turnTimer); await Promise.all([this.turns.close(), this.downlink.close()]);
    await Promise.all([this.chats.close(), this.metadata.close(), this.apps.close(), this.baseFiles.close(), this.files.close(), this.cache.close()]);
    await Promise.all([this.bases.close(), this.projects.close()]); await this.flight?.catch(() => {}); await this.skills?.close();
  }
}
