/**
 * [INPUT]: Depends on Node fs/path/readline streams, the shared source-files walker, and usage-merge FileEvents
 * [OUTPUT]: Provides listKimiFiles (discovers ~/.kimi-code/sessions/<session>/agents/<agent>/wire.jsonl) and parseKimiFile, which extracts turn-scoped usage.record entries into token buckets
 * [POS]: The Kimi Code usage-fact adapter; events carry no cross-file dedupe key, so tuple is always null
 */

import { createReadStream } from "node:fs";
import { join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { listFilesRecursively } from "./source-files";
import { sealBuckets, type FileEvents, type UsageBuckets } from "./usage-merge";

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
  if (
    keys.some(
      (key) =>
        typeof usage[key] !== "number" ||
        !Number.isFinite(usage[key]) ||
        (usage[key] as number) < 0
    )
  ) {
    return null;
  }
  return {
    input: usage.inputOther as number,
    cacheRead: usage.inputCacheRead as number,
    cacheWrite: usage.inputCacheCreation as number,
    output: usage.output as number,
  };
}

export async function parseKimiFile(
  path: string,
  signal?: AbortSignal
): Promise<FileEvents> {
  const events: FileEvents["events"] = [];
  let failedLines = 0;
  const input = createReadStream(path, { encoding: "utf8", signal });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
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
      if (!Number.isFinite(tsMs)) {
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
      failedLines += 1;
    }
  }
  return { events, failedLines };
}
