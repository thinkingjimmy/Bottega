/**
 * [INPUT]: Depends on Electron IPC, Project/Chat queries, strict turn options, four history adapters, Project/Memory coordinators, index/snapshot stores, and shared contracts
 * [OUTPUT]: Provides detection/refresh, stable identity, abortable paged/revision-fenced full-index transcripts, consumer-aware bounded parse single-flight, adoption, source-quality projection, search/export, presentation, Memory, and drain APIs
 * [POS]: The canonical federated history owner and renderer-safe authority boundary
 */

import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import type { BrowserWindow } from "electron";
import { z } from "zod";
import {
  HISTORY_IMPORT_CHANNEL,
  HISTORY_SOURCE_KINDS,
  sessionAliases,
  type HistorySourceKind,
  type ForeignHistoryBlock,
  type ForeignHistoryTranscript,
  type HistoryImportEvent,
  type HistoryImportSnapshot,
  type ForeignHistorySummary,
  type HistoryAdoptionPrefix,
  type HistoryMemoryPreview,
  type HistoryFileFingerprint,
  type PrepareHistoryAdoptionInput,
  type ProjectHistoryImportState,
} from "../../../shared/history-import-ipc";
import { SECTION_EXPORT_BYTE_LIMIT } from "../../../shared/agent-ipc";
import type { Project } from "../../../shared/projects-ipc";
import { rendererIpc } from "../ipc-registrar";
import {
  validateAgentTurnOptions,
  validateHistoryAdoptionSubmission,
} from "../agent-payload-validation";
import type { ProductHistoryIntent } from "../memory/orchestration/consent-controller";
import { isWithin, sameFingerprint, sourceCount, type AdapterEntry, type AdapterScan, type HistoryAdapter, type ParsedHistory, type ScanDepth } from "./adapter";
import { ClaudeHistoryAdapter } from "./claude-adapter";
import { CodexHistoryAdapter } from "./codex-adapter";
import { KimiHistoryAdapter } from "./kimi-adapter";
import { OpencodeHistoryAdapter } from "./opencode-adapter";
import { HistoryImportIndexStore, type StoredHistoryProject } from "./index-store";
import {
  HistorySnapshotStore,
  type AdoptionSnapshot,
  type MemorySourceSnapshot,
} from "./memory-snapshot-store";
import { ProjectImportCoordinator } from "./project-import-coordinator";
import { MemoryGrantCoordinator } from "./memory-grant-coordinator";
import type { HistoryMemoryAuthorization } from "./memory-grant-coordinator";

const PAGE_SIZE = 200;
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const transcriptIndexRequestSchema = z.object({
  opaqueId: idSchema,
  expectedHistoryRevision: z.string().min(1),
  requestId: idSchema,
}).strict();
const transcriptPageRequestSchema = z.object({
  opaqueId: idSchema,
  cursor: z.string().optional(),
  requestId: idSchema,
}).strict();

type ParseFlight = {
  controller: AbortController;
  consumers: Set<symbol>;
  promise: Promise<ParsedHistory>;
  settled: boolean;
};

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error("History transcript request aborted"), {
        name: "AbortError",
      });
}

type ProjectRef = Pick<Project, "id" | "dir" | "membershipRevision" | "workspaceBinding" | "archivedAt">;

export type HistoryImportServiceOptions = {
  home: string;
  listProjects(): ProjectRef[];
  getProject(projectId: string): ProjectRef | undefined;
  prepareProject(): Promise<{ canonicalRoot: string; name: string } | null>;
  commitProject(input: { canonicalRoot: string; name: string }): Promise<{ project: Project; created: boolean }>;
  listSessionBindings(): Array<{
    chatId?: string;
    session: { backend: string; id: string };
    importOrigin?: { adoptionSnapshotId: string } | null;
    snapshotDigest?: string | null;
  }>;
  memoryState(): HistoryMemoryAuthorization;
  adopt?(input: {
    request: PrepareHistoryAdoptionInput;
    entry: AdapterEntry;
    snapshot: AdoptionSnapshot;
  }): Promise<{ chatId: string; incarnationId: string; phase: "started" | "queued" | "settled" }>;
  commitMemory?(input: {
    grantId: string;
    snapshots: MemorySourceSnapshot[];
    authorization: HistoryMemoryAuthorization;
  }): Promise<Array<{ source: string; deliverySeq: number; contentDigest: string; normalizedPrefixDigest: string }>>;
  previewProductMemory?(): Promise<{
    digest: string;
    chats: number;
    turns: number;
    from: number | null;
    to: number | null;
    intent: ProductHistoryIntent;
  }>;
  commitProductMemory?(grantId: string, intent: ProductHistoryIntent): Promise<void>;
  productMemoryCommitted?(grantId: string): boolean;
  getAdoptionBinding?(chatId: string): { snapshotId: string; digest: string } | null;
};

export type SearchableHistoryEntry = Readonly<{
  opaqueId: string;
  projectId: string;
  sourceKind: HistorySourceKind;
  title: string;
  updatedAt: number;
  historyRevision: string;
  fingerprint: HistoryFileFingerprint;
  archived: boolean;
  policySearchable: boolean;
  claimed: null | {
    chatId: string;
    adopted: boolean;
    adoptionSnapshotId?: string;
    snapshotDigest?: string;
  };
}>;

export class HistoryImportService {
  readonly index: HistoryImportIndexStore;
  readonly snapshots: HistorySnapshotStore;
  private readonly adapters: HistoryAdapter[];
  private readonly projectImports: ProjectImportCoordinator;
  private readonly memory: MemoryGrantCoordinator;
  private window: BrowserWindow | null = null;
  private warning: string | null = null;
  private detecting = new Set<string>();
  private refreshing = new Set<string>();
  private readonly parseCache = new Map<string, ParseFlight>();
  private readonly transcriptRequests = new Map<string, AbortController>();

  constructor(userData: string, private readonly options: HistoryImportServiceOptions, adapters?: HistoryAdapter[]) {
    this.index = new HistoryImportIndexStore(userData);
    this.snapshots = new HistorySnapshotStore(userData);
    this.adapters = adapters ?? [
      new ClaudeHistoryAdapter(options.home),
      new CodexHistoryAdapter(options.home),
      new KimiHistoryAdapter(options.home),
      new OpencodeHistoryAdapter(options.home),
    ];
    this.projectImports = new ProjectImportCoordinator({
      select: options.prepareProject,
      count: async (root) => (await this.scan(root, "identity")).map(sourceCount),
      commit: options.commitProject,
    });
    this.memory = new MemoryGrantCoordinator(this.snapshots, {
      state: options.memoryState,
      historyEligibility: (projectId) => {
        const stored = this.index.project(projectId);
        return stored?.enabled && this.validBinding(stored)
          ? `${stored.membershipRevision}:${stored.eligibilityRevision}`
          : null;
      },
      visibleEntries: () => this.snapshot().entries,
      materialize: async (opaqueId) => {
        const entry = this.findEntry(opaqueId);
        if (!entry) throw new Error("历史会话不存在");
        const adapter = this.adapters.find((candidate) => candidate.sourceKind === entry.sourceKind);
        if (!adapter) throw new Error("历史来源 adapter 不存在");
        return { entry, blocks: (await this.parseEntry(entry)).blocks, parserVersion: adapter.parserVersion };
      },
      commitForeign: options.commitMemory,
      previewProduct: options.previewProductMemory,
      commitProduct: options.commitProductMemory,
      productCommitted: options.productMemoryCommitted,
      deliveryChanged: () => this.publish(),
      deliveryFailed: (cause) => this.setWarning(cause),
    });
  }

  async initialize() {
    await Promise.all([this.index.initialize(), this.snapshots.initialize()]);
    await this.index.removeMissing(new Set(this.options.listProjects().map((project) => project.id)));
    await this.memory.reconcile();
    setImmediate(() => void this.detectAll().catch((cause) => this.setWarning(cause)));
  }

  register(window: BrowserWindow, rendererUrl: string) {
    this.window = window;
    const ipc = rendererIpc(window, rendererUrl, "拒绝非主窗口的历史导入请求")
      .roles("main");
    ipc
      .handle(HISTORY_IMPORT_CHANNEL.snapshot, () => this.snapshot())
      .handle(HISTORY_IMPORT_CHANNEL.prepareProject, () => this.prepareProject())
      .handle(HISTORY_IMPORT_CHANNEL.countProject, (token) => this.projectImports.counts(z.string().min(1).parse(token)))
      .handle(HISTORY_IMPORT_CHANNEL.commitProject, (raw) => this.commitProject(parseCommit(raw)))
      .handle(HISTORY_IMPORT_CHANNEL.setProjectEnabled, (projectId, enabled) => this.setProjectEnabled(idSchema.parse(projectId), z.boolean().parse(enabled)))
      .handle(HISTORY_IMPORT_CHANNEL.refreshProject, (projectId) => this.refreshProjectForUser(idSchema.parse(projectId)))
      .handle(HISTORY_IMPORT_CHANNEL.renameSession, (opaqueId, title) => this.renameSession(idSchema.parse(opaqueId), z.string().trim().min(1).max(200).parse(title)))
      .handle(HISTORY_IMPORT_CHANNEL.setSessionArchived, (opaqueId, archived) => this.setSessionArchived(idSchema.parse(opaqueId), z.boolean().parse(archived)))
      .handle(HISTORY_IMPORT_CHANNEL.transcript, (raw) => {
        const request = transcriptPageRequestSchema.parse(raw);
        return this.withTranscriptRequest(request.requestId, (signal) =>
          this.transcript(request.opaqueId, request.cursor, signal));
      })
      .handle(HISTORY_IMPORT_CHANNEL.transcriptIndex, async (raw) => {
        const request = transcriptIndexRequestSchema.parse(raw);
        return this.withTranscriptRequest(request.requestId, (signal) =>
          this.transcriptIndex(request.opaqueId, request.expectedHistoryRevision, signal));
      })
      .handle(HISTORY_IMPORT_CHANNEL.adopt, (raw) => this.adopt(parseAdopt(raw)))
      .handle(HISTORY_IMPORT_CHANNEL.adoptionPrefix, (chatId) => this.adoptionPrefix(idSchema.parse(chatId)))
      .handle(HISTORY_IMPORT_CHANNEL.memoryEligibility, (raw) => {
        const input = z.object({ surface: z.enum(["project", "settings"]), projectId: idSchema.optional() }).strict().parse(raw);
        return this.memoryEligibility(input);
      })
      .handle(HISTORY_IMPORT_CHANNEL.memoryPreview, (raw) => this.memoryPreview(parseMemoryPreview(raw)))
      .handle(HISTORY_IMPORT_CHANNEL.memoryCommit, (snapshotId, digest) => this.memoryCommit(idSchema.parse(snapshotId), z.string().regex(/^[a-f0-9]{64}$/).parse(digest)))
      .on(HISTORY_IMPORT_CHANNEL.cancelTranscript, (rawRequestId) => {
        const requestId = idSchema.safeParse(rawRequestId);
        if (requestId.success) this.transcriptRequests.get(requestId.data)?.abort();
      });
    window.once("closed", () => {
      if (this.window === window) this.window = null;
      for (const controller of this.transcriptRequests.values()) {
        controller.abort();
      }
      this.transcriptRequests.clear();
    });
  }

  private async withTranscriptRequest<T>(
    requestId: string,
    run: (signal: AbortSignal) => Promise<T>
  ) {
    if (this.transcriptRequests.has(requestId)) throw new Error("HISTORY_TRANSCRIPT_REQUEST_EXISTS");
    const controller = new AbortController();
    this.transcriptRequests.set(requestId, controller);
    try { return await run(controller.signal); }
    finally { this.transcriptRequests.delete(requestId); }
  }

  snapshot(): HistoryImportSnapshot {
    const state = this.index.snapshot();
    const claimed = this.claimedAliases();
    return {
      revision: state.revision,
      entries: Object.values(state.projects).flatMap((project) =>
        project.enabled && this.validBinding(project)
          ? project.entries.filter((entry) => !aliasesClaimed(entry, claimed)).map((entry) => this.presentEntry(entry))
          : []
      ),
      projects: Object.values(state.projects).map((project) => this.projectState(project)),
      memoryDelivering: this.memory.delivering(),
      warning: this.warning,
    };
  }

  /** SearchJob 只冻结 KB 级元数据；正文必须在 pull 时经下面两条窄门面取。 */
  listSearchableEntries(): SearchableHistoryEntry[] {
    const bindings = this.options.listSessionBindings();
    return Object.values(this.index.snapshot().projects).flatMap((project) =>
      project.entries.map((entry) => {
        const aliases = sessionAliases(entry.key);
        const binding = bindings.find(
          (candidate) =>
            candidate.session.backend === entry.sourceKind &&
            aliases.has(candidate.session.id)
        );
        const summary = this.presentEntry(entry);
        const adopted = Boolean(binding?.importOrigin?.adoptionSnapshotId && binding.snapshotDigest);
        return {
          opaqueId: entry.opaqueId,
          projectId: entry.projectId,
          sourceKind: entry.sourceKind,
          title: summary.title,
          updatedAt: entry.updatedAt,
          historyRevision: entry.historyRevision,
          fingerprint: structuredClone(entry.fingerprint),
          archived: summary.archived,
          policySearchable: Boolean(project.enabled && this.validBinding(project)),
          claimed: binding
            ? {
                chatId: binding.chatId ?? "",
                adopted,
                ...(adopted
                  ? {
                      adoptionSnapshotId: binding.importOrigin!.adoptionSnapshotId,
                      snapshotDigest: binding.snapshotDigest!,
                    }
                  : {}),
              }
            : null,
        };
      })
    );
  }

  private parseEntry(
    entry: AdapterEntry,
    signal?: AbortSignal
  ): Promise<ParsedHistory> {
    const key = `${entry.sourceKind}:${entry.opaqueId}:${entry.historyRevision}`;
    let flight = this.parseCache.get(key);
    if (flight) {
      this.parseCache.delete(key);
      this.parseCache.set(key, flight);
    } else {
      const adapter = this.adapters.find(
        (candidate) => candidate.sourceKind === entry.sourceKind
      );
      if (!adapter) return Promise.reject(new Error("历史来源 adapter 不存在"));
      const controller = new AbortController();
      flight = {
        controller,
        consumers: new Set(),
        promise: Promise.resolve({ blocks: [], incompleteTail: false }),
        settled: false,
      };
      const owner = flight;
      owner.promise = adapter.parse(entry, controller.signal).then(
        (parsed) => {
          owner.settled = true;
          return parsed;
        },
        (cause) => {
          owner.settled = true;
          if (this.parseCache.get(key) === owner) this.parseCache.delete(key);
          throw cause;
        }
      );
      this.parseCache.set(key, owner);
    }
    while (this.parseCache.size > 8) {
      const oldest = this.parseCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.parseCache.delete(oldest);
    }
    const consumer = Symbol(key);
    flight.consumers.add(consumer);
    return new Promise<ParsedHistory>((resolve, reject) => {
      let complete = false;
      const release = () => {
        signal?.removeEventListener("abort", abort);
        flight!.consumers.delete(consumer);
        if (!flight!.settled && flight!.consumers.size === 0) {
          if (this.parseCache.get(key) === flight) this.parseCache.delete(key);
          flight!.controller.abort();
        }
      };
      const settle = (callback: () => void) => {
        if (complete) return;
        complete = true;
        release();
        callback();
      };
      const abort = () => settle(() => reject(abortReason(signal!)));
      flight!.promise.then(
        (parsed) => settle(() => resolve(parsed)),
        (cause) => settle(() => reject(cause))
      );
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  async parseTranscriptForSearch(
    opaqueId: string,
    expected: { fingerprint: HistoryFileFingerprint; historyRevision: string },
    signal: AbortSignal
  ) {
    signal.throwIfAborted();
    const entry = this.findEntry(opaqueId);
    if (!entry || entry.historyRevision !== expected.historyRevision || !sameFingerprint(entry.fingerprint, expected.fingerprint)) {
      throw Object.assign(new Error("历史会话已变化"), { code: "HISTORY_REVISION_CHANGED" });
    }
    const adapter = this.adapters.find((candidate) => candidate.sourceKind === entry.sourceKind);
    if (!adapter) throw new Error("历史来源 adapter 不存在");
    const parsed = await this.parseEntry(entry, signal);
    signal.throwIfAborted();
    const current = this.findEntry(opaqueId);
    if (!current || current.historyRevision !== expected.historyRevision || !sameFingerprint(current.fingerprint, expected.fingerprint)) {
      throw Object.assign(new Error("历史会话已变化"), { code: "HISTORY_REVISION_CHANGED" });
    }
    return parsed.blocks;
  }

  async readAdoptionSnapshotForSearch(snapshotId: string, expectedDigest: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const snapshot = await this.snapshots.readAdoption(snapshotId, signal);
    signal.throwIfAborted();
    if (snapshot.digest !== expectedDigest) throw new Error("收养快照 digest 不一致");
    return snapshot.blocks as ForeignHistoryBlock[];
  }

  async prepareProject() {
    return this.projectImports.prepare();
  }

  async commitProject(input: { token: string; importHistory: boolean; previewMemory: boolean }) {
    const { result, prepared } = await this.projectImports.commit(input.token);
    const { project } = result;
    if (!result.created) return { project, memoryPreview: null };
    const memoryImportIntent = input.importHistory && input.previewMemory;
    await this.index.setEnabled({ projectId: project.id, canonicalRoot: prepared.canonicalRoot, membershipRevision: project.membershipRevision, enabled: input.importHistory });
    await this.index.setMemoryImportIntent(project.id, memoryImportIntent);
    let memoryPreview: HistoryMemoryPreview | null = null;
    if (input.importHistory) {
      await this.refreshProject(project.id);
      if (memoryImportIntent) {
        const preview = await this.memoryPreview({ projectId: project.id, includeProductChats: false });
        if (preview.turns > 0) memoryPreview = preview;
        else this.memory.discard(preview.snapshotId);
      }
    }
    this.publish();
    return { project, memoryPreview };
  }

  async setProjectEnabled(projectId: string, enabled: boolean) {
    const project = this.requireExternalProject(projectId);
    await this.index.setEnabled({ projectId, canonicalRoot: project.dir, membershipRevision: project.membershipRevision, enabled });
    if (enabled && !this.index.project(projectId)?.entries.length) await this.refreshProject(projectId);
    this.publish();
  }

  /* ── 产品侧会话呈现动作：改名与归档都只写 sessionPrefs overlay ────
   * CLI 源文件只读是铁律；这两个动作因此天然是视图状态，刷新扫描
   * 整体替换 entries 也冲不掉。 */
  async renameSession(opaqueId: string, title: string) {
    if (!this.findEntry(opaqueId)) throw new Error("历史会话不存在");
    await this.index.renameSession(opaqueId, title);
    this.publish();
  }

  async setSessionArchived(opaqueId: string, archived: boolean) {
    if (!this.findEntry(opaqueId)) throw new Error("历史会话不存在");
    await this.index.setSessionArchived(opaqueId, archived);
    this.publish();
  }

  /** wire 投影唯一出口：sessionPrefs 的 title override 与产品侧归档在此合成。 */
  private presentEntry(entry: AdapterEntry): ForeignHistorySummary {
    const pref = this.index.sessionPref(entry.opaqueId);
    const summary = publicEntry(entry);
    return {
      ...summary,
      title: pref?.title ?? summary.title,
      archived: summary.archived || Boolean(pref?.archivedAt),
      productArchivedAt: pref?.archivedAt ?? null,
    };
  }

  async detectAll() {
    for (const project of this.options.listProjects()) {
      if (project.workspaceBinding.kind !== "external" || project.archivedAt) continue;
      const stored = this.index.project(project.id);
      if (!stored?.enabled) continue;
      await this.detectProject(project.id).catch((cause) => this.setWarning(cause));
    }
  }

  async detectProject(projectId: string) {
    const project = this.requireExternalProject(projectId);
    this.detecting.add(projectId); this.publish();
    try {
      const scans = this.stabilizeIncarnations(
        await this.scanOwned(project, "identity"),
        this.index.project(projectId)?.entries ?? []
      );
      const entries = scans.flatMap((scan) => scan.entries);
      const current = this.index.project(projectId);
      const hasChanges = historiesChanged(current?.entries ?? [], entries) || current?.membershipRevision !== project.membershipRevision;
      await this.index.markDetected(projectId, {
        hasChanges,
        counts: scans.map(sourceCount),
        fingerprints: Object.fromEntries(entries.map((entry) => [entry.sourcePath, entry.fingerprint])),
      });
      return this.projectState(this.index.project(projectId)!);
    } finally { this.detecting.delete(projectId); this.publish(); }
  }

  async refreshProject(projectId: string) {
    const project = this.requireExternalProject(projectId);
    this.refreshing.add(projectId); this.publish();
    try {
      const scans = this.stabilizeIncarnations(
        await this.scanOwned(project, "full"),
        this.index.project(projectId)?.entries ?? []
      );
      await this.index.publish({
        projectId, canonicalRoot: project.dir, membershipRevision: project.membershipRevision,
        counts: scans.map(sourceCount), sourceRevisions: revisions(scans), entries: scans.flatMap((scan) => scan.entries),
      });
      const state = this.projectState(this.index.project(projectId)!);
      this.publish({ type: "project", project: state });
      return state;
    } finally { this.refreshing.delete(projectId); this.publish(); }
  }

  async refreshProjectForUser(projectId: string) {
    const project = await this.refreshProject(projectId);
    const preview = project.memoryImportIntent
      ? await this.memoryPreview({ projectId, includeProductChats: false })
      : null;
    if (preview && preview.turns === 0) this.memory.discard(preview.snapshotId);
    return {
      project,
      memoryPreview: preview && preview.turns > 0 ? preview : null,
    };
  }

  async transcript(opaqueId: string, cursor?: string, signal?: AbortSignal): Promise<ForeignHistoryTranscript> {
    signal?.throwIfAborted();
    const entry = this.requireVisibleEntry(opaqueId);
    const parsed = await this.parseEntry(entry, signal);
    signal?.throwIfAborted();
    const offset = decodeCursor(cursor, entry.historyRevision);
    const blocks = parsed.blocks.slice(offset, offset + PAGE_SIZE);
    const next = offset + blocks.length;
    return {
      summary: { ...this.presentEntry(entry), incompleteTail: parsed.incompleteTail }, blocks,
      revision: entry.historyRevision,
      nextCursor: next < parsed.blocks.length ? encodeCursor(entry.historyRevision, next) : null,
    };
  }

  async transcriptIndex(
    opaqueId: string,
    expectedHistoryRevision: string,
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    const entry = this.requireVisibleEntry(opaqueId);
    if (entry.historyRevision !== expectedHistoryRevision) {
      throw Object.assign(new Error("历史会话已变化"), {
        code: "HISTORY_REVISION_CHANGED",
      });
    }
    const parsed = await this.parseEntry(entry, signal);
    signal?.throwIfAborted();
    return {
      revision: entry.historyRevision,
      blocks: parsed.blocks,
      incompleteTail: parsed.incompleteTail,
    };
  }

  /** @ 引用的整段转录物化：与 Section 快照同一字节预算，尾部优先保留。 */
  async exportTranscript(opaqueId: string): Promise<{ title: string; transcript: string } | null> {
    let entry; try { entry = this.requireVisibleEntry(opaqueId); } catch { return null; }
    const parsed = await this.parseEntry(entry);
    const summary = this.presentEntry(entry);
    return { title: summary.title, transcript: foreignTranscriptSnapshot(summary.title, parsed.blocks) };
  }

  async adopt(request: PrepareHistoryAdoptionInput) {
    /* 进程内调用者同样不被信任：这一句与 parseAdopt 重复，是因为两条入口
       的可信度不同，而校验的成本可以忽略。 */
    request = {
      ...request,
      submission: validateHistoryAdoptionSubmission(request.submission),
      turnOptions: validateAgentTurnOptions(request.turnOptions),
    };
    const entry = this.requireVisibleEntry(request.opaqueId);
    if (entry.historyRevision !== request.expectedHistoryRevision) throw Object.assign(new Error("历史会话已变化，请刷新后重试"), { code: "HISTORY_REVISION_CHANGED" });
    if (!entry.canResume || !this.options.adopt) throw new Error("该来源尚未通过产品内续聊实测");
    const project = this.requireExternalProject(entry.projectId);
    const stored = this.index.project(project.id);
    if (!stored || stored.membershipRevision !== project.membershipRevision) throw new Error("PROJECT_REVISION_CHANGED");
    const adapter = this.adapters.find((candidate) => candidate.sourceKind === entry.sourceKind)!;
    const parsed = await this.parseEntry(entry);
    const snapshot = await this.snapshots.writeAdoption({
      summary: this.presentEntry(entry), sourcePath: entry.sourcePath, blocks: parsed.blocks, parserVersion: adapter.parserVersion,
      fingerprint: { size: entry.fingerprint.size, mtimeNs: entry.fingerprint.mtimeNs },
      incompleteTail: parsed.incompleteTail,
    });
    const receipt = await this.options.adopt({ request, entry, snapshot });
    this.publish();
    return receipt;
  }

  async adoptionPrefix(chatId: string): Promise<HistoryAdoptionPrefix | null> {
    const binding = this.options.getAdoptionBinding?.(chatId);
    if (!binding) return null;
    const snapshot = await this.snapshots.readAdoption(binding.snapshotId);
    if (snapshot.digest !== binding.digest) throw new Error("收养快照 digest 与 Chat 账本不一致");
    let sourceStatus: HistoryAdoptionPrefix["sourceStatus"] = "match";
    try {
      const current = await stat(snapshot.sourcePath, { bigint: true });
      if (
        Number(current.size) !== snapshot.fingerprint.size ||
        String(current.mtimeNs) !== snapshot.fingerprint.mtimeNs
      ) sourceStatus = "changed";
    } catch (cause) {
      sourceStatus = (cause as NodeJS.ErrnoException).code === "ENOENT"
        ? "missing"
        : "changed";
    }
    return {
      snapshotId: snapshot.snapshotId,
      digest: snapshot.digest,
      contentGenerationKey: snapshot.snapshotId,
      routeGenerationKey: snapshot.historyRevision,
      title: snapshot.title,
      blocks: snapshot.blocks as import("../../../shared/history-import-ipc").ForeignHistoryBlock[],
      incompleteTail: snapshot.schemaVersion === 2
        ? snapshot.incompleteTail
        : "unknown",
      sourceStatus,
    };
  }

  memoryEligibility(input: { surface: "project" | "settings"; projectId?: string }) {
    return this.memory.eligibility(input);
  }

  memoryPreview(input: { projectId?: string; includeProductChats: boolean }) {
    return this.memory.preview(input);
  }

  memoryCommit(snapshotId: string, digest: string) {
    return this.memory.commit(snapshotId, digest);
  }

  /** 等已受理的 Memory 交付泵收尾。测试断言与诊断用；退出不等它——
      中断即 interruptedGrant 一等状态，由重新预览收口。 */
  memoryDeliverySettled() {
    return this.memory.settled();
  }

  async closeAndFlush() {
    for (const controller of this.transcriptRequests.values()) {
      controller.abort();
    }
    this.transcriptRequests.clear();
    await Promise.all([
      this.index.closeAndFlush(),
      this.snapshots.closeAndFlush(),
    ]);
  }

  private async scan(root: string, depth: ScanDepth) { return Promise.all(this.adapters.map((adapter) => adapter.scanProject(root, depth))); }
  private async scanOwned(project: ProjectRef, depth: ScanDepth) {
    const scans = await this.scan(project.dir, depth);
    const roots = this.options.listProjects().filter((candidate) => candidate.workspaceBinding.kind === "external" && !candidate.archivedAt);
    return scans.map((scan) => ({ ...scan, entries: scan.entries.filter((entry) => deepestOwner(entry.cwd, roots)?.id === project.id) }));
  }
  private stabilizeIncarnations(scans: AdapterScan[], previous: AdapterEntry[]) {
    const before = new Map(previous.map((entry) => [entry.sourcePath, entry]));
    return scans.map((scan) => ({
      ...scan,
      entries: scan.entries.map((entry) => {
        const prior = before.get(entry.sourcePath);
        const state = historyFileState(prior?.fingerprint, entry.fingerprint);
        if (prior && (state === "append" || state === "unchanged" || state === "archive")) {
          return { ...entry, sourceIncarnation: prior.sourceIncarnation };
        }
        return {
          ...entry,
          sourceIncarnation: createHash("sha256")
            .update(`${entry.sourceIncarnation}\0${entry.historyRevision}`)
            .digest("hex"),
        };
      }),
    }));
  }
  private requireExternalProject(projectId: string) {
    const project = this.options.getProject(projectId);
    if (!project || project.archivedAt || project.workspaceBinding.kind !== "external") throw new Error("Project 不存在、已归档或不具备外源导入资格");
    return project;
  }
  private validBinding(stored: StoredHistoryProject) {
    const project = this.options.getProject(stored.projectId);
    return Boolean(project && !project.archivedAt && project.workspaceBinding.kind === "external" && project.membershipRevision === stored.membershipRevision && project.dir === stored.canonicalRoot);
  }
  private findEntry(opaqueId: string) { return Object.values(this.index.snapshot().projects).flatMap((project) => project.entries).find((entry) => entry.opaqueId === opaqueId); }
  private requireVisibleEntry(opaqueId: string) {
    const entry = this.findEntry(opaqueId);
    const project = entry ? this.index.project(entry.projectId) : undefined;
    if (!entry || !project?.enabled || !this.validBinding(project) || aliasesClaimed(entry, this.claimedAliases())) throw new Error("历史会话不存在或已由产品 Chat 收养");
    return entry;
  }
  private claimedAliases() {
    const claimed = new Set<string>();
    for (const binding of this.options.listSessionBindings()) claimed.add(`${binding.session.backend}:${binding.session.id}`);
    return claimed;
  }
  private projectState(project: StoredHistoryProject): ProjectHistoryImportState {
    return { projectId: project.projectId, enabled: project.enabled, memoryImportIntent: project.memoryImportIntent, detecting: this.detecting.has(project.projectId), refreshing: this.refreshing.has(project.projectId), delivering: this.memory.deliveringProjects().has(project.projectId), hasChanges: project.hasChanges, generation: project.generation, counts: project.counts };
  }
  private publish(event?: HistoryImportEvent) {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    window.webContents.send(HISTORY_IMPORT_CHANNEL.event, event ?? { type: "snapshot", snapshot: this.snapshot() });
  }
  private setWarning(cause: unknown) { this.warning = cause instanceof Error ? cause.message : String(cause); this.publish(); }
}

export function historyFileState(previous: import("../../../shared/history-import-ipc").HistoryFileFingerprint | undefined, next: import("../../../shared/history-import-ipc").HistoryFileFingerprint | undefined, movedToArchive = false) {
  if (!previous) return next ? "new" : "unchanged";
  if (!next) return "delete";
  if (movedToArchive) return "archive";
  if (previous.device !== next.device || previous.inode !== next.inode) return "replace";
  if (next.size < previous.size) return "truncate";
  if (next.size > previous.size) return "append";
  return sameFingerprint(previous, next) ? "unchanged" : "replace";
}

function historiesChanged(previous: AdapterEntry[], next: AdapterEntry[]) {
  const before = new Map(previous.map((entry) => [entry.sourcePath, entry.fingerprint]));
  const after = new Map(next.map((entry) => [entry.sourcePath, entry.fingerprint]));
  if (before.size !== after.size) return true;
  return [...after].some(([path, fingerprint]) => historyFileState(before.get(path), fingerprint) !== "unchanged");
}
function deepestOwner(cwd: string, projects: ProjectRef[]) { return projects.filter((project) => project.dir && isWithin(project.dir, cwd)).sort((left, right) => right.dir.length - left.dir.length || left.id.localeCompare(right.id))[0]; }
function revisions(scans: AdapterScan[]): Record<HistorySourceKind, string> { return Object.fromEntries(HISTORY_SOURCE_KINDS.map((kind) => [kind, scans.find((scan) => scan.sourceKind === kind)?.sourceRevision ?? "missing"])) as Record<HistorySourceKind, string>; }
function aliasesClaimed(entry: AdapterEntry, claimed: ReadonlySet<string>) { return [...sessionAliases(entry.key)].some((alias) => claimed.has(`${entry.sourceKind}:${alias}`)); }
function publicEntry(entry: AdapterEntry) { const { sourcePath: _sourcePath, fingerprint: _fingerprint, sourceIncarnation: _sourceIncarnation, ...summary } = entry; return summary; }

function encodeCursor(revision: string, offset: number) { return Buffer.from(JSON.stringify({ v: 1, revision, offset })).toString("base64url"); }
function decodeCursor(cursor: string | undefined, revision: string) { if (!cursor) return 0; try { const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { v?: unknown; revision?: unknown; offset?: unknown }; if (value.v !== 1 || value.revision !== revision || !Number.isSafeInteger(value.offset) || Number(value.offset) < 0) throw new Error(); return Number(value.offset); } catch { throw new Error("历史分页 cursor 与当前 revision 不匹配"); } }
function parseCommit(value: unknown) { return z.object({ token: z.string().min(1), importHistory: z.boolean(), previewMemory: z.boolean() }).strict().parse(value); }
function parseAdopt(value: unknown): PrepareHistoryAdoptionInput {
  const parsed = z.object({ opaqueId: idSchema, expectedHistoryRevision: z.string().min(1), submission: z.unknown(), turnOptions: z.unknown() }).strict().parse(value);
  /* 正文/附件/RichValue 三者的跨字段同构交给 manual route 那一套断言，
     此处不另写一份——两份校验必然有一份先松掉，而松掉的那份就是偏门。 */
  return {
    ...parsed,
    submission: validateHistoryAdoptionSubmission(parsed.submission),
    turnOptions: validateAgentTurnOptions(parsed.turnOptions),
  };
}
function parseMemoryPreview(value: unknown) { return z.object({ projectId: idSchema.optional(), includeProductChats: z.boolean() }).strict().parse(value); }

/* ── @ 引用转录快照：user/assistant 正文 + 工具一行痕迹，尾部优先 ────
 * 与 Section 快照同一 256KB 预算：超限时丢最早的轮次，保留最近内容。 */
function foreignTranscriptSnapshot(title: string, blocks: readonly ForeignHistoryBlock[]) {
  const chunks: string[] = [];
  for (const block of blocks) {
    if (block.kind !== "message") continue;
    const lines = [`${block.role}: ${block.content}`];
    for (const tool of block.tools ?? []) lines.push(`  [tool:${tool.name}]`);
    chunks.push(lines.join("\n"));
  }
  const header = `# ${title}\n\n`;
  let bodyChunks = [...chunks];
  let body = bodyChunks.join("\n\n");
  const budget = SECTION_EXPORT_BYTE_LIMIT - Buffer.byteLength(header, "utf8");
  while (bodyChunks.length > 1 && Buffer.byteLength(body, "utf8") > budget) {
    bodyChunks = bodyChunks.slice(1);
    body = `[已按字节预算截断，仅保留最近内容]\n\n${bodyChunks.join("\n\n")}`;
  }
  if (Buffer.byteLength(body, "utf8") > budget) body = Buffer.from(body, "utf8").subarray(0, Math.max(0, budget)).toString("utf8");
  return `${header}${body}`;
}
