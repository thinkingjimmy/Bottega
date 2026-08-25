/**
 * [INPUT]: Depends on Node fs/path/readline flow and usage-merge FileEvents
 * [OUTPUT]: Provides Kimi wire.jsonl found with turn-level model/limited four barrels, limited total usage.record Strict analysis
 * [POS]: The use of the Kimi Code fact adapter; The event is natural coga, tuple constant null
 */

import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { sealBuckets, type FileEvents, type UsageBuckets } from "./usage-merge";

async function listWireFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const path = join(root, entry.name);
        if (entry.isDirectory()) return listWireFiles(path);
        return Promise.resolve(
          entry.isFile() && entry.name === "wire.jsonl" ? [path] : []
        );
      })
    );
    return nested.flat();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
}

export async function listKimiFiles(home: string) {
  const root = join(home, ".kimi-code", "sessions");
  const files = await listWireFiles(root);
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
