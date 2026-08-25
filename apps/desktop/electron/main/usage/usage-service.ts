/**
 * [INPUT]: Depends on Node homedir/stat, shared Usage, source domain agreement, three source parser, fact cache, pricing store and merge/stats
 * [OUTPUT]: Provides price revision pushed UsageService, UsageCancelledError and unreliable Usage IPC parameter scanning
 * [POS]: The user's long lifecycle owner; exclusive scan exchange, price snapshot, per-source memory, Summary IPC and dual store drain/reopen
 */

import { homedir } from "node:os";
import { stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { dayKey } from "../../../shared/usage-calendar";
import {
  USAGE_CHANNEL,
  USAGE_QUERY_TARGETS,
  USAGE_SOURCE_ORDER,
  type AgentUsageSummary,
  type UsageIssue,
  type UsagePricingUpdate,
  type UsageQueryTarget,
  type UsageScanProgress,
  type UsageSourceId,
} from "../../../shared/usage-ipc";
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

type SourceResult = {
  source: UsageSourceId;
  byFile: Map<string, FileEvents>;
  scannedFiles: number;
  issues: UsageIssue[];
};

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
  controller: AbortController;
  promise: Promise<SourceResult>;
};

type SourceState = {
  nextScanId: number;
  current: ActiveScan | null;
  queued: Deferred<SourceResult> | null;
  latest: SourceResult | null;
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
  claude: {
    cached: false,
    listFiles: listClaudeFiles,
    parseFile: parseClaudeFile,
  },
  kimi: {
    cached: true,
    listFiles: listKimiFiles,
    parseFile: parseKimiFile,
  },
};

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

function sourceIssue(
  source: UsageSourceId,
  kind: UsageIssue["kind"],
  message: string,
  failedFiles = 0,
  failedLines = 0,
  affectsSummary = kind !== "cache"
): UsageIssue {
  return {
    source,
    kind,
    affectsSummary,
    failedFiles,
    failedLines,
    message,
  };
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
  private readonly mergeCache = new WeakMap<
    SourceResult,
    { timeZone: string; table: PricingTable; merged: MergeResult }
  >();
  private cacheEntries = new Map<string, UsageCacheEntry>();
  private cacheLoad: Promise<void> | null = null;
  private cacheDamaged = false;
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
    const selected = sourcesFor(target);
    const results = await Promise.all(
      selected.map((source) =>
        this.requestSource(source, options.forceRefresh === true)
      )
    );
    if (!this.accepting) throw new UsageCancelledError();

    const timeZone = this.timeZone();
    const todayKey = dayKey(this.now(), timeZone);
    const merged = combineMergeResults(
      results.map((result) => this.mergeSource(result, timeZone, table))
    );
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
          sourceIssue(
            "codex",
            "file",
            `${path} 的会话家族无法安全求根，已降级为文件 scope`,
            1
          )
        );
      }
    }
    const stats = computeStats(
      merged.daily,
      merged.perFileTs,
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
    const active: Promise<SourceResult>[] = [];
    for (const state of this.states.values()) {
      state.queued?.reject(cancellation);
      state.queued = null;
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

  /* ==========================================================
   * 每份 SourceResult 只合并一次。缓存以 SourceResult 的对象
   * 身份为键：重新扫描必然产生新对象，失效因此是结构保证的，
   * 不需要任何手写的失效规则；WeakMap 也让旧代自动可回收。
   *
   * 这消掉了「All 与三个 per-source 各合并一遍 = 两倍工作量」，
   * 首次打开 Usage 从 6 次合并降到 3 次。
   * ========================================================== */

  private mergeSource(
    result: SourceResult,
    timeZone: string,
    table: PricingTable
  ): MergeResult {
    const cached = this.mergeCache.get(result);
    if (
      cached &&
      cached.timeZone === timeZone &&
      cached.table === table
    ) {
      return cached.merged;
    }
    const merged = mergeUsageFiles(
      [...result.byFile].map(([path, file]) => ({
        source: result.source,
        path,
        file,
      })),
      timeZone,
      table
    );
    this.mergeCache.set(result, { timeZone, table, merged });
    return merged;
  }

  private state(source: UsageSourceId) {
    return this.states.get(source)!;
  }

  private requestSource(source: UsageSourceId, force: boolean) {
    if (!this.accepting) return Promise.reject(new UsageCancelledError());
    const state = this.state(source);
    if (state.current) {
      if (!force || state.current.forced) return state.current.promise;
      if (!state.queued) state.queued = deferred<SourceResult>();
      return state.queued.promise;
    }
    if (!force && state.latest) return Promise.resolve(state.latest);
    return this.startScan(source, force);
  }

  private startScan(source: UsageSourceId, forced: boolean) {
    const state = this.state(source);
    const scanId = ++state.nextScanId;
    const controller = new AbortController();
    const promise = this.executeScan(source, scanId, controller.signal).catch(
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
    const active: ActiveScan = { scanId, forced, controller, promise };
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
    state.queued = null;
    if (!queued) return;
    if (!this.accepting) {
      queued.reject(new UsageCancelledError());
      return;
    }
    void this.startScan(source, true).then(queued.resolve, queued.reject);
  }

  private async ensureCache() {
    if (!this.cacheLoad) {
      this.cacheLoad = this.cache.load().then(({ entries, damaged }) => {
        this.cacheEntries = entries;
        this.cacheDamaged = damaged;
      });
    }
    await this.cacheLoad;
  }

  private async executeScan(
    source: UsageSourceId,
    scanId: number,
    signal: AbortSignal
  ): Promise<SourceResult> {
    await this.ensureCache();
    signal.throwIfAborted();
    const adapter = this.adapters[source];
    const issues: UsageIssue[] = [];
    if (this.cacheDamaged && adapter.cached) {
      issues.push(
        sourceIssue(
          source,
          "cache",
          "用量缓存损坏或版本不兼容，已忽略并重新扫描"
        )
      );
    }

    let paths: string[];
    try {
      paths = await adapter.listFiles(this.home);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "无法枚举日志目录";
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
        byFile: new Map(),
        scannedFiles: 0,
        issues: [
          ...issues,
          sourceIssue(source, "source", `日志目录读取失败：${message}`),
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

    for (const path of paths) {
      signal.throwIfAborted();
      let before: FileSnapshot;
      try {
        before = snapshot(await this.statFile(path));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "stat 失败";
        issues.push(
          sourceIssue(source, "file", `${path} 读取失败：${message}`, 1)
        );
        scanned += 1;
        this.maybePublishProgress(
          source,
          scanId,
          scanned,
          paths.length,
          lastProgressAt,
          (value) => {
            lastProgressAt = value;
          }
        );
        continue;
      }

      const cached = adapter.cached ? this.cacheEntries.get(path) : undefined;
      if (
        cached?.source === source &&
        snapshotsEqual(cached.snap, before)
      ) {
        byFile.set(path, cached.file);
        nextCache.set(path, cached);
        failedLines += cached.file.failedLines;
      } else {
        try {
          const parsed = await adapter.parseFile(path, signal);
          byFile.set(path, parsed);
          failedLines += parsed.failedLines;
          if (parsed.scopeDegraded) {
            issues.push(
              sourceIssue(
                source,
                "file",
                `${path} 无法证明完整会话前缀，已降级为文件 scope`,
                1
              )
            );
          }
          if (adapter.cached) {
            const after = snapshot(await this.statFile(path));
            if (snapshotsEqual(before, after)) {
              nextCache.set(path, { source, snap: after, file: parsed });
            }
          }
        } catch (cause) {
          if (signal.aborted) throw new UsageCancelledError();
          const message = cause instanceof Error ? cause.message : "解析失败";
          issues.push(
            sourceIssue(source, "file", `${path} 解析失败：${message}`, 1)
          );
        }
      }

      scanned += 1;
      this.maybePublishProgress(
        source,
        scanId,
        scanned,
        paths.length,
        lastProgressAt,
        (value) => {
          lastProgressAt = value;
        }
      );
    }

    if (failedLines > 0) {
      issues.push(
        sourceIssue(
          source,
          "line",
          `${failedLines} 行用量日志无法解析`,
          0,
          failedLines
        )
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
        const message = cause instanceof Error ? cause.message : "写入失败";
        issues.push(
          sourceIssue(source, "cache", `用量缓存未保存：${message}`)
        );
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
    return { source, byFile, scannedFiles: paths.length, issues };
  }

  private maybePublishProgress(
    source: UsageSourceId,
    scanId: number,
    scanned: number,
    total: number,
    lastProgressAt: number,
    updateTime: (value: number) => void
  ) {
    const now = Date.now();
    if (scanned === total || scanned % 25 === 0 || now - lastProgressAt >= 200) {
      updateTime(now);
      this.publishProgress({
        source,
        scanId,
        phase: "progress",
        scanned,
        total,
      });
    }
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
