/**
 * [INPUT]: Shared canonical history-source schema; Depends on Electron IPC, Project/Chat queries, strict turn options, the four history sources as worker-backed adapters over fence-resolved roots (import-worker/sources.ts; no concrete adapter on main), the dedicated import worker, Project/Memory coordinators, index/snapshot stores, and shared contracts
 * [OUTPUT]: Provides explicit Project Add/Settings history imports without startup scanning, delta previews fenced by Project membership, and saved-Chat continuation with durable intent receipts
 * [POS]: Canonical federated history and renderer-safe authority boundary; production SQLite ingestion parses outside main
 */

import { builtinOptions } from "../../../shared/chat-agent/options";
import { createHash } from "node:crypto";
import type { BrowserWindow } from "electron";
import { z } from "zod";
import {
  HISTORY_IMPORT_CHANNEL,
  historySourceKindSchema,
  type HistorySourceKind,
  type ForeignHistoryMessage,
  type HistoryImportEvent,
  type HistoryImportSnapshot,
  type ForeignHistorySummary,
  type HistoryMemoryPreview,
  type PrepareHistoryAdoptionInput,
  type ProjectHistoryImportState,
} from "../../../shared/ipc/content/history-import-ipc";
import type { Project } from "../../../shared/ipc/workspace/projects-ipc";
import { rendererIpc } from "../registration/ipc-registrar";
import {
  validateAgentTurnOptions,
  validateHistoryAdoptionSubmission,
} from "../agent/validation";
import type { ProductHistoryIntent } from "../memory/orchestration/consent-controller";
import { sourceCount, type AdapterEntry, type AdapterScan, type HistoryAdapter, type HistoryBinding, type ParsedHistory, type ScanDepth } from "./adapters/adapter";
import { HistoryImportIndexStore, type StoredHistoryProject } from "./index-store";
import type { ChatImportOrigin } from "../../../shared/ipc/content/chats-ipc";
import {
  HistorySnapshotStore,
  type AdoptionSnapshot,
  type MemorySourceSnapshot,
} from "./memory/memory-snapshot-store";
import { ProjectImportCoordinator } from "./project-import-coordinator";
import { MemoryGrantCoordinator } from "./memory/memory-grant-coordinator";
import type { HistoryMemoryAuthorization } from "./memory/memory-grant-coordinator";
import { HistoryImportWorkerClient } from "./import-worker/client";
import { historySourceRoots, workerHistoryAdapters, type HistorySourceRoots } from "./import-worker/sources";
import { canonicalHistoryProjection } from "./routing/canonical-projection";
import {
  aliasesClaimed,
  deepestOwner,
  historyImportCandidates,
  historyFileState,
  publicEntry,
  sourceRevisions,
} from "./routing/history-policy";
import { foreignTranscriptSnapshot } from "./routing/foreign-transcript";


const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const sourceKindsSchema = z.array(historySourceKindSchema).max(historySourceKindSchema.options.length);

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

type HistoryContinuationReceipt = {
  intentId: string; chatId: string; incarnationId: string; phase: "started" | "queued" | "settled" | "failed";
};

/** 外源会话的唯一等价关系；`chat_import_origins` 用的就是这三格。 */
type SourceIdentity = { sourceKind: string; storageFingerprint: string; canonicalNativeId: string };
const sameSource = (left: SourceIdentity, right: SourceIdentity) =>
  left.sourceKind === right.sourceKind && left.storageFingerprint === right.storageFingerprint &&
  left.canonicalNativeId === right.canonicalNativeId;

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
  /* 这条 Chat 的导入前传身份与已存代际：续聊的目标由它决定，路由只管源可见性。 */
  chatImportOrigin(chatId: string): ChatImportOrigin | null;
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
  /* 同步早已把这条外源落成只读 canonical Chat：收养只续写它，
     绝不第二次开同一个 import 代际，也绝不新建第二条 Chat。 */
  adopt?(input: {
    chatId: string;
    request: PrepareHistoryAdoptionInput;
    entry: AdapterEntry;
    snapshot: AdoptionSnapshot;
  }): Promise<HistoryContinuationReceipt>;
  /* 按已存代际在新 Agent 会话里续写：不读源文件，也不需要它还在。 */
  replay?(request: PrepareHistoryAdoptionInput): Promise<HistoryContinuationReceipt>;
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
  private refreshing = new Set<string>();
  private readonly parseCache = new Map<string, ParseFlight>();
  private readonly importWorker: HistoryImportWorkerClient | null;
  private readonly roots: HistorySourceRoots;
  private readonly lifetime = new AbortController();

  constructor(userData: string, private readonly options: HistoryImportServiceOptions, adapters?: HistoryAdapter[]) {
    this.index = new HistoryImportIndexStore(userData);
    this.snapshots = new HistorySnapshotStore(userData);
    /* Other Agents' files are read only on the import worker, under the roots the fence table resolves (TASK-11 D10, G12). */
    this.roots = historySourceRoots(process.env, options.home);
    this.importWorker = adapters ? null : new HistoryImportWorkerClient();
    this.adapters = adapters ?? workerHistoryAdapters(this.importWorker!, this.roots);
    this.projectImports = new ProjectImportCoordinator({
      select: options.prepareProject,
      warm: async (sources) => { await Promise.all(this.adapters.filter(adapter => sources.includes(adapter.sourceKind)).map((adapter) => adapter.warm?.())); },
      count: async (root, sources) => (await this.scan(root, "identity", sources)).map(sourceCount),
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

  register(window: BrowserWindow, rendererUrl: string) {
    this.window = window;
    /* 注册窗口只发布已保存的历史快照，不扫描或更新外部来源。 */
    this.publish();
    const ipc = rendererIpc(rendererUrl, "拒绝非主窗口的历史导入请求")
      .roles("main");
    ipc
      .handle(HISTORY_IMPORT_CHANNEL.snapshot, () => this.snapshot())
      .handle(HISTORY_IMPORT_CHANNEL.prepareProject, (sources) => this.prepareProject(sourceKindsSchema.parse(sources)))
      .handle(HISTORY_IMPORT_CHANNEL.countProject, (token) => this.projectImports.counts(z.string().min(1).parse(token)))
      .handle(HISTORY_IMPORT_CHANNEL.commitProject, (raw) => this.commitProject(parseCommit(raw)))
      .handle(HISTORY_IMPORT_CHANNEL.prepareImport, (raw) => { const input = z.object({ projectId: idSchema, sourceKinds: sourceKindsSchema }).strict().parse(raw); return this.prepareImport(input.projectId, input.sourceKinds); })
      .handle(HISTORY_IMPORT_CHANNEL.importProject, (raw) => this.importProject(parseProjectImport(raw)))
      .handle(HISTORY_IMPORT_CHANNEL.adopt, (raw) => { const input = parseAdopt(raw); return this.replayByChat(input.chatId, input); })
      .handle(HISTORY_IMPORT_CHANNEL.memoryEligibility, (raw) => {
        const input = z.object({ surface: z.enum(["project", "settings"]), projectId: idSchema.optional() }).strict().parse(raw);
        return this.memoryEligibility(input);
      })
      .handle(HISTORY_IMPORT_CHANNEL.memoryPreview, (raw) => this.memoryPreview(parseMemoryPreview(raw)))
      .handle(HISTORY_IMPORT_CHANNEL.memoryCommit, (snapshotId, digest) => this.memoryCommit(idSchema.parse(snapshotId), z.string().regex(/^[a-f0-9]{64}$/).parse(digest)))
      .handle(HISTORY_IMPORT_CHANNEL.memoryDiscard, (snapshotId) => this.memory.discard(idSchema.parse(snapshotId)));
    window.once("closed", () => {
      if (this.window === window) this.window = null;
    });
  }

  snapshot(): HistoryImportSnapshot {
    const state = this.index.snapshot();
    const claimed = this.claimedAliases();
    const projection = canonicalHistoryProjection({
      state,
      projectBound: (project) => this.validBinding(project),
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

  async prepareProject(sourceKinds: readonly HistorySourceKind[] = historySourceKindSchema.options) {
    return this.projectImports.prepare(sourceKinds);
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
      await this.refreshProject(project.id, prepared.sourceKinds);
      if (memoryImportIntent) {
        const preview = await this.memoryPreview({ projectId: project.id, includeProductChats: false, sourceKinds: prepared.sourceKinds });
        if (preview.turns > 0) memoryPreview = preview;
        else this.memory.discard(preview.snapshotId);
      }
    }
    this.publish();
    return { project, memoryPreview };
  }

  async prepareImport(projectId: string, sourceKinds: readonly HistorySourceKind[] = historySourceKindSchema.options) {
    const project = { ...this.requireExternalProject(projectId) };
    const scans = await this.scanOwned(project, "identity", sourceKinds);
    this.requireImportBinding(project);
    return {
      projectId,
      membershipRevision: project.membershipRevision,
      counts: this.importCandidates(projectId, scans).map(sourceCount),
    };
  }

  private importCandidates(projectId: string, scans: AdapterScan[]) {
    const state = this.index.snapshot();
    const bindings = this.options.listSessionBindings();
    const claimed = new Set(bindings.flatMap(({ session }) => session ? [`${session.backend}:${session.id}`] : []));
    const sourceKey = (key: SourceIdentity) => JSON.stringify([key.sourceKind, key.storageFingerprint, key.canonicalNativeId]);
    const imported = new Map(bindings.flatMap((binding) => binding.chatId && binding.importOrigin
      ? [[sourceKey(binding.importOrigin), binding.chatId] as const] : []));
    return historyImportCandidates(scans, state.projects[projectId]?.entries ?? [], (entry) => {
      if (aliasesClaimed(entry, claimed)) return "managed";
      const owner = imported.get(sourceKey(entry.key)) ?? state.canonicalRoutes[entry.opaqueId]?.chatId;
      return owner ? this.options.chatLifecycle(owner) : "missing";
    });
  }

  /** wire 投影唯一出口：canonical 归档状态由 Chat 侧持有，此处只投源生事实。 */
  private presentEntry(entry: AdapterEntry): ForeignHistorySummary {
    return publicEntry(entry);
  }

  async refreshProject(projectId: string, sourceKinds: readonly HistorySourceKind[] = historySourceKindSchema.options) {
    const project = { ...this.requireExternalProject(projectId) };
    await this.index.setEnabled({ projectId, canonicalRoot: project.dir, membershipRevision: project.membershipRevision, enabled: true });
    this.refreshing.add(projectId); this.publish();
    try {
      const previous = this.index.project(projectId);
      const scans = this.stabilizeIncarnations(await this.scanOwned(project, "full", sourceKinds), previous?.entries ?? []);
      const retained = (previous?.entries ?? []).filter(entry => !sourceKinds.includes(entry.sourceKind));
      const entries = [...retained, ...scans.flatMap(scan => scan.entries)];
      this.requireImportBinding(project);
      await this.syncEntries(
        this.importCandidates(projectId, scans).flatMap((scan) => scan.entries),
        new Set([projectId]),
        entries
      );
      await this.index.publish({
        projectId, canonicalRoot: project.dir, membershipRevision: project.membershipRevision,
        counts: [...(previous?.counts ?? []).filter(count => !sourceKinds.includes(count.sourceKind)), ...scans.map(sourceCount)],
        sourceRevisions: { ...sourceRevisions([]), ...previous?.sourceRevisions, ...Object.fromEntries(scans.map(scan => [scan.sourceKind, scan.sourceRevision])) }, entries,
      });
      /* 成功导入后收回旧告警；本次失败仍由调用方的确认弹窗报告。 */
      this.clearWarning();
      const state = this.projectState(this.index.project(projectId)!);
      this.publish({ type: "project", project: state });
      return state;
    } finally { this.refreshing.delete(projectId); this.publish(); }
  }

  async importProject(input: { projectId: string; membershipRevision: number; previewMemory: boolean; sourceKinds?: readonly HistorySourceKind[] }) {
    const current = this.requireExternalProject(input.projectId);
    if (current.membershipRevision !== input.membershipRevision) throw new Error("Project 工作目录已变化，请重新预览历史导入");
    const project = await this.refreshProject(input.projectId, input.sourceKinds);
    const preview = input.previewMemory
      ? await this.memoryPreview({ projectId: input.projectId, includeProductChats: false, sourceKinds: input.sourceKinds })
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

  /* ── 续聊的唯一入口 ──────────────────────────────────────────
   * 目标从 Chat 自己的 `importOrigin` 与已存代际解析出来：不经 route，也不经
   * `requireBoundEntry`——两者都以 Project 绑定与本机索引为前提，而一条导入
   * Chat 在换档案、从文件夹恢复之后仍然完好，凭什么锁死。
   * 源文件还在且代际没变就收养（原生 resume 更接近用户预期），否则按已存代际
   * 重放。两条路静默择一，转录上只留一条分隔线。
   * ────────────────────────────────────────────────────────── */
  async replayByChat(chatId: string, request: PrepareHistoryAdoptionInput) {
    /* 进程内调用者同样不被信任：这一句与 parseAdopt 重复，是因为两条入口
       的可信度不同，而校验的成本可以忽略。 */
    const validated: PrepareHistoryAdoptionInput = {
      ...request,
      chatId,
      submission: validateHistoryAdoptionSubmission(request.submission),
      turnOptions: builtinTurnOptions(request.turnOptions),
    };
    const origin = this.options.chatImportOrigin(chatId);
    if (!origin) throw new Error("Chat has no imported history to continue");
    if (this.options.chatLifecycle(chatId) !== "external-readonly") {
      throw new Error("Imported Chat is unavailable for continuation");
    }
    const adopted = await this.prepareAdoption(origin, validated);
    if (adopted) {
      const receipt = await this.options.adopt!({ chatId, request: validated, ...adopted });
      this.publish();
      return receipt;
    }
    if (!this.options.replay) throw new Error("Imported Chat is unavailable for continuation");
    const receipt = await this.options.replay(validated);
    this.publish();
    return receipt;
  }

  /* 收养的三个前提：源条目还在、代际未变、续聊 Agent 与源同家——少一个就没有
     可 resume 的原生会话。读源文件本身也可能失败（刚被删、权限变了），那同样
     只是"收养不成立"，不是续聊失败：`HISTORY_REVISION_CHANGED` 在这里是内部
     信号，静默回落 replay，只有用户显式要求 resume 原生会话时才有话说。 */
  private async prepareAdoption(origin: ChatImportOrigin, request: PrepareHistoryAdoptionInput) {
    const entry = this.sourceEntry(origin);
    if (!entry || !entry.canResume || !this.options.adopt) return null;
    if (entry.historyRevision !== origin.historyRevision) return null;
    if (request.turnOptions.backend !== entry.sourceKind) return null;
    const adapter = this.adapters.find((candidate) => candidate.sourceKind === entry.sourceKind);
    if (!adapter) return null;
    try {
      const parsed = await this.parseEntry(entry);
      const snapshot = await this.snapshots.writeAdoption({
        summary: this.presentEntry(entry), sourcePath: entry.sourcePath, blocks: parsed.blocks, parserVersion: adapter.parserVersion,
        fingerprint: { size: entry.fingerprint.size, mtimeNs: entry.fingerprint.mtimeNs },
        incompleteTail: parsed.incompleteTail,
      });
      return { entry, snapshot };
    } catch { return null; }
  }

  /** 按等价关系在索引里找源条目，与 Project 绑定和路由都无关。 */
  private sourceEntry(origin: ChatImportOrigin) {
    return Object.values(this.index.snapshot().projects)
      .flatMap((project) => project.entries)
      .find((entry) => sameSource(entry.key, origin));
  }

  /* 「这条源已经被收养了吗」只能问 Chat 自己。曾经问的是路由，于是路由一丢，
     守卫就在一条已经原生的 Chat 上再开一个 import 代际——按 repository 的话说，
     那会把两个 revision 撞开，此后每一次 append 的 CAS 都失败。 */
  private importedChatId(entry: AdapterEntry) {
    for (const binding of this.options.listSessionBindings()) {
      if (binding.chatId && binding.importOrigin && sameSource(binding.importOrigin, entry.key)) return binding.chatId;
    }
    return null;
  }

  /** Chat 删除的即时通知：不等下一轮同步，路由当场作废。 */
  async onChatRemoved(chatId: string) {
    await this.index.forgetCanonicalRoutes((route) => route.chatId === chatId);
    this.publish();
  }

  memoryEligibility(input: { surface: "project" | "settings"; projectId?: string }) {
    return this.memory.eligibility(input);
  }

  memoryPreview(input: { projectId?: string; includeProductChats: boolean; sourceKinds?: readonly HistorySourceKind[] }) {
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

  private async scan(root: string, depth: ScanDepth, sourceKinds: readonly HistorySourceKind[] = historySourceKindSchema.options) { return Promise.all(this.adapters.filter(adapter => sourceKinds.includes(adapter.sourceKind)).map((adapter) => adapter.scanProject(root, depth))); }
  /* 归属在这里定案，也在这里落到条目上。适配器交出的 `projectId` 恒为空串
     ——它读的是文件，不知道 Project 是什么；此处刚刚按 cwd 判过归属，正是
     那个知道答案的人。少了这一笔盖章，`refreshProject` 会拿着 projectId=""
     去 `syncHistory`，存储侧照单全收，把已有只读 Chat 的 local_project_id
     整个清空——24 条导入历史当场掉出 Project，落进裸 Chats 列表。 */
  private async scanOwned(project: ProjectRef, depth: ScanDepth, sourceKinds: readonly HistorySourceKind[] = historySourceKindSchema.options) {
    const scans = await this.scan(project.dir, depth, sourceKinds);
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
  private requireImportBinding(expected: ProjectRef) {
    const current = this.requireExternalProject(expected.id);
    if (current.dir !== expected.dir || current.membershipRevision !== expected.membershipRevision) {
      throw new Error("Project 工作目录已变化，请重新预览历史导入");
    }
  }
  private validBinding(stored: StoredHistoryProject) {
    const project = this.options.getProject(stored.projectId);
    return Boolean(project && !project.archivedAt && project.workspaceBinding.kind === "external" && project.membershipRevision === stored.membershipRevision && project.dir === stored.canonicalRoot);
  }
  private findEntry(opaqueId: string) { return Object.values(this.index.snapshot().projects).flatMap((project) => project.entries).find((entry) => entry.opaqueId === opaqueId); }
  private requireBoundEntry(opaqueId: string) {
    const entry = this.findEntry(opaqueId);
    const project = entry ? this.index.project(entry.projectId) : undefined;
    if (!entry || !project || !this.validBinding(project) || aliasesClaimed(entry, this.claimedAliases())) throw new Error("历史会话不存在或已由产品 Chat 收养");
    return entry;
  }
  private requireVisibleEntry(opaqueId: string) {
    const entry = this.requireBoundEntry(opaqueId);
    if (!this.index.project(entry.projectId)?.enabled) throw new Error("History source is hidden");
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
    scope: ReadonlySet<string>,
    scanned: readonly AdapterEntry[] = entries
  ) {
    await this.pruneDanglingRoutes();
    await this.reconcileSourceStatus(
      new Set(scanned.map((entry) => entry.opaqueId)),
      scope
    );
    for (const entry of entries) {
      /* 收养之后这条外源已经是一条可写 Chat：再往它身上开一个 import 代际
         会把 revision 撞成永久 stale。跳过不是错误，是这条源的终局。 */
      const owner = this.importedChatId(entry);
      if (owner && this.options.chatLifecycle(owner) === "managed") continue;
      const signal = this.lifetime.signal;
      const parsed = this.importWorker ? null : await this.parseEntry(entry, signal);
      const result = await this.options.syncHistory({
        entry,
        summary: this.presentEntry(entry),
        blocks: this.importWorker
          ? this.importWorker.parseBatches(this.roots, entry, signal)
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
    return { projectId: project.projectId, enabled: project.enabled, memoryImportIntent: project.memoryImportIntent, detecting: false, refreshing: this.refreshing.has(project.projectId), delivering: this.memory.deliveringProjects().has(project.projectId), hasChanges: false, generation: project.generation, counts: project.counts };
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
  const parsed = z.object({ chatId: idSchema, submission: z.unknown(), turnOptions: z.unknown(), authenticationRetry: z.object({ kind: z.literal("retry-authentication") }).strict().optional() }).strict().parse(value);
  /* 正文/附件/RichValue 三者的跨字段同构交给 manual route 那一套断言，
     此处不另写一份——两份校验必然有一份先松掉，而松掉的那份就是偏门。 */
  return {
    ...parsed,
    submission: validateHistoryAdoptionSubmission(parsed.submission),
    turnOptions: builtinTurnOptions(parsed.turnOptions),
  };
}
function parseMemoryPreview(value: unknown) { return z.object({ projectId: idSchema.optional(), includeProductChats: z.boolean() }).strict().parse(value); }

/* History import adopts into a built-in Agent only (a package Provider has no importable history format). */
function builtinTurnOptions(value: unknown) {
  const options = builtinOptions(validateAgentTurnOptions(value));
  if (!options) throw new Error("PROVIDER_UNAVAILABLE");
  return options;
}

function parseProjectImport(value: unknown) {
  return z.object({ projectId: idSchema, membershipRevision: z.number().int().nonnegative(), previewMemory: z.boolean(), sourceKinds: sourceKindsSchema }).strict().parse(value);
}
