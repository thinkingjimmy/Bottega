/**
 * [INPUT]: Depends on Node fs/path/readline flow and usage-merge CodexMeta/FileEvents
 * [OUTPUT]: Provides active+archived rollout Finds ̇ session/turn context Extract a four-barrel rollover table with a limited total/last binary form
 * [POS]: The use of Codex fact adapters; Identity only coded checkpoints, barrel/model claims handed over by merge
 */

import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type {
  CodexMeta,
  FileEvents,
  NormalizedEvent,
  UsageBuckets,
} from "./usage-merge";
import { sealBuckets } from "./usage-merge";

async function listRollouts(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const path = join(root, entry.name);
        if (entry.isDirectory()) return listRollouts(path);
        return Promise.resolve(
          entry.isFile() &&
            entry.name.startsWith("rollout-") &&
            entry.name.endsWith(".jsonl")
            ? [path]
            : []
        );
      })
    );
    return nested.flat();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
}

export async function listCodexFiles(home: string) {
  const roots = [
    join(home, ".codex", "sessions"),
    join(home, ".codex", "archived_sessions"),
  ];
  return (await Promise.all(roots.map(listRollouts))).flat().sort();
}

function nonNegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

type UsageTotal =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "valid"; value: number };

function usageTotal(value: unknown): UsageTotal {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "missing" };
  }
  const usage = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(usage, "total_tokens")) {
    return typeof usage.total_tokens === "number" &&
      Number.isFinite(usage.total_tokens) &&
      usage.total_tokens >= 0
      ? { kind: "valid", value: usage.total_tokens }
      : { kind: "invalid" };
  }
  const total =
    nonNegative(usage.input_tokens) + nonNegative(usage.output_tokens);
  return Number.isFinite(total)
    ? { kind: "valid", value: total }
    : { kind: "invalid" };
}

function lastBuckets(value: unknown, tokens: number): UsageBuckets | null {
  const usage =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!usage) return null;
  const fields = ["input_tokens", "cached_input_tokens", "output_tokens"];
  if (
    fields.some(
      (key) =>
        typeof usage[key] !== "number" ||
        !Number.isFinite(usage[key]) ||
        (usage[key] as number) < 0
    )
  ) {
    return null;
  }
  const cached = usage.cached_input_tokens as number;
  const input = usage.input_tokens as number;
  if (cached > input) return null;
  return sealBuckets(tokens, {
    input: input - cached,
    cacheRead: cached,
    cacheWrite: 0,
    output: usage.output_tokens as number,
  });
}

function nestedString(value: unknown, path: string[]) {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "string" && cursor ? cursor : null;
}

function readMeta(value: unknown, path: string): CodexMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== "session_meta") return null;
  const payload =
    record.payload &&
    typeof record.payload === "object" &&
    !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : {};
  const nodeId =
    typeof payload.id === "string" && payload.id ? payload.id : path;
  const parentId =
    (typeof payload.forked_from_id === "string" &&
      payload.forked_from_id) ||
    (typeof payload.parent_thread_id === "string" &&
      payload.parent_thread_id) ||
    nestedString(payload, [
      "source",
      "subagent",
      "thread_spawn",
      "parent_thread_id",
    ]);
  return {
    nodeId,
    parentId: parentId || null,
    rootHint:
      typeof payload.session_id === "string" && payload.session_id
        ? payload.session_id
        : null,
  };
}

export async function parseCodexFile(
  path: string,
  signal?: AbortSignal
): Promise<FileEvents> {
  const events: NormalizedEvent[] = [];
  let failedLines = 0;
  let meta: CodexMeta | undefined;
  let highWater: number | null = null;
  let resetEpoch = 0;
  let sawReset = false;
  let provesCompletePrefix = false;
  let sawUsage = false;
  let lineNumber = 0;
  let currentModel: string | null = null;
  let currentTurnId: string | null = null;
  const input = createReadStream(path, { encoding: "utf8", signal });
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    lineNumber += 1;
    const inspectMeta = lineNumber === 1 || !meta;
    if (
      !inspectMeta &&
      !line.includes('"token_count"') &&
      !line.includes('"turn_context"')
    ) {
      continue;
    }
    try {
      const value = JSON.parse(line) as {
        type?: unknown;
        timestamp?: unknown;
        payload?: {
          type?: unknown;
          model?: unknown;
          turn_id?: unknown;
          info?: {
            total_token_usage?: unknown;
            last_token_usage?: unknown;
          } | null;
        };
      };
      meta ??= readMeta(value, path) ?? undefined;
      if (value.type === "turn_context") {
        currentModel = null;
        currentTurnId = null;
        const payload = value.payload;
        if (typeof payload?.model === "string" && payload.model.trim()) {
          currentModel = payload.model.trim();
        }
        if (typeof payload?.turn_id === "string" && payload.turn_id.trim()) {
          currentTurnId = payload.turn_id.trim();
        }
        continue;
      }
      if (
        value.type !== "event_msg" ||
        value.payload?.type !== "token_count" ||
        value.payload.info == null
      ) {
        continue;
      }
      const tsMs =
        typeof value.timestamp === "string"
          ? Date.parse(value.timestamp)
          : Number.NaN;
      if (!Number.isFinite(tsMs)) {
        failedLines += 1;
        continue;
      }
      const totalUsage = value.payload.info.total_token_usage;
      const lastUsage = value.payload.info.last_token_usage;
      const totalRead = totalUsage === undefined
        ? ({ kind: "missing" } as const)
        : usageTotal(totalUsage);
      const lastRead = lastUsage === undefined
        ? ({ kind: "missing" } as const)
        : usageTotal(lastUsage);
      if (totalRead.kind === "invalid") {
        failedLines += 1;
        continue;
      }
      if (lastRead.kind === "invalid") {
        failedLines += 1;
        continue;
      }
      const total = totalRead.kind === "valid" ? totalRead.value : null;
      const last = lastRead.kind === "valid" ? lastRead.value : null;
      if (total === null && last === null) continue;

      if (!sawUsage && total !== null && last !== null) {
        provesCompletePrefix = total === last;
      }
      sawUsage = true;

      if (total !== null && last !== null) {
        if (highWater !== null && total < highWater) {
          const stale =
            total * 100 >= highWater * 98 || total + 2 * last >= highWater;
          if (stale) continue;
          resetEpoch += 1;
          sawReset = true;
          highWater = null;
        }
        events.push({
          tuple: `${resetEpoch}:${currentTurnId ?? tsMs}:total:${total}`,
          tokens: last,
          tsMs,
          model: currentModel,
          buckets: lastBuckets(lastUsage, last),
        });
        highWater = total;
        continue;
      }

      if (total !== null) {
        if (highWater !== null && total < highWater) {
          if (total * 100 >= highWater * 98) continue;
          resetEpoch += 1;
          sawReset = true;
          highWater = null;
        }
        events.push({
          tuple: `${resetEpoch}:${currentTurnId ?? tsMs}:total:${total}`,
          tokens: Math.max(0, total - (highWater ?? 0)),
          tsMs,
          model: currentModel,
          buckets: null,
        });
        highWater = total;
        continue;
      }

      events.push({
        tuple: `${resetEpoch}:${currentTurnId ?? "no-turn"}:last:${tsMs}`,
        tokens: last ?? 0,
        tsMs,
        model: currentModel,
        buckets: lastBuckets(lastUsage, last ?? 0),
      });
      highWater = (highWater ?? 0) + (last ?? 0);
    } catch {
      failedLines += 1;
    }
  }

  const resolvedMeta =
    meta ?? { nodeId: path, parentId: null, rootHint: null };
  const family = Boolean(resolvedMeta.parentId || resolvedMeta.rootHint);
  return {
    events,
    failedLines,
    meta: resolvedMeta,
    scopeDegraded:
      !meta || (sawReset && family && !provesCompletePrefix),
  };
}
