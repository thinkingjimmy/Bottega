/**
 * [INPUT]: Depends on Node fs/path/readline streams, the shared source-files walker, and usage-merge FileEvents
 * [OUTPUT]: Provides listClaudeFiles (discovers ~/.claude/projects and ~/.claude/transcripts JSONL) and parseClaudeFile, which extracts per-assistant-message token buckets into FileEvents
 * [POS]: The Claude Code usage-fact adapter; parses one file into isolated events only, with no cross-file state
 */

import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { listFilesRecursively } from "./source-files";
import { sealBuckets, type FileEvents, type UsageBuckets } from "./usage-merge";

const isJsonl = (name: string) => name.endsWith(".jsonl");

export async function listClaudeFiles(home: string) {
  const roots = [
    join(home, ".claude", "projects"),
    join(home, ".claude", "transcripts"),
  ];
  return (
    await Promise.all(roots.map((root) => listFilesRecursively(root, isJsonl)))
  ).flat().sort();
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
