/**
 * [INPUT]: Depends on Node fs/path/readline flow and usage-merge FileEvents
 * [OUTPUT]: Provides Claude projects/transcripts Recurring discovery and assistant model/limited four barrels, limited total non-state flow analysis
 * [POS]: The use of Claude Code fact adapters; The only thing that is important is to regulate single file events and not to overload files
 */

import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { sealBuckets, type FileEvents, type UsageBuckets } from "./usage-merge";

async function listJsonl(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const path = join(root, entry.name);
        if (entry.isDirectory()) return listJsonl(path);
        return Promise.resolve(
          entry.isFile() && entry.name.endsWith(".jsonl") ? [path] : []
        );
      })
    );
    return nested.flat();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
}

export async function listClaudeFiles(home: string) {
  const roots = [
    join(home, ".claude", "projects"),
    join(home, ".claude", "transcripts"),
  ];
  return (await Promise.all(roots.map(listJsonl))).flat().sort();
}

function nonNegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function buckets(usage: Record<string, unknown>): UsageBuckets | null {
  if (!nonNegative(usage.input_tokens) || !nonNegative(usage.output_tokens)) {
    return null;
  }
  for (const key of [
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
  ]) {
    if (Object.prototype.hasOwnProperty.call(usage, key) && !nonNegative(usage[key])) {
      return null;
    }
  }
  return {
    input: usage.input_tokens as number,
    cacheRead: (usage.cache_read_input_tokens as number | undefined) ?? 0,
    cacheWrite: (usage.cache_creation_input_tokens as number | undefined) ?? 0,
    output: usage.output_tokens as number,
  };
}

export async function parseClaudeFile(
  path: string,
  signal?: AbortSignal
): Promise<FileEvents> {
  const events: FileEvents["events"] = [];
  let failedLines = 0;
  const input = createReadStream(path, { encoding: "utf8", signal });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('"usage"')) continue;
    try {
      const value = JSON.parse(line) as {
        type?: unknown;
        timestamp?: unknown;
        requestId?: unknown;
        message?: {
          id?: unknown;
          model?: unknown;
          usage?: Record<string, unknown>;
        };
      };
      if (
        value.type !== "assistant" ||
        !value.message?.usage ||
        value.message.model === "<synthetic>"
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
      const messageId =
        typeof value.message.id === "string" ? value.message.id : null;
      const tuple = messageId
        ? `${messageId}:${
            typeof value.requestId === "string" ? value.requestId : path
          }`
        : null;
      const usageBuckets = buckets(value.message.usage);
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
        tuple,
        tokens,
        tsMs,
        model:
          typeof value.message.model === "string" && value.message.model.trim()
            ? value.message.model.trim()
            : null,
        buckets: sealedBuckets,
      });
    } catch {
      failedLines += 1;
    }
  }
  return { events, failedLines };
}
