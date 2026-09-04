/**
 * [INPUT]: Depends on Electron IPC, Project/Chat queries, strict turn options, four history adapters, the dedicated import worker, Project/Memory coordinators, index/snapshot stores, and shared contracts
 * [OUTPUT]: Provides detection/refresh with a warning that reflects only the latest sync attempt (a successful refresh or a fresh background run retires the previous complaint), Project-ownership stamping at the scan seam (adapters report no projectId), stable identity, a separately scheduled off-main backpressured SQLite sync that skips adopted sources, forgets dangling routes, and marks vanished/returned sources missing/match within the scanned Project scope, canonical generation routing, registration-time snapshot republication, adoption, transcript export/search reads, Memory, and drain APIs
 * [POS]: Canonical federated history and renderer-safe authority boundary; production SQLite ingestion parses outside main
 */

import { createHash } from "node:crypto";
import type { BrowserWindow } from "electron";
import { z } from "zod";
import {
  HISTORY_IMPORT_CHANNEL,
  type ForeignHistoryMessage,
  type HistoryImportEvent,
  type HistoryImportSnapshot,
  type ForeignHistorySummary,
  type HistoryMemoryPreview,
  type PrepareHistoryAdoptionInput,
  type ProjectHistoryImportState,
} from "../../../shared/history-import-ipc";
import type { Project } from "../../../shared/projects-ipc";
import { rendererIpc } from "../ipc-registrar";
import {
  validateAgentTurnOptions,
  validateHistoryAdoptionSubmission,
} from "../agent-payload-validation";
import type { ProductHistoryIntent } from "../memory/orchestration/consent-controller";
import { sourceCount, type AdapterEntry, type AdapterScan, type HistoryAdapter, type HistoryBinding, type ParsedHistory, type ScanDepth } from "./adapter";
import { ClaudeHistoryAdapter } from "./claude-adapter";
import { CodexHistoryAdapter } from "./codex-adapter";
import { KimiHistoryAdapter } from "./kimi-adapter";
import { OpencodeHistoryAdapter } from "./opencode-adapter";
import { HistoryImportIndexStore, type StoredCanonicalRoute, type StoredHistoryProject } from "./index-store";
import {
  HistorySnapshotStore,
  type AdoptionSnapshot,
  type MemorySourceSnapshot,
} from "./memory-snapshot-store";
import { ProjectImportCoordinator } from "./project-import-coordinator";
import { MemoryGrantCoordinator } from "./memory-grant-coordinator";
import type { HistoryMemoryAuthorization } from "./memory-grant-coordinator";
import { HistoryImportWorkerClient } from "./import-worker/client";
import { canonicalHistoryProjection } from "./routing/canonical-projection";
import {
  aliasesClaimed,
  deepestOwner,
  historiesChanged,
  historyFileState,
  publicEntry,
  sourceRevisions,
} from "./routing/history-policy";
import { foreignTranscriptSnapshot } from "./routing/foreign-transcript";

export { historyFileState } from "./routing/history-policy";

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

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
  listSessionBindings(): HistoryBinding[];
  /* canonical Chat 的三种去向：仍是只读导入代际、已被收养成可写会话、
     或者干脆没了。同步与投影都读它，绝不各自猜。 */
  chatLifecycle(chatId: string): "external-readonly" | "managed" | "missing";
  /* 源文件在不在，只有扫描知道；它是 sourceStatus 的唯一事实来源。 */
  markImportSourceStatus(chatId: string, sourceStatus: "match" | "missing"): Promise<void>;
  syncHistory(input: {
    entry: AdapterEntry;
    summary: ForeignHistorySummary;
    blocks:
      | readonly ForeignHistoryMessage[]
      | AsyncIterable<
          readonly ForeignHistoryMessage[] |
          import("../chats/sqlite/database-protocol").PreparedHistoryImportBatch
        >;
    incompleteTail: boolean;
    signal: AbortSignal;
  }): Promise<{ chatId: string; generationId: string } | null>;
  memoryState(): HistoryMemoryAuthorization;
  adopt?(input: {
    request: PrepareHistoryAdoptionInput;
    entry: AdapterEntry;
    snapshot: AdoptionSnapshot;
    /* 同步早已把这条外源落成只读 canonical Chat：收养只续写它，
       绝不第二次开同一个 import 代际。 */
    route: StoredCanonicalRoute | null;
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
};

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
  private readonly importWorker: HistoryImportWorkerClient | null;
  private readonly lifetime = new AbortController();

  constructor(userData: string, private readonly options: HistoryImportServiceOptions, adapters?: HistoryAdapter[]) {
    this.index = new HistoryImportIndexStore(userData);
    this.snapshots = new HistorySnapshotStore(userData);
    this.adapters = adapters ?? [
      new ClaudeHistoryAdapter(options.home),
      new CodexHistoryAdapter(options.home),
      new KimiHistoryAdapter(options.home),
      new OpencodeHistoryAdapter(options.home),
    ];
    this.importWorker = adapters ? null : new HistoryImportWorkerClient();
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
      visibleEntries: () => this.visibleSourceEntries(),
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
  }

  /* 后台同步必须排在续聊对账之后：一个抢先激活的新代际会让 pending 的
     continuation.finalize 撞上代际围栏，saga 被隔离、Home 变孤儿。启动
     顺序是组合根的事，本服务只提供这一枚可被安排的入口。 */
  startBackgroundSync() {
    /* 一次新的同步开跑，上一次的抱怨就作废：告警是「最近一次同步说了什么」，
       不是一块永久墓碑。清在开头而不是结尾，是因为 detectAll 会把逐 Project
       的失败自己吞成 setWarning——那些话说在这一行之后，因此照样留得住；
       清在结尾反而会把本轮刚记下的真问题一起擦掉。 */
    this.clearWarning();
    setImmediate(() => void this.detectAll()
      .then(() => this.syncStoredHistories())
      .catch((cause) => this.setWarning(cause)));
  }

  register(window: BrowserWindow, rendererUrl: string) {
    this.window = window;
    /* 启动同步跑在窗口注册之前：那批 publish 全部落空。窗口一到就补发一次
       当前快照，侧栏因此不必靠一次刷新才看见已经同步好的历史会话。 */
    this.publish();
    const ipc = rendererIpc(window, rendererUrl, "拒绝非主窗口的历史导入请求")
      .roles("main");
    ipc
      .handle(HISTORY_IMPORT_CHANNEL.snapshot, () => this.snapshot())
      .handle(HISTORY_IMPORT_CHANNEL.prepareProject, () => this.prepareProject())
      .handle(HISTORY_IMPORT_CHANNEL.countProject, (token) => this.projectImports.counts(z.string().min(1).parse(token)))
      .handle(HISTORY_IMPORT_CHANNEL.commitProject, (raw) => this.commitProject(parseCommit(raw)))
      .handle(HISTORY_IMPORT_CHANNEL.setProjectEnabled, (projectId, enabled) => this.setProjectEnabled(idSchema.parse(projectId), z.boolean().parse(enabled)))
      .handle(HISTORY_IMPORT_CHANNEL.refreshProject, (projectId) => this.refreshProjectForUser(idSchema.parse(projectId)))
      .handle(HISTORY_IMPORT_CHANNEL.adopt, (raw) => this.adopt(parseAdopt(raw)))
      .handle(HISTORY_IMPORT_CHANNEL.memoryEligibility, (raw) => {
        const input = z.object({ surface: z.enum(["project", "settings"]), projectId: idSchema.optional() }).strict().parse(raw);
        return this.memoryEligibility(input);
      })
      .handle(HISTORY_IMPORT_CHANNEL.memoryPreview, (raw) => this.memoryPreview(parseMemoryPreview(raw)))
      .handle(HISTORY_IMPORT_CHANNEL.memoryCommit, (snapshotId, digest) => this.memoryCommit(idSchema.parse(snapshotId), z.string().regex(/^[a-f0-9]{64}$/).parse(digest)));
    window.once("closed", () => {
      if (this.window === window) this.window = null;
    });
  }

  snapshot(): HistoryImportSnapshot {
    const state = this.index.snapshot();
    const claimed = this.claimedAliases();
    const projection = canonicalHistoryProjection({
      state,
      projectVisible: (project) => project.enabled && this.validBinding(project),
      entryVisible: (entry) => !aliasesClaimed(entry, claimed),
      routeLive: (route) => this.options.chatLifecycle(route.chatId) !== "missing",
      present: (entry) => this.presentEntry(entry),
    });
    return {
      revision: state.revision,
      ...projection,
      projects: Object.values(state.projects).map((project) => this.projectState(project)),
      memoryDelivering: this.memory.delivering(),
      warning: this.warning,
    };
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

  /** wire 投影唯一出口：canonical 归档状态由 Chat 侧持有，此处只投源生事实。 */
  private presentEntry(entry: AdapterEntry): ForeignHistorySummary {
    return publicEntry(entry);
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
      await this.syncEntries(
        scans.flatMap((scan) => scan.entries),
        new Set([projectId])
      );
      await this.index.publish({
        projectId, canonicalRoot: project.dir, membershipRevision: project.membershipRevision,
        counts: scans.map(sourceCount), sourceRevisions: sourceRevisions(scans), entries: scans.flatMap((scan) => scan.entries),
      });
      /* 这一轮走完了：启动重放留下的那句抱怨到此为止。失败仍会当场重新
         说话（refreshProject 直接抛给调用方），所以这里不会吞掉任何真相。 */
      this.clearWarning();
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
    const receipt = await this.options.adopt({
      request,
      entry,
      snapshot,
      route: this.index.canonicalRoute(request.opaqueId) ?? null,
    });
    this.publish();
    return receipt;
  }

  /** Chat 删除的即时通知：不等下一轮同步，路由当场作废。 */
  async onChatRemoved(chatId: string) {
    await this.index.forgetCanonicalRoutes((route) => route.chatId === chatId);
    this.publish();
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
    this.lifetime.abort(new Error("History import service closed"));
    await Promise.all([
      this.index.closeAndFlush(),
      this.snapshots.closeAndFlush(),
      this.importWorker?.close() ?? Promise.resolve(),
    ]);
  }

  private async scan(root: string, depth: ScanDepth) { return Promise.all(this.adapters.map((adapter) => adapter.scanProject(root, depth))); }
  /* 归属在这里定案，也在这里落到条目上。适配器交出的 `projectId` 恒为空串
     ——它读的是文件，不知道 Project 是什么；此处刚刚按 cwd 判过归属，正是
     那个知道答案的人。少了这一笔盖章，`refreshProject` 会拿着 projectId=""
     去 `syncHistory`，存储侧照单全收，把已有只读 Chat 的 local_project_id
     整个清空——24 条导入历史当场掉出 Project，落进裸 Chats 列表。 */
  private async scanOwned(project: ProjectRef, depth: ScanDepth) {
    const scans = await this.scan(project.dir, depth);
    const roots = this.options.listProjects().filter((candidate) => candidate.workspaceBinding.kind === "external" && !candidate.archivedAt);
    return scans.map((scan) => ({
      ...scan,
      entries: scan.entries
        .filter((entry) => deepestOwner(entry.cwd, roots)?.id === project.id)
        .map((entry) => ({ ...entry, projectId: project.id })),
    }));
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
  private visibleSourceEntries() {
    return Object.values(this.index.snapshot().projects).flatMap((project) =>
      project.enabled && this.validBinding(project)
        ? project.entries.map((entry) => this.presentEntry(entry))
        : []
    );
  }
  private claimedAliases() {
    const claimed = new Set<string>();
    for (const binding of this.options.listSessionBindings()) {
      if (binding.session) claimed.add(`${binding.session.backend}:${binding.session.id}`);
    }
    return claimed;
  }
  private async syncStoredHistories() {
    const projects = Object.values(this.index.snapshot().projects).filter(
      (project) => project.enabled && this.validBinding(project)
    );
    await this.syncEntries(
      projects.flatMap((project) => project.entries),
      new Set(projects.map((project) => project.projectId))
    );
    this.publish();
  }

  /* Chat 被删后账本里那条路由就是断链：先抹掉它，本轮同步才会把 Chat 重建
     出来并记下新的路由。 */
  private async pruneDanglingRoutes() {
    await this.index.forgetCanonicalRoutes(
      (route) => this.options.chatLifecycle(route.chatId) === "missing"
    );
  }

  /* 已路由的源从扫描里消失了，转录顶上那条「来源已不在」的分隔线才有生产
     者；它再出现就把话收回。判定的范围只到本轮扫描覆盖的 Project，否则一次
     单 Project 刷新会把别人的源一并宣判失踪。 */
  private async reconcileSourceStatus(
    scanned: ReadonlySet<string>,
    scope: ReadonlySet<string>
  ) {
    const routes = Object.entries(this.index.snapshot().canonicalRoutes);
    for (const [opaqueId, route] of routes) {
      const present = scanned.has(opaqueId);
      const stored = this.findEntry(opaqueId);
      if (!present && !(stored && scope.has(stored.projectId))) continue;
      if (this.options.chatLifecycle(route.chatId) === "missing") continue;
      await this.options.markImportSourceStatus(
        route.chatId,
        present ? "match" : "missing"
      );
    }
  }

  private async syncEntries(
    entries: readonly AdapterEntry[],
    scope: ReadonlySet<string>
  ) {
    await this.pruneDanglingRoutes();
    await this.reconcileSourceStatus(
      new Set(entries.map((entry) => entry.opaqueId)),
      scope
    );
    for (const entry of entries) {
      /* 收养之后这条外源已经是一条可写 Chat：再往它身上开一个 import 代际
         会把 revision 撞成永久 stale。跳过不是错误，是这条源的终局。 */
      const route = this.index.canonicalRoute(entry.opaqueId);
      if (route && this.options.chatLifecycle(route.chatId) === "managed") continue;
      const signal = this.lifetime.signal;
      const parsed = this.importWorker ? null : await this.parseEntry(entry, signal);
      const result = await this.options.syncHistory({
        entry,
        summary: this.presentEntry(entry),
        blocks: this.importWorker
          ? this.importWorker.parseBatches(this.options.home, entry, signal)
          : parsed!.blocks,
        incompleteTail: parsed?.incompleteTail ?? entry.incompleteTail,
        signal,
      });
      if (result) {
        await this.index.recordCanonicalRoute(entry.opaqueId, result);
      }
    }
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
  /* 本来就没话说时不必广播：一次成功的刷新不该只为「无事发生」推一帧快照。 */
  private clearWarning() {
    if (this.warning === null) return;
    this.warning = null;
    this.publish();
  }
}

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
