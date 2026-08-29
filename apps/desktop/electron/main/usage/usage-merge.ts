/**
 * [INPUT]: Depends on shared usage-calendar and usage-ipc
 * [OUTPUT]: Provides normalized usage event/file types, bucket limits, Codex request roots, merge precedence, pricing cutoffs, and pure aggregation functions
 * [POS]: The use module's accuracy is the nucleus of the cluster; Parser only the facts, scope, dispute settlement, date and cost calibre are completed at this time
 * [NOTE]: mergeKey is a constant-belt source advantage, cross-source never collides with a combine MergeResults are therefore an exact equivalent rather than approximate
 */

import { addDays, dayKey } from "../../../shared/usage-calendar";
import type {
  DailyTokens,
  UsageStats,
  UsageSourceId,
} from "../../../shared/usage-ipc";
import { priceEvent, type PricingTable } from "./pricing/pricing";
import { buildTable } from "./pricing/pricing";
import { seedCatalog } from "./pricing/model-pricing.data";

export const SESSION_GAP_MS = 30 * 60_000;

export type UsageBuckets = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
};

export type NormalizedEvent = {
  tuple: string | null;
  tokens: number;
  tsMs: number;
  model: string | null;
  buckets: UsageBuckets | null;
};

export function sealBuckets(
  tokens: number,
  buckets: UsageBuckets
): UsageBuckets | null {
  const values = [
    tokens,
    buckets.input,
    buckets.cacheRead,
    buckets.cacheWrite,
    buckets.output,
  ];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  return buckets.input + buckets.cacheRead + buckets.cacheWrite + buckets.output ===
    tokens
    ? buckets
    : null;
}

export type CodexMeta = {
  nodeId: string;
  parentId: string | null;
  rootHint: string | null;
};

export type FileEvents = {
  events: NormalizedEvent[];
  failedLines: number;
  meta?: CodexMeta;
  scopeDegraded?: boolean;
};

export type SourceFileEvents = {
  source: UsageSourceId;
  path: string;
  file: FileEvents;
};

export type RootResolution = {
  roots: Map<string, string>;
  degraded: Set<string>;
};

export type MergeResult = {
  daily: DailyTokens;
  dailyCostUsd: Record<string, number>;
  dailyUnpricedTokens: Record<string, number>;
  perFileTs: Map<string, number[]>;
  degradedCodexFiles: Set<string>;
};

type KeyState = {
  source: UsageSourceId;
  tokens: number;
  tsMs: number;
  candidate: NormalizedEvent | null;
  conflicted: boolean;
  modelSeen: string | null;
  modelConflicted: boolean;
};

function distinct<T>(values: T[]) {
  return new Set(values).size;
}

export function resolveRootScopes(
  metas: Map<string, CodexMeta>
): RootResolution {
  const byNode = new Map<string, Array<{ path: string; meta: CodexMeta }>>();
  for (const [path, meta] of metas) {
    const records = byNode.get(meta.nodeId) ?? [];
    records.push({ path, meta });
    byNode.set(meta.nodeId, records);
  }

  const conflictedNodes = new Set<string>();
  for (const [nodeId, records] of byNode) {
    if (
      distinct(records.map(({ meta }) => meta.parentId)) > 1 ||
      distinct(records.map(({ meta }) => meta.rootHint)) > 1
    ) {
      conflictedNodes.add(nodeId);
    }
  }

  const roots = new Map<string, string>();
  const degraded = new Set<string>();

  for (const [startPath, startMeta] of metas) {
    if (startMeta.rootHint) {
      roots.set(startPath, startMeta.rootHint);
      continue;
    }

    const visited = new Set<string>();
    let current = startMeta;
    let resolved: string | null = null;
    while (!resolved) {
      if (visited.has(current.nodeId) || conflictedNodes.has(current.nodeId)) {
        degraded.add(startPath);
        resolved = startPath;
        break;
      }
      visited.add(current.nodeId);
      if (current.rootHint) {
        resolved = current.rootHint;
        break;
      }
      if (!current.parentId) {
        resolved = current.nodeId;
        break;
      }
      const parents = byNode.get(current.parentId);
      if (!parents || parents.length === 0) {
        resolved = current.parentId;
        break;
      }
      if (parents.length > 1 && conflictedNodes.has(current.parentId)) {
        degraded.add(startPath);
        resolved = startPath;
        break;
      }
      current = parents[0].meta;
    }
    roots.set(startPath, resolved);
  }
  return { roots, degraded };
}

function mergeKey(
  source: UsageSourceId,
  path: string,
  index: number,
  event: NormalizedEvent,
  roots: Map<string, string>,
  degraded: Set<string>
) {
  if (event.tuple === null) return `${source}:raw:${path}:${index}`;
  if (source === "claude") return `claude:${event.tuple}`;
  if (source === "kimi") return `kimi:raw:${path}:${index}`;
  const scope = degraded.has(path) ? path : (roots.get(path) ?? path);
  return `codex:${scope}:${event.tuple}`;
}

function sameBuckets(left: UsageBuckets, right: UsageBuckets) {
  return (
    left.input === right.input &&
    left.cacheRead === right.cacheRead &&
    left.cacheWrite === right.cacheWrite &&
    left.output === right.output
  );
}

function resetState(
  source: UsageSourceId,
  event: NormalizedEvent,
  tsMs = event.tsMs
): KeyState {
  return {
    source,
    tokens: event.tokens,
    tsMs,
    candidate: event.buckets ? event : null,
    conflicted: false,
    modelSeen: event.model,
    modelConflicted: false,
  };
}

function absorb(state: KeyState, event: NormalizedEvent) {
  const tsMs = Math.min(state.tsMs, event.tsMs);
  if (event.tokens > state.tokens) return resetState(state.source, event, tsMs);
  if (event.tokens < state.tokens) return { ...state, tsMs };

  let modelSeen = state.modelSeen;
  let modelConflicted = state.modelConflicted;
  if (event.model) {
    if (!modelSeen) modelSeen = event.model;
    else if (event.model !== modelSeen) modelConflicted = true;
  }

  let candidate = state.candidate;
  let conflicted = state.conflicted;
  if (event.buckets && !conflicted) {
    if (!candidate) candidate = event;
    else if (!sameBuckets(candidate.buckets!, event.buckets)) {
      candidate = null;
      conflicted = true;
    }
  }
  return {
    ...state,
    tsMs,
    candidate,
    conflicted,
    modelSeen,
    modelConflicted,
  };
}

export function mergeUsageFiles(
  files: SourceFileEvents[],
  timeZone: string,
  table: PricingTable = buildTable(seedCatalog)
): MergeResult {
  const codexMetas = new Map<string, CodexMeta>();
  for (const item of files) {
    if (item.source === "codex" && item.file.meta) {
      codexMetas.set(item.path, item.file.meta);
    }
  }
  const resolution = resolveRootScopes(codexMetas);
  const degradedCodexFiles = new Set(resolution.degraded);
  for (const item of files) {
    if (item.source === "codex" && item.file.scopeDegraded) {
      degradedCodexFiles.add(item.path);
    }
  }

  const perFileTs = new Map<string, number[]>();
  const keyed = new Map<string, KeyState>();
  for (const { source, path, file } of files) {
    perFileTs.set(
      `${source}:${path}`,
      file.events.map(({ tsMs }) => tsMs).filter(Number.isFinite)
    );
    file.events.forEach((event, index) => {
      if (
        !Number.isFinite(event.tokens) ||
        event.tokens < 0 ||
        !Number.isFinite(event.tsMs)
      ) {
        return;
      }
      const key = mergeKey(
        source,
        path,
        index,
        event,
        resolution.roots,
        degradedCodexFiles
      );
      const previous = keyed.get(key);
      if (!previous) {
        keyed.set(key, resetState(source, event));
        return;
      }
      keyed.set(key, absorb(previous, event));
    });
  }

  const daily: DailyTokens = {};
  const dailyCostUsd: Record<string, number> = {};
  const dailyUnpricedTokens: Record<string, number> = {};
  for (const state of keyed.values()) {
    if (state.tokens <= 0) continue;
    const key = dayKey(state.tsMs, timeZone);
    daily[key] = (daily[key] ?? 0) + state.tokens;
    const event =
      state.candidate &&
      !state.conflicted &&
      !state.modelConflicted &&
      state.modelSeen
        ? {
            ...state.candidate,
            model: state.modelSeen,
          }
        : null;
    const cost = event
      ? priceEvent(table, state.source, event.model, event.buckets)
      : null;
    if (cost === null) {
      dailyUnpricedTokens[key] =
        (dailyUnpricedTokens[key] ?? 0) + state.tokens;
    } else {
      dailyCostUsd[key] = (dailyCostUsd[key] ?? 0) + cost;
    }
  }
  return {
    daily,
    dailyCostUsd,
    dailyUnpricedTokens,
    perFileTs,
    degradedCodexFiles,
  };
}

/* ============================================================
 * mergeKey 给每个键都打了 source 前缀，跨源永不碰撞——于是
 * 「三个源」的合并结果与「一次性合并三个源」按定义等价，
 * 逐字段相加即可。All 因此不必把所有事件重新合并一遍。
 * perFileTs 的键本就是 `${source}:${path}`，直接并集。
 * ============================================================ */

export function combineMergeResults(results: MergeResult[]): MergeResult {
  const daily: DailyTokens = {};
  const dailyCostUsd: Record<string, number> = {};
  const dailyUnpricedTokens: Record<string, number> = {};
  const perFileTs = new Map<string, number[]>();
  const degradedCodexFiles = new Set<string>();
  for (const result of results) {
    for (const [key, tokens] of Object.entries(result.daily)) {
      daily[key] = (daily[key] ?? 0) + tokens;
    }
    for (const [key, cost] of Object.entries(result.dailyCostUsd)) {
      dailyCostUsd[key] = (dailyCostUsd[key] ?? 0) + cost;
    }
    for (const [key, tokens] of Object.entries(result.dailyUnpricedTokens)) {
      dailyUnpricedTokens[key] = (dailyUnpricedTokens[key] ?? 0) + tokens;
    }
    for (const [key, timestamps] of result.perFileTs) {
      perFileTs.set(key, timestamps);
    }
    for (const path of result.degradedCodexFiles) {
      degradedCodexFiles.add(path);
    }
  }
  return {
    daily,
    dailyCostUsd,
    dailyUnpricedTokens,
    perFileTs,
    degradedCodexFiles,
  };
}

export function longestSegment(perFileTs: Map<string, number[]>) {
  let longest = 0;
  for (const timestamps of perFileTs.values()) {
    const ordered = timestamps.filter(Number.isFinite).sort((a, b) => a - b);
    if (ordered.length < 2) continue;
    let startedAt = ordered[0];
    let previous = ordered[0];
    for (const current of ordered.slice(1)) {
      if (current - previous > SESSION_GAP_MS) startedAt = current;
      longest = Math.max(longest, current - startedAt);
      previous = current;
    }
  }
  return longest;
}

function currentStreak(active: Set<string>, todayKey: string) {
  let cursor = active.has(todayKey) ? todayKey : addDays(todayKey, -1);
  if (!active.has(cursor)) return 0;
  let length = 0;
  while (active.has(cursor)) {
    length += 1;
    cursor = addDays(cursor, -1);
  }
  return length;
}

function longestStreak(activeDays: string[]) {
  let longest = 0;
  let running = 0;
  let previous: string | null = null;
  for (const current of activeDays) {
    running = previous && current === addDays(previous, 1) ? running + 1 : 1;
    longest = Math.max(longest, running);
    previous = current;
  }
  return longest;
}

export function computeStats(
  daily: DailyTokens,
  perFileTs: Map<string, number[]>,
  todayKey: string,
  dailyCostUsd: Record<string, number> = {}
): UsageStats {
  const entries = Object.entries(daily)
    .filter(([, tokens]) => Number.isFinite(tokens) && tokens > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  let peakDay: string | null = null;
  let peakDayTokens = 0;
  for (const [key, tokens] of entries) {
    if (tokens > peakDayTokens) {
      peakDay = key;
      peakDayTokens = tokens;
    }
  }
  const activeDays = entries.map(([key]) => key);
  return {
    lifetimeTokens: entries.reduce((sum, [, tokens]) => sum + tokens, 0),
    lifetimeCostUsd: Object.values(dailyCostUsd).reduce(
      (sum, cost) => sum + (Number.isFinite(cost) && cost >= 0 ? cost : 0),
      0
    ),
    peakDayTokens,
    peakDay,
    longestChatMs: longestSegment(perFileTs),
    currentStreakDays: currentStreak(new Set(activeDays), todayKey),
    longestStreakDays: longestStreak(activeDays),
  };
}
