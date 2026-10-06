/**
 * [INPUT]: Depends on bounded Zod and Convex error-code diagnostics, approved binding, the four Store outboxes, artifact publication and formal entity/file publishers.
 * [OUTPUT]: Claims this folder for this computer before offering a byte and stops the run for good when the server says it belongs to another, delivers deletions before uploads, runs the first Chat upload cheapest-first behind the Base-owning identities the Bases phase requires, sums the plaintext this pass delivers and every file transfer it starts into one uploaded figure, publishes a named Chat's metadata on its own fast lane, sends a Base's queued work as soon as a local commit queues it, completes recovered native body/import/Home publication through convergence and isolates entity failures within bounded lanes. U06-d: each App's build status is published as it changes and again after its surface in every pass.
 * [POS]: Main synchronization composition; an entity remains pending until every required content component is confirmed, and the byte figures belong to the initial upload alone. A pass holds at most one outbox window (2,000 rows, A-14) and counts the rest as pending.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { ZodError } from "zod";
import { ConvexError } from "convex/values";
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
import type { AccountTransport } from "../../runtime/transport/transport";
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
import { DesktopSurfacePublisher } from "../surfaces/publisher";
import type { PluginSurfaceSource } from "../surfaces/source";
import { appSurfaceSource } from "../surfaces/source";
import { AppBuildStatusPublisher } from "../app-build/publisher";
import type { AppBuildStatus } from "@ai-chat/cloud-protocol/apps/build-status/model";
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
import { forEachIsolated, smallestFirst, transferMeter, RetrySchedule } from "./schedule";
import { libraryRefusal, protocolHeader } from "@ai-chat/cloud-protocol";
import { writePublisher } from "../../../library/publisher";
import { workflowChatRoles } from "../../../chats/projection/chat-summary";
/* A whole chat is one unit of upload work; four lanes keep the latency-bound path busy without exceeding the crypto
   queue's waiting budget. Staged bytes arrive per message, so they are coalesced instead of sent one frame each. */
const CHAT_LANES = 4, FLUSH_INTERVAL = 30_000, FLUSH_CEILING = 60_000, TURN_INTERVAL = 30_000, WAKE_DELAY = 250, UPLOAD_INTERVAL = 200;
/* A pass works on the oldest window of the outbox, in id order (A-14): a large import used to put more than 10,000 rows in
   one read and fail every pass for good. Delivered rows leave the outbox, and while that count falls the next window follows at once. */
const OUTBOX_WINDOW = 2_000;
export class DesktopSyncRun {
  private readonly signal = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private turnWake: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setInterval> | null = null;
  private flight: Promise<void> | null = null;
  private closed = false;
  private readonly retry = new RetrySchedule(FLUSH_INTERVAL, FLUSH_CEILING);
  private failureDigest: string | null = null;
  /** Set once the server refuses this folder. It is the end of the run: the folder cannot change without a restart. */
  private refused = false;
  private published = false;
  private woken = false;
  private uploaded = 0;
  private uploadedAt = 0;
  private items: ChatOutboxItem[] | null = null;
  private truncated = false;
  private outboxRows = Infinity;
  private lateRetained = new Map<string, string>();
  private detachOutbox: (() => void) | null = null;
  private detachBases: (() => void) | null = null;
  private detachBaseCommits: (() => void) | null = null;
  private detachPlugins: (() => void) | null = null;
  private detachSurfaces: (() => void) | null = null;
  private detachBuildStatus: (() => void) | null = null;
  private readonly surfaceGenerations = new Map<string, string | null>();
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
  private readonly surfaces: DesktopSurfacePublisher;
  private readonly pluginSurfaces: DesktopSurfacePublisher;
  private readonly buildStatus: AppBuildStatusPublisher;
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
    /** This profile's Bottega folder and this computer's key: without both there is nothing to publish ownership of. */
    folder?: { id(): string | null; root(): string | null; machineIdHash(): Promise<string | null> };
    /** U06-d: each App's build status as the App service tracks it; null before Apps load. */
    plugins?(): PluginSurfaceSource | null;
    buildStatus?(): { status(appId: string): AppBuildStatus | null; onChange(listener: (appId: string) => void): () => void } | null;
    /** Rows one pass may hold; tests scale it down. */
    outboxWindow?: number;
    changed(value: Partial<SyncProgress>): void; dataChanged(): void }) {
    const binding = input.binding.snapshot(); if (!binding || binding.phase === "closing") throw new Error("SYNC_SCOPE_INACTIVE");
    this.scope = { environment: input.config.environmentId, userId: binding.userId }; this.manifestId = binding.manifestId;
    // Byte figures belong to the pass, measured against the consent scan; one transfer must not overwrite them with its own total.
    const transferred = transferMeter(bytes => this.reportUploaded(bytes));
    const progress = () => { const meter = transferred(); return (value: FileProgress) => { if (!this.closed) input.changed({ phase: "files" }); meter(value); }; };
    this.files = new EncryptedBlobTransfer(input.filePorts);
    this.cache = new DesktopBlobStore(input.userData, { environmentId: input.config.environmentId, deploymentId: input.config.deploymentId, userId: binding.userId }, input.filePorts);
    this.baseFiles = new BaseFilePublisher({ store: input.owners.bases, config: input.config, userId: binding.userId, files: this.files, progress });
    this.skills = input.owners.skills ? new DesktopSkillsSync({ ...input, store: input.owners.skills.library, files: this.files, current: () => this.assertCurrent(), wake: () => this.wake(), changed: () => input.owners.skills!.remountFolder() }) : null;
    this.convergence = input.recovery ? new DesktopChatConvergence({ scope: this.scope, deviceId: input.deviceId, chats: input.owners.chats,
      recovery: input.recovery, current: () => this.assertCurrent(), assertIdle: id => input.assertIdle?.(id), changed: () => { input.dataChanged(); this.woken = true; } }) : null;
    const common = { crypto: input.crypto, config: input.config, scope: this.scope, transport: input.transport, changed: () => input.dataChanged(), failure: (_id: unknown, error: unknown) => { this.fail(error); } };
    this.bases = new DesktopBaseSync({ ...common, store: input.owners.bases, files: this.baseFiles });
    this.projects = new DesktopProjectSync({ ...common, store: input.owners.projects });
    this.chats = new NativeChatInitialization({ ...common, store: input.owners.chats.sync, deviceId: input.deviceId, bytes: { ...input.bytes, files: this.files, progress: transferred },
      uploaded: bytes => this.reportUploaded(bytes) });
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
    const header = () => { const crypto = input.crypto();
      return { ...protocolHeader(input.config), expectedUserId: this.scope.userId, encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } }; };
    this.surfaces = new DesktopSurfacePublisher({ source: appSurfaceSource(input.owners.apps), userData: input.userData, scope: this.scope, transport: input.transport,
      files: this.files, crypto: input.crypto, progress, header });
    this.pluginSurfaces = new DesktopSurfacePublisher({source:{intent: async id => input.plugins?.()?.intent(id) ?? {kind:"pending"}}, userData:input.userData, scope:this.scope,transport:input.transport,files:this.files,crypto:input.crypto,progress,header});
    this.buildStatus = new AppBuildStatusPublisher({ source: { status: appId => input.buildStatus?.()?.status(appId) ?? null }, transport: input.transport,
      crypto: input.crypto, header, deviceId: input.deviceId, cloudManaged: appId => input.owners.apps.portable.isCloudManaged(appId) });
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
    if (!this.turnTimer) { this.turnTimer = setInterval(() => { if (!this.refused) void this.turns.flush().catch(() => {}); }, TURN_INTERVAL); this.turnTimer.unref(); }
    // Local commits reach the cloud on the append hook; both timers only cover retries and work this process did not enqueue itself.
    this.detachOutbox ??= this.input.owners.chats.sync.onOutboxAppended((entityKind, chatId) => this.failures.exit(() => {
      if (this.closed) return;
      this.wakeTurns();
      if (entityKind === "turn") return;
      if (chatId) this.wakeMetadata(chatId);
      this.wake();
    }));
    // TASK-22: an App whose active generation changed publishes its GUI surface on the next pass, not the next retry timer.
    this.detachPlugins ??= this.input.plugins?.()?.onChanged(() => { if (!this.closed) this.wake(); }) ?? null;
    this.detachSurfaces ??= this.input.owners.apps.watch(record => {
      const active = record.generationBinding.active?.generationId ?? null;
      if (this.surfaceGenerations.get(record.id) === active) return;
      this.surfaceGenerations.set(record.id, active); if (!this.closed) this.wake();
    });
    // U06-d: a build's status reaches the phone as it changes, not at the next pass; a failed write waits for the next change or pass.
    this.detachBuildStatus ??= this.input.buildStatus?.()?.onChange(appId => {
      if (this.closed || this.refused) return;
      void this.buildStatus.publish(appId).catch(error => console.warn("[cloud-sync] App build status not published", error instanceof Error ? error.message : String(error)));
    }) ?? null;
    // A Base the user just opened becomes live now, not at the next pass; a Base nothing shows keeps no subscription.
    // OPT-16: a local Base commit that queued cloud work sends it now; `flush` coalesces bursts and ignores unsynced Bases.
    this.detachBaseCommits ??= this.input.owners.bases.onCommitted((ownerKey, baseId) => {
      if (this.closed || this.refused) return;
      void this.bases.flush({ ownerKey, baseId }).catch(error => { this.fail(error); });
    });
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
    if (this.refused) return;
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
    if (this.closed || this.refused) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, delay); this.timer.unref();
  }
  // New work that lands mid-pass is not lost: the pass in flight may already have read past it.
  wake() { if (this.refused) return; this.retry.reset(); if (this.flight) { this.woken = true; return; } this.schedule(WAKE_DELAY); }
  private wakeTurns() {
    if (this.turnWake || this.closed || this.refused) return;
    this.turnWake = setTimeout(() => { this.turnWake = null; void this.turns.flush().catch(() => {}); }, 200);
    this.turnWake.unref();
  }
  // Per-message bytes move the row within seconds instead of once per whole Chat; the figure retires with the initial upload, never mid-way.
  private reportUploaded(bytes: number) {
    if (this.closed) return;
    this.uploaded += bytes;
    const now = Date.now(); if (now - this.uploadedAt < UPLOAD_INTERVAL) return;
    this.uploadedAt = now; this.input.changed({ uploadedBytes: this.uploaded });
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
    const items: ChatOutboxItem[] = [], window = this.input.outboxWindow ?? OUTBOX_WINDOW; let afterId: string | null = null;
    for (;;) {
      this.assertCurrent();
      const limit = Math.min(100, window - items.length);
      const result = await this.input.owners.chats.sync.read(this.scope, { type: "outbox", afterId, limit });
      if (result.type !== "outbox") throw new Error("CHAT_OUTBOX_UNAVAILABLE"); items.push(...result.value);
      if (result.value.length < limit) return items;
      if (items.length >= window) { this.truncated = true; return items; }
      afterId = result.value.at(-1)!.id;
    }
  }
  private async countOutbox() {
    const result = await this.input.owners.chats.sync.read(this.scope, { type: "outbox-count" });
    if (result.type !== "outbox-count") throw new Error("CHAT_OUTBOX_UNAVAILABLE"); return result.value;
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
    if (this.closed || this.refused) return Promise.resolve(); if (this.flight) return this.flight;
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
        codes: [...new Set(failures.all.map(failure => {
          const code = failure instanceof ConvexError && typeof failure.data === "string" ? failure.data : failure.message;
          return /^[A-Za-z0-9_-]{1,80}$/.test(code) ? code : "unclassified";
        }))].slice(0, 16),
      });
      if (!this.closed && !this.refused && value !== this.failureDigest) this.input.changed({ status: "error", error: "upload-failed" });
      this.failureDigest = value; this.retry.failed(); throw error;
    });
    this.flight = flight; this.woken = false;
    void flight.finally(() => {
      if (this.flight !== flight) return;
      this.flight = null; this.schedule(this.woken ? WAKE_DELAY : undefined); this.woken = false;
    }).catch(() => {}); return flight;
  }
  /**
   * The first thing a pass says to the server, and the only thing it says before offering content: this computer
   * holds this folder. A refusal ends the run — the folder cannot change while the process lives, so retrying it
   * would be a loop — while the record the server returns is what the marker in the folder then states.
   */
  private async publishLibrary() {
    const folder = this.input.folder, libraryId = folder?.id() ?? null, root = folder?.root() ?? null;
    if (this.published || !folder || !libraryId || !root) return;
    if (!await folder.machineIdHash()) return;
    try {
      const owner = await this.input.transport.mutate("libraries:publish", { ...protocolHeader(this.input.config),
        expectedUserId: this.scope.userId, libraryId });
      // The marker is part of publishing, not a side effect of it: a folder that could not record its owner claims again next pass.
      await writePublisher(root, { machineIdHash: owner.machineIdHash, deviceId: owner.ownerDeviceId, host: owner.host, publishedAt: owner.publishedAt });
      this.published = true;
    } catch (error) {
      const refusal = libraryRefusal(error);
      if (!refusal) throw error;
      /* Not a pass failure: nothing is wrong and nothing will become right on its own, so the row states the
         refusal once and the pass simply stops rather than reporting "some content has not synced". */
      this.refused = true;
      this.input.changed({ status: "error", error: "library-owned-elsewhere", ownerHost: refusal.host });
    }
  }
  private async deliver() {
    this.assertCurrent(); this.stale(); this.truncated = false; const { owners, binding } = this.input;
    await this.publishLibrary(); if (this.refused) return; this.assertCurrent();
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
    // The scan total measures the initial upload alone; once that is behind us there is nothing left to measure against.
    if (!initializing) this.uploaded = 0;
    const measured = initializing ? {} : { uploadedBytes: 0, totalBytes: 0 };
    if (this.failureDigest) this.input.changed({ phase: "projects", ...measured });
    else this.input.changed({ status: initializing ? "initializing" : "syncing", error: null, phase: "projects", ...measured });
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
    const capture = await owners.chats.sync.mutate(this.scope, hashCanonical(["initial-capture", this.manifestId]), { type: "capture-initial", manifestId: this.manifestId });
    this.stale();
    // A body costs two round trips and nine checkpoint reads per message, so the count the capture recorded orders the queue.
    const weight = new Map(capture.result.type === "capture-initial" ? capture.result.value.entries.map(entry => [entry.chatId, entry.messages] as const) : []);
    const initial = smallestFirst((await this.outbox()).filter(item => item.kind === "initialize"),
      item => [weight.get(chatIdOf(item)) ?? 0, item.id]);
    /* `bases/api:ensure` refuses a Chat-owned Base whose Chat is not in the cloud yet; every other Chat creates its
       identity in its own body lane, where the snapshot it decodes is the one the publication uses. */
    const baseOwned = new Set(owners.bases.listAll().flatMap(({ snapshot }) => snapshot.meta.owner.kind === "chat" ? [snapshot.meta.owner.chatId] : []));
    const prepared = initial.filter(item => baseOwned.has(chatIdOf(item)));
    if (prepared.length) {
      let ready = 0; this.input.changed({ phase: "preparing", completed: 0, total: prepared.length });
      await forEachIsolated(prepared, CHAT_LANES, async item => {
        // Retiring at once keeps the decoded snapshot out of memory until the publication phase actually needs it.
        try { this.assertCurrent(); await this.chats.createIdentity(item); } finally { this.chats.retire([item]); }
        this.input.changed({ completed: ++ready });
      }, isolate);
    }
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
    this.input.changed({ phase: "chats", completed: 0, total: initial.length });
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
        completed++; this.input.changed({ completed, uploadedBytes: this.uploaded }); return;
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
      completed++; this.input.changed({ completed, uploadedBytes: this.uploaded });
      } finally { this.chats.retire([item]); }
    }, isolate);
    if (initial.length) this.stale();
    const dirtyChats = new Set((await this.outbox()).map(chatIdOf));
    const read = await this.peripheral(() => this.downlink.flush(dirtyChats).catch(error => { this.fail(error); return { downloading: 1, waiting: 0, progressed: false }; }));
    const downloading = read.downloading;
    if (downloading && read.progressed && !this.failures.getStore()!.all.length) this.woken = true;
    this.stale();
    const queue = await this.outbox();
    const initializingChats = new Set(queue.filter(item => item.kind === "initialize").map(chatIdOf));
    const metadataChats = new Set(queue.filter(item => item.metadata_status === "queued" && !initializingChats.has(chatIdOf(item))).map(chatIdOf));
    for (const chatId of metadataChats) { this.assertCurrent(); await this.metadata.flush(chatId); }
    if (metadataChats.size) this.stale();
    /* R-35: a workflow Chat that reached the cloud without its role gets it once; a failure is retried next pass. */
    await this.metadata.repairWorkflowRoles(workflowChatRoles()).catch(error => { this.fail(error); });
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
    const surfaceApps: string[] = [];
    await forEachIsolated(appIds, 1, async appId => {
      this.assertCurrent(); this.input.changed({ phase: "apps" }); const result = await this.apps.publishPackage(appId);
      if (result === "complete") surfaceApps.push(appId);
      if (result !== "complete") appIssues.push({ appId, name: owners.apps.get(appId)?.displayName ?? owners.apps.portable.publication.get(this.scope, appId)!.operation.displayName, reason: result === "unavailable" ? "not-published" :
        owners.apps.portable.publication.get(this.scope, appId)?.publishReceipt?.reason === "atomic-migration-unavailable" ? "migration-blocked" : "version-conflict" });
    }, isolate);
    // R-26: an App's GUI surface follows its package; only Apps whose package is current in the cloud publish one.
    await this.peripheral(async () => { await forEachIsolated(surfaceApps, 1, async appId => { this.assertCurrent(); await this.surfaces.publish(appId, this.signal.signal); }, isolate); });
    await this.peripheral(async () => { await forEachIsolated(this.input.plugins?.()?.list() ?? [], 1, async plugin => {this.assertCurrent();await this.pluginSurfaces.publishSubject({kind:"plugin",id:plugin.id,ownerDeviceId:this.input.deviceId},this.signal.signal);},isolate); });
    // U06-d: and its build status, so a status that changed while this computer was offline or before this run reaches the cloud.
    await this.peripheral(async () => { await forEachIsolated(surfaceApps, 1, async appId => { this.assertCurrent(); await this.buildStatus.publish(appId); }, isolate); });
    await this.peripheral(async () => { await this.skills?.flush(this.signal.signal).catch(isolate); });
    const bases = owners.bases.listAll().map(({ ownerKey, snapshot }) => owners.bases.sync.read(ownerKey, snapshot.meta.ownerInstanceId));
    const basePending = bases.reduce((sum, base) => sum + base.pendingOperations.length + Number(base.cloudState === "local-only" && !base.tombstones.includes("base") && !base.initialIdentityRecovery), 0);
    this.assertCurrent(); const failures = this.failures.getStore()!;
    const remaining = await this.outbox(), outboxRows = this.truncated ? await this.countOutbox() : remaining.length;
    if (this.truncated && outboxRows < this.outboxRows && !failures.all.length) this.woken = true;
    this.outboxRows = this.truncated ? outboxRows : Infinity;
    const pending = outboxRows + basePending + owners.projects.list().reduce((sum, project) => sum + (project.sync?.pending.length ?? 0), 0) +
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
    /* A read superseded by a newer one (a Base whose confirmed owner moved mid-pass) is collateral: the pass still fails and
       retries, but it reports the cause behind it, so "Response lost" is not shown as "cloud-request-superseded". */
    if (failures.all.length) throw failures.all.find(error => error.message !== "cloud-request-superseded") ?? failures.all[0];
    this.input.changed({ status: pending || downloading ? binding.snapshot()!.phase === "initializing" ? "initializing" : "syncing" : appIssues.length ? "partial" : "synced", pending: pending + downloading, waiting: read.waiting, conflicts, appIssues,
      phase: null, completed, total: initial.length, ...(initializing ? { uploadedBytes: this.uploaded } : {}) });
    this.input.dataChanged();
  }
  openChat(chatId: string) { return this.downlink.open(chatId); }
  async close() {
    this.closed = true; this.signal.abort(new Error("SYNC_RUN_CLOSED")); this.detachOutbox?.(); this.detachOutbox = null;
    this.detachBases?.(); this.detachBases = null; this.detachBaseCommits?.(); this.detachBaseCommits = null;
    this.detachPlugins?.(); this.detachPlugins = null; this.detachSurfaces?.(); this.detachSurfaces = null; this.detachBuildStatus?.(); this.detachBuildStatus = null; if (this.timer) clearTimeout(this.timer);
    if (this.turnWake) clearTimeout(this.turnWake);
    if (this.turnTimer) clearInterval(this.turnTimer); await Promise.all([this.turns.close(), this.downlink.close()]);
    await Promise.all([this.chats.close(), this.metadata.close(), this.apps.close(), this.baseFiles.close(), this.files.close(), this.cache.close()]);
    await Promise.all([this.bases.close(), this.projects.close()]); await this.flight?.catch(() => {}); await this.skills?.close();
  }
}
