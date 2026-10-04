/**
 * [INPUT]: Depends on Node homedir/stat, shared Usage IPC contracts, the three source adapters, UsageCache, PricingStore, and the merge/stats functions
 * [OUTPUT]: Provides UsageService (with `sources()`, the Providers it has history for) with bounded parallel file reads, shared refresh generations, summaries reused for at most 60 s, per-source failure isolation and pricing-revision-aware summaries, plus UsageCancelledError and assertUsageRequest; every issue carries a stable code the renderer words (its message is an English diagnostic), and only a folder or file that could not be read affects a summary.
 * [POS]: The history fact owner; sources complete independently, file results merge in discovery order, and cancellation drains every reader before releasing the cache.
 */

import { homedir } from "node:os";
import { stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { dayKey } from "../../../shared/usage/usage-calendar";
import {
  USAGE_CHANNEL,
  USAGE_QUERY_TARGETS,
  USAGE_SOURCE_ORDER,
  type AgentUsageSummary,
  type UsageIssue,
  type UsageIssueCode,
  type UsagePricingUpdate,
  type UsageQueryTarget,
  type UsageScanProgress,
  type UsageSourceId,
} from "../../../shared/ipc/settings/usage-ipc";
import { listClaudeFiles, parseClaudeFile } from "./claude-source";
import { listCodexFiles, parseCodexFile } from "./codex-source";
import { listKimiFiles, parseKimiFile } from "./kimi-source";
import {
  combineMergeResults,
  computeStats,
  mergeUsageFiles,
  type FileEvents,
  type MergeResult,
} from "./usage-merge";
import {
  snapshotsEqual,
  UsageCache,
  type FileSnapshot,
  type UsageCacheEntry,
  type UsageCacheLike,
} from "./usage-cache";
import {
  PricingStore,
  type PricingStoreOptions,
} from "./pricing/pricing-store";
import type { PricingTable } from "./pricing/pricing";

/* ============================================================
 * 一次扫描留下什么：合并后的事实，不含原始事件。
 *
 * 原始事件此前跟着 latest 常驻，唯一用途是价格表变了能在内存里重算。
 * 代价是本机 41 万个 event 对象、221 MiB 主进程堆，一直到退出为止——
 * 而价格表一天最多动一次（models.dev 24h TTL）。现在换成：合并就地做完，
 * 事件出栈；价格或时区变了就重扫一次，那条路径全部命中缓存。
 * ============================================================ */
type SourceSummary = {
  source: UsageSourceId;
  merged: MergeResult;
  timeZone: string;
  table: PricingTable;
  scannedFiles: number;
  /** When this scan landed; a non-forced request reuses the summary only while it is fresh (LATEST_REUSE_MS). */
  scannedAt: number;
  issues: UsageIssue[];
};

/** 一份合并结果只在这一组输入下成立。 */
type MergeInputs = { timeZone: string; table: PricingTable };

type SourceAdapter = {
  cached: boolean;
  listFiles: (home: string) => Promise<string[]>;
  parseFile: (path: string, signal?: AbortSignal) => Promise<FileEvents>;
};

type UsageWindow = {
  isDestroyed(): boolean;
  webContents: {
    send(
      channel: string,
      value: UsageScanProgress | UsagePricingUpdate
    ): void;
  };
};

export interface PricingStoreLike {
  current(): PricingTable;
  revision(): number;
  refreshIfNeeded(): Promise<void>;
  closeAndDrain(): Promise<void>;
  reopen(): void;
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(cause: unknown): void;
};

type ActiveScan = {
  scanId: number;
  forced: boolean;
  inputs: MergeInputs;
  controller: AbortController;
  promise: Promise<SourceSummary>;
};

type SourceState = {
  nextScanId: number;
  current: ActiveScan | null;
  queued: Deferred<SourceSummary> | null;
  queuedInputs: MergeInputs | null;
  latest: SourceSummary | null;
  progress: UsageScanProgress | null;
};

export type UsageServiceOptions = {
  home?: string;
  cache?: UsageCacheLike;
  now?: () => number;
  timeZone?: () => string;
  statFile?: (path: string) => Promise<Stats>;
  adapters?: Partial<Record<UsageSourceId, SourceAdapter>>;
  pricing?: PricingStoreLike;
  pricingRefreshEnabled?: () => boolean;
  pricingOptions?: Omit<
    PricingStoreOptions,
    "refreshEnabled" | "onTableChanged"
  >;
};

const DEFAULT_ADAPTERS: Record<UsageSourceId, SourceAdapter> = {
  codex: {
    cached: true,
    listFiles: listCodexFiles,
    parseFile: parseCodexFile,
  },
  /* claude 与 kimi 一样是「一个文件解析成一组孤立事件、无跨文件状态」，
     完全满足快照缓存的契约。它此前是唯一一个 cached: false 的源，于是每次
     启动后首开都要把 ~1.2 GB 日志全量重解析一遍（本机实测 4.4 s，占那次
     打开墙钟的 95%）。 */
  claude: {
    cached: true,
    listFiles: listClaudeFiles,
    parseFile: parseClaudeFile,
  },
  kimi: {
    cached: true,
    listFiles: listKimiFiles,
    parseFile: parseKimiFile,
  },
};

// Bound open streams and read buffers while allowing each source to make progress.
const FILE_READ_CONCURRENCY = 8;
/* A summary answers later non-forced requests (a tab switch, a revisited page, the Dock's five-minute read) only this long; the
   next one rescans, which the snapshot cache holds to a stat per unchanged file plus the files that changed. Reused for good,
   the first scan of a session froze Today until someone pressed Refresh. */
const LATEST_REUSE_MS = 60_000;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function emptyState(): SourceState {
  return {
    nextScanId: 0,
    current: null,
    queued: null,
    queuedInputs: null,
    latest: null,
    progress: null,
  };
}

function snapshot(value: Stats): FileSnapshot {
  return {
    mtimeMs: value.mtimeMs,
    size: value.size,
    dev: value.dev,
    ino: value.ino,
    ctimeMs: value.ctimeMs,
  };
}

const ISSUE_KIND: Record<UsageIssueCode, UsageIssue["kind"]> = {
  "source-unreadable": "source", "file-unreadable": "file", "file-unparseable": "file", "scope-degraded": "file",
  "lines-unparseable": "line",
};
/* Only usage missing from the numbers affects a summary: a folder or a file that could not be read. A degraded Codex scope loses
   no usage (only the family dedupe is coarser) and a skipped damaged entry is nothing anyone can fix: both stay diagnostics. */
function sourceIssue(source: UsageSourceId, code: UsageIssueCode, message: string, failedFiles = 0, failedLines = 0): UsageIssue {
  const kind = ISSUE_KIND[code];
  return { source, code, kind, affectsSummary: kind === "source" || (kind === "file" && code !== "scope-degraded"), failedFiles, failedLines, message };
}

function sourcesFor(target: UsageQueryTarget): UsageSourceId[] {
  return target === "all" ? [...USAGE_SOURCE_ORDER] : [target];
}

export class UsageCancelledError extends Error {
  readonly code = "USAGE_CANCELLED";

  constructor() {
    super("用量扫描已取消");
    this.name = "UsageCancelledError";
  }
}

export function assertUsageRequest(
  rawTarget: unknown,
  rawOptions: unknown
): { target: UsageQueryTarget; forceRefresh: boolean } {
  if (!USAGE_QUERY_TARGETS.includes(String(rawTarget) as UsageQueryTarget)) {
    throw new Error("Usage target 格式无效");
  }
  if (rawOptions === undefined) {
    return { target: rawTarget as UsageQueryTarget, forceRefresh: false };
  }
  if (
    !rawOptions ||
    typeof rawOptions !== "object" ||
    Array.isArray(rawOptions)
  ) {
    throw new Error("Usage options 格式无效");
  }
  const options = rawOptions as Record<string, unknown>;
  if (
    Object.keys(options).some((key) => key !== "forceRefresh") ||
    (options.forceRefresh !== undefined &&
      typeof options.forceRefresh !== "boolean")
  ) {
    throw new Error("Usage options 格式无效");
  }
  return {
    target: rawTarget as UsageQueryTarget,
    forceRefresh: options.forceRefresh === true,
  };
}

export class UsageService {
  private readonly home: string;
  private readonly cache: UsageCacheLike;
  private readonly now: () => number;
  private readonly timeZone: () => string;
  private readonly statFile: (path: string) => Promise<Stats>;
  private readonly adapters: Record<UsageSourceId, SourceAdapter>;
  private readonly pricing: PricingStoreLike;
  private readonly states = new Map<UsageSourceId, SourceState>(
    USAGE_SOURCE_ORDER.map((source) => [source, emptyState()])
  );
  /** The Providers with a usage-history adapter, in display order (the Dock's activity sources ask here). */
  sources(): UsageSourceId[] { return [...this.states.keys()]; }
  private cacheEntries = new Map<string, UsageCacheEntry>();
  private cacheLoad: Promise<void> | null = null;
  private window: UsageWindow | null = null;
  private accepting = true;

  constructor(userData: string, options: UsageServiceOptions = {}) {
    this.home = options.home ?? homedir();
    this.cache = options.cache ?? new UsageCache(userData);
    this.now = options.now ?? Date.now;
    this.timeZone =
      options.timeZone ??
      (() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    this.statFile = options.statFile ?? stat;
    this.adapters = {
      ...DEFAULT_ADAPTERS,
      ...options.adapters,
    };
    this.pricing =
      options.pricing ??
      new PricingStore(userData, {
        ...options.pricingOptions,
        refreshEnabled: options.pricingRefreshEnabled,
        onTableChanged: ({ revision }) => this.sendPricingUpdate(revision),
      });
  }

  attachWindow(window: UsageWindow) {
    this.window = window;
    this.replayProgress();
  }

  detachWindow(window: UsageWindow) {
    if (this.window === window) this.window = null;
  }

  replayProgress() {
    for (const state of this.states.values()) {
      if (state.progress) this.sendProgress(state.progress);
    }
  }

  async getSummary(
    target: UsageQueryTarget,
    options: { forceRefresh?: boolean } = {}
  ): Promise<AgentUsageSummary> {
    if (!this.accepting) throw new UsageCancelledError();
    this.replayProgress();
    void this.pricing.refreshIfNeeded();
    const table = this.pricing.current();
    const pricingRevision = this.pricing.revision();
    const timeZone = this.timeZone();
    /* 输入在发起扫描前定下，扫描按它合并：于是返回的每一份结果都确实是
       用这一版价格与时区算出来的，pricingRevision 不会指着别人的数字。 */
    const inputs: MergeInputs = { timeZone, table };
    const selected = sourcesFor(target);
    const results = await Promise.all(
      selected.map((source) =>
        this.sourceSummary(source, options.forceRefresh === true, inputs)
      )
    );
    if (!this.accepting) throw new UsageCancelledError();

    const todayKey = dayKey(this.now(), timeZone);
    const merged = combineMergeResults(results.map((result) => result.merged));
    const issues = results.flatMap((result) => result.issues);
    for (const path of merged.degradedCodexFiles) {
      if (
        !issues.some(
          (issue) =>
            issue.source === "codex" &&
            issue.kind === "file" &&
            issue.message.includes(path)
        )
      ) {
        issues.push(
          sourceIssue("codex", "scope-degraded", `${path}: session family root is unprovable; counted at file scope`)
        );
      }
    }
    const stats = computeStats(
      merged.daily,
      merged.longestChatMs,
      todayKey,
      merged.dailyCostUsd
    );
    const affecting = issues.filter((issue) => issue.affectsSummary);
    const status =
      stats.lifetimeTokens === 0
        ? affecting.length > 0
          ? "error"
          : "no-data"
        : affecting.length > 0
          ? "partial"
          : "ok";
    return {
      target,
      status,
      stats,
      daily: merged.daily,
      dailyCostUsd: merged.dailyCostUsd,
      dailyUnpricedTokens: merged.dailyUnpricedTokens,
      pricingRevision,
      timeZone,
      todayKey,
      scannedFiles: results.reduce(
        (sum, result) => sum + result.scannedFiles,
        0
      ),
      issues,
    };
  }

  async shutdown() {
    if (!this.accepting) return;
    this.accepting = false;
    const cancellation = new UsageCancelledError();
    const active: Promise<SourceSummary>[] = [];
    for (const state of this.states.values()) {
      state.queued?.reject(cancellation);
      state.queued = null;
      state.queuedInputs = null;
      if (state.current) {
        active.push(state.current.promise);
        state.current.controller.abort(cancellation);
      }
    }
    await Promise.allSettled(active);
    await this.cache.closeAndFlush();
    await this.pricing.closeAndDrain();
  }

  reopen() {
    this.cache.reopen();
    this.pricing.reopen();
    this.accepting = true;
    for (const [source, previous] of this.states) {
      this.states.set(source, {
        ...emptyState(),
        latest: previous.latest,
      });
    }
  }

  private state(source: UsageSourceId) {
    return this.states.get(source)!;
  }

  /* One Agent failing must not take the others, or All, with it: it answers with its last summary if it has one, else with
     nothing, and names its folder as unreadable. Cancellation still rejects the whole request. */
  private async sourceSummary(source: UsageSourceId, force: boolean, inputs: MergeInputs): Promise<SourceSummary> {
    try {
      return await this.requestSource(source, force, inputs);
    } catch (cause) {
      if (cause instanceof UsageCancelledError || !this.accepting) throw cause;
      const issue = sourceIssue(source, "source-unreadable", `Scan failed: ${cause instanceof Error ? cause.message : "unknown error"}`);
      const latest = this.state(source).latest;
      return latest ? { ...latest, issues: [...latest.issues, issue] } : {
        source, merged: mergeUsageFiles([], inputs.timeZone, inputs.table), timeZone: inputs.timeZone, table: inputs.table,
        scannedFiles: 0, scannedAt: this.now(), issues: [issue],
      };
    }
  }

  /* 「这份结果算的是不是我要的东西」只由输入决定：All 与三个 per-source
     在同一毫秒里问的是同一组输入，故互相搭车；时区或价格表变了则不能搭，
     否则会拿到一份用旧价算出来的数字。 */
  private requestSource(
    source: UsageSourceId,
    force: boolean,
    inputs: MergeInputs
  ) {
    if (!this.accepting) return Promise.reject(new UsageCancelledError());
    const state = this.state(source);
    const matches = (candidate: MergeInputs) =>
      candidate.timeZone === inputs.timeZone && candidate.table === inputs.table;
    if (state.current) {
      if (matches(state.current.inputs) && (!force || state.current.forced)) {
        return state.current.promise;
      }
      state.queuedInputs = inputs;
      if (!state.queued) state.queued = deferred<SourceSummary>();
      return state.queued.promise;
    }
    if (!force && state.latest && matches(state.latest) && this.now() - state.latest.scannedAt < LATEST_REUSE_MS) {
      return Promise.resolve(state.latest);
    }
    return this.startScan(source, force, inputs);
  }

  private startScan(
    source: UsageSourceId,
    forced: boolean,
    inputs: MergeInputs
  ) {
    const state = this.state(source);
    const scanId = ++state.nextScanId;
    const controller = new AbortController();
    const promise = this.executeScan(
      source,
      scanId,
      controller.signal,
      inputs
    ).catch(
      (cause) => {
        const cancelled =
          controller.signal.aborted || cause instanceof UsageCancelledError;
        const progress = state.progress;
        if (!progress || progress.phase !== "done") {
          this.publishProgress({
            source,
            scanId,
            phase: "done",
            outcome: cancelled ? "cancelled" : "error",
            scanned: progress?.scanned ?? 0,
            total: progress?.total ?? 0,
          });
        }
        if (cancelled) throw new UsageCancelledError();
        throw cause;
      }
    );
    const active: ActiveScan = { scanId, forced, inputs, controller, promise };
    state.current = active;
    void promise.then(
      (result) => {
        if (this.accepting) state.latest = result;
        this.finishScan(source, active);
      },
      () => this.finishScan(source, active)
    );
    return promise;
  }

  private finishScan(source: UsageSourceId, active: ActiveScan) {
    const state = this.state(source);
    if (state.current !== active) return;
    state.current = null;
    const queued = state.queued;
    const inputs = state.queuedInputs ?? active.inputs;
    state.queued = null;
    state.queuedInputs = null;
    if (!queued) {
      this.releaseCacheWhenIdle();
      return;
    }
    if (!this.accepting) {
      queued.reject(new UsageCancelledError());
      this.releaseCacheWhenIdle();
      return;
    }
    void this.startScan(source, true, inputs).then(queued.resolve, queued.reject);
  }

  /* 缓存条目只在扫描期间被查。最后一次扫描落地时一起放掉，主进程于是不必
     为一页 Settings 常驻整份 usage-cache.json；下一次扫描从盘上读回来，
     一次打开至多一次。 */
  private releaseCacheWhenIdle() {
    for (const state of this.states.values()) if (state.current) return;
    this.cacheEntries = new Map();
    this.cacheLoad = null;
    this.cache.release();
  }

  private async ensureCache() {
    if (!this.cacheLoad) {
      this.cacheLoad = this.cache.load().then(({ entries, damaged }) => {
        this.cacheEntries = entries;
        // A rebuilt cache changes no number, only how long this scan takes: the log says it, the page does not.
        if (damaged) console.warn("[usage] usage-cache.json was damaged or from another version; rebuilding it from the logs");
      });
    }
    await this.cacheLoad;
  }

  private async executeScan(
    source: UsageSourceId,
    scanId: number,
    signal: AbortSignal,
    inputs: MergeInputs
  ): Promise<SourceSummary> {
    await this.ensureCache();
    signal.throwIfAborted();
    const adapter = this.adapters[source];
    const issues: UsageIssue[] = [];

    let paths: string[];
    try {
      paths = await adapter.listFiles(this.home);
    } catch (cause) {
      /* The folder could not be listed (its permissions, an I/O error). What the cache knows of this Agent's files is still the
         best count there is: it is shown, the cache is left as it was, and the folder is named as unreadable. */
      const message = cause instanceof Error ? cause.message : "listing failed";
      const known = adapter.cached
        ? [...this.cacheEntries].filter(([, entry]) => entry.source === source).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        : [];
      this.publishProgress({
        source,
        scanId,
        phase: "start",
        scanned: 0,
        total: 0,
      });
      this.publishProgress({
        source,
        scanId,
        phase: "done",
        outcome: "error",
        scanned: 0,
        total: 0,
      });
      return {
        source,
        merged: mergeUsageFiles(known.map(([path, entry]) => ({ source, path, file: entry.file })), inputs.timeZone, inputs.table),
        timeZone: inputs.timeZone,
        table: inputs.table,
        scannedFiles: known.length,
        scannedAt: this.now(),
        issues: [
          ...issues,
          sourceIssue(source, "source-unreadable", `Log folder unreadable: ${message}`),
        ],
      };
    }

    this.publishProgress({
      source,
      scanId,
      phase: "start",
      scanned: 0,
      total: paths.length,
    });
    const byFile = new Map<string, FileEvents>();
    const nextCache = new Map<string, UsageCacheEntry>();
    let failedLines = 0;
    let scanned = 0;
    let lastProgressAt = 0;
    const advance = () => {
      scanned += 1;
      const now = Date.now();
      if (
        scanned === paths.length ||
        scanned % 25 === 0 ||
        now - lastProgressAt >= 200
      ) {
        lastProgressAt = now;
        this.publishProgress({
          source,
          scanId,
          phase: "progress",
          scanned,
          total: paths.length,
        });
      }
    };

    /* A file that vanished since the listing (an Agent archived or deleted it) holds nothing to count now, so it is skipped. Any
       other failure is tried once more after the rest; a file failing twice counts what the cache last knew of it, and only one
       never read before is reported as not counted. */
    const retry: string[] = [];
    const unreadable = (path: string, code: "file-unreadable" | "file-unparseable", cause: unknown, final: boolean) => {
      if ((cause as NodeJS.ErrnoException | null)?.code === "ENOENT") return;
      if (!final) { retry.push(path); return; }
      const cached = adapter.cached ? this.cacheEntries.get(path) : undefined;
      if (cached?.source === source) {
        byFile.set(path, cached.file);
        nextCache.set(path, cached);
        failedLines += cached.file.failedLines;
        return;
      }
      const message = cause instanceof Error ? cause.message : "read failed";
      issues.push(sourceIssue(source, code, `${path}: ${message}`, 1));
    };

    const readFile = async (path: string, final = false) => {
      signal.throwIfAborted();
      let before: FileSnapshot;
      try {
        before = snapshot(await this.statFile(path));
      } catch (cause) {
        unreadable(path, "file-unreadable", cause, final);
        if (!final) advance();
        return;
      }
      signal.throwIfAborted();

      const cached = adapter.cached ? this.cacheEntries.get(path) : undefined;
      if (
        cached?.source === source &&
        snapshotsEqual(cached.snap, before)
      ) {
        byFile.set(path, cached.file);
        nextCache.set(path, cached);
        failedLines += cached.file.failedLines;
      } else {
        let parsed: FileEvents;
        try {
          parsed = await adapter.parseFile(path, signal);
        } catch (cause) {
          if (signal.aborted) throw new UsageCancelledError();
          unreadable(path, "file-unparseable", cause, final);
          if (!final) advance();
          return;
        }
        byFile.set(path, parsed);
        failedLines += parsed.failedLines;
        if (parsed.scopeDegraded) {
          issues.push(
            sourceIssue(source, "scope-degraded", `${path}: complete session prefix is unprovable; counted at file scope`)
          );
        }
        // Counted already: a file renamed or deleted right after its parse is only left out of the cache.
        if (adapter.cached) {
          const after = await this.statFile(path).then(snapshot, () => null);
          if (after && snapshotsEqual(before, after)) {
            nextCache.set(path, { source, snap: after, file: parsed });
          }
        }
      }

      if (!final) advance();
    };
    let nextFile = 0;
    const workers = await Promise.allSettled(
      Array.from({ length: Math.min(FILE_READ_CONCURRENCY, paths.length) }, async () => {
        while (nextFile < paths.length) {
          signal.throwIfAborted();
          await readFile(paths[nextFile++]);
        }
      })
    );
    // Do not release scan/cache ownership while another cancelled reader is still settling.
    const failed = workers.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    for (const path of retry) await readFile(path, true);

    if (failedLines > 0) {
      issues.push(
        sourceIssue(source, "lines-unparseable", `${failedLines} usage log lines are unparseable`, 0, failedLines)
      );
    }
    signal.throwIfAborted();
    if (adapter.cached) {
      try {
        await this.cache.commitBatch(source, nextCache);
        for (const [path, entry] of [...this.cacheEntries]) {
          if (entry.source === source) this.cacheEntries.delete(path);
        }
        for (const [path, entry] of nextCache) {
          this.cacheEntries.set(path, entry);
        }
      } catch (cause) {
        // An unsaved cache changes no number; the next scan just reads every log again.
        console.warn("[usage] usage cache not saved: %s", cause instanceof Error ? cause.message : "write failed");
      }
    }
    signal.throwIfAborted();
    this.publishProgress({
      source,
      scanId,
      phase: "done",
      outcome: issues.some((issue) => issue.affectsSummary) ? "error" : "ok",
      scanned,
      total: paths.length,
    });
    /* 合并就地做完，byFile 随本次调用一起出栈。留到调用方那一层再合并，
       就等于把这一源的全部事件挂到 latest 上活到进程结束。 */
    return {
      source,
      merged: mergeUsageFiles(
        paths.flatMap(path => {
          const file = byFile.get(path);
          return file ? [{ source, path, file }] : [];
        }),
        inputs.timeZone,
        inputs.table
      ),
      timeZone: inputs.timeZone,
      table: inputs.table,
      scannedFiles: paths.length,
      scannedAt: this.now(),
      issues,
    };
  }

  private publishProgress(progress: UsageScanProgress) {
    this.state(progress.source).progress = progress;
    this.sendProgress(progress);
  }

  private sendProgress(progress: UsageScanProgress) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(USAGE_CHANNEL.scanProgress, progress);
    }
  }

  private sendPricingUpdate(pricingRevision: number) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(USAGE_CHANNEL.pricingUpdated, {
        pricingRevision,
      });
    }
  }
}
