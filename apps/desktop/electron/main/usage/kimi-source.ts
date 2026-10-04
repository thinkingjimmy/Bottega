/**
 * [INPUT]: Depends on Node path, the shared source-files walker, persistence/jsonl-lines (records split on "\n" only; an unfinished final line is not a failure), and usage-merge FileEvents
 * [OUTPUT]: Provides listKimiFiles (discovers ~/.kimi-code/sessions/<session>/agents/<agent>/wire.jsonl) and parseKimiFile, which extracts turn-scoped usage.record entries into token buckets (an absent or null bucket is 0; a record with none is failed)
 * [POS]: The Kimi Code usage-fact adapter; events carry no cross-file dedupe key, so tuple is always null
 */

import { join, relative, sep } from "node:path";
import { jsonlLines } from "../persistence/jsonl-lines";
import { listFilesRecursively } from "./source-files";
import { plausibleTimestamp, sealBuckets, type FileEvents, type UsageBuckets } from "./usage-merge";

export async function listKimiFiles(home: string) {
  const root = join(home, ".kimi-code", "sessions");
  const files = await listFilesRecursively(root, (name) => name === "wire.jsonl");
  return files
    .filter((path) => {
      const parts = relative(root, path).split(sep);
      return (
        parts.length === 5 &&
        parts[1].startsWith("session_") &&
        parts[2] === "agents" &&
        parts[4] === "wire.jsonl"
      );
    })
    .sort();
}

function buckets(usage: Record<string, unknown>): UsageBuckets | null {
  const keys = [
    "inputOther",
    "output",
    "inputCacheRead",
    "inputCacheCreation",
  ] as const;
  /* A bucket this record leaves out is 0, not a reason to lose the others; only a present, invalid one fails the line. */
  const count = (key: (typeof keys)[number]) => (usage[key] ?? 0) as number;
  if (
    keys.every((key) => usage[key] == null) ||
    keys.some(
      (key) =>
        typeof count(key) !== "number" ||
        !Number.isFinite(count(key)) ||
        count(key) < 0
    )
  ) {
    return null;
  }
  return {
    input: count("inputOther"),
    cacheRead: count("inputCacheRead"),
    cacheWrite: count("inputCacheCreation"),
    output: count("output"),
  };
}

export async function parseKimiFile(
  path: string,
  signal?: AbortSignal
): Promise<FileEvents> {
  const events: FileEvents["events"] = [];
  let failedLines = 0;
  for await (const { line, complete } of jsonlLines(path, signal)) {
    if (!line.includes('"usage.record"')) continue;
    try {
      const value = JSON.parse(line) as {
        type?: unknown;
        usageScope?: unknown;
        time?: unknown;
        model?: unknown;
        usage?: Record<string, unknown>;
      };
      if (
        value.type !== "usage.record" ||
        value.usageScope !== "turn" ||
        !value.usage
      ) {
        continue;
      }
      const tsMs =
        typeof value.time === "number"
          ? value.time
          : typeof value.time === "string"
            ? Date.parse(value.time)
            : Number.NaN;
      if (!plausibleTimestamp(tsMs)) {
        failedLines += 1;
        continue;
      }
      const usageBuckets = buckets(value.usage);
      if (!usageBuckets) {
        failedLines += 1;
        continue;
      }
      const tokens = Object.values(usageBuckets).reduce(
        (sum, count) => sum + count,
        0
      );
      const sealedBuckets = sealBuckets(tokens, usageBuckets);
      if (!sealedBuckets) {
        failedLines += 1;
        continue;
      }
      events.push({
        tuple: null,
        tokens,
        tsMs,
        model:
          typeof value.model === "string" && value.model.trim()
            ? value.model.trim()
            : null,
        buckets: sealedBuckets,
      });
    } catch {
      if (complete) failedLines += 1;
    }
  }
  return { events, failedLines };
}
