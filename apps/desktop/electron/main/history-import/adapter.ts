/**
 * [INPUT]: Depends on Node fs/path/crypto/timers and shared history-import contracts
 * [OUTPUT]: Provides the read-only HistoryAdapter port, 4-GiB constant-memory block streams, separately capped compatibility reads, stable JSONL streaming, two-depth scans, fingerprints, containment, per-line limits, titles, abort checkpoints, and compatibility collection
 * [POS]: Mechanistic history-import adapter kernel shared by main projections and the dedicated parser worker
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  setImmediate as yieldToEventLoop,
  setTimeout as delay,
} from "node:timers/promises";
import type {
  ExternalSessionKey,
  ForeignHistoryBlock,
  ForeignHistorySummary,
  ForeignToolEvent,
  HistoryFileFingerprint,
  HistorySourceCount,
  HistorySourceKind,
} from "../../../shared/history-import-ipc";

export const HISTORY_PARSER_VERSION = 1;
export const UNSUPPORTED_PREVIEW_BYTES = 4 * 1024;
export const HISTORY_COMPAT_FILE_BYTES = 64 * 1024 * 1024;
export const HISTORY_FILE_BYTES = 4 * 1024 * 1024 * 1024;
export const HISTORY_STREAM_LINE_BYTES = 64 * 1024 * 1024;
export const QUICK_META_HEAD_BYTES = 64 * 1024;
const INCOMPLETE_TAIL_RETRY_MS = [8, 24, 48] as const;

/**
 * 扫描档位：identity 只需身份（cwd 归属 + native id + 指纹），呈现元数据允许
 * stat 兜底，供检测/计数消费；full 产出完整列表元数据（title/时间戳），供发布消费。
 * 两档的 opaqueId/key/fingerprint 必须严格一致——身份不随档位漂移。
 */
export type ScanDepth = "identity" | "full";

export type AdapterEntry = ForeignHistorySummary & {
  /** 仅 main/index 可见；append 保持，truncate/replace/parser 变化时轮换。 */
  sourceIncarnation: string;
  sourcePath: string;
  fingerprint: HistoryFileFingerprint;
};

export function initialSourceIncarnation(
  key: ExternalSessionKey,
  value: HistoryFileFingerprint
) {
  return digest(
    [
      key.sourceKind,
      key.storageFingerprint,
      key.canonicalNativeId,
      value.device,
      value.inode,
      value.parserVersion,
    ].join("\0")
  );
}

export type AdapterScan = Readonly<{
  sourceKind: HistorySourceKind;
  installed: boolean;
  entries: AdapterEntry[];
  sourceRevision: string;
}>;

export type HistoryBinding = Readonly<{
  chatId?: string;
  session: { backend: string; id: string } | null;
  importOrigin?: {
    sourceKind: HistorySourceKind;
    storageFingerprint: string;
    canonicalNativeId: string;
    aliases: string[];
    resumeAlias: string;
    adoptionSnapshotId?: string;
  } | null;
  snapshotDigest?: string | null;
}>;

export type ParsedHistory = Readonly<{
  blocks: ForeignHistoryBlock[];
  incompleteTail: boolean;
}>;

export type HistoryBlockBatches = AsyncGenerator<
  ForeignHistoryBlock[],
  boolean,
  void
>;

export type HistoryBlockTurns = AsyncGenerator<
  readonly ForeignHistoryBlock[],
  boolean,
  void
>;

export type StableJsonlLines = AsyncGenerator<
  Readonly<{ line: string; index: number }>,
  boolean,
  void
>;

export interface HistoryAdapter {
  readonly sourceKind: HistorySourceKind;
  readonly parserVersion: number;
  scanProject(canonicalRoot: string, depth?: ScanDepth): Promise<AdapterScan>;
  /** Built-in adapters implement this; optional keeps injected bounded test adapters minimal. */
  parseBatches?(entry: AdapterEntry, signal?: AbortSignal): HistoryBlockBatches;
  parse(entry: AdapterEntry, signal?: AbortSignal): Promise<ParsedHistory>;
}

export const HISTORY_IMPORT_PARSE_BATCH_POLICY = Object.freeze({
  entryLimit: 1_024,
  byteLimit: 4 * 1024 * 1024,
  sliceMs: 50,
});

/** Compatibility collector for bounded callers; import publication consumes parseBatches directly. */
export async function collectHistoryBatches(
  source: HistoryBlockBatches
): Promise<ParsedHistory> {
  const blocks: ForeignHistoryBlock[] = [];
  while (true) {
    const next = await source.next();
    if (next.done) return { blocks, incompleteTail: next.value };
    blocks.push(...next.value);
  }
}

/** Turns are finalized before batching, so later tool output can never mutate an acknowledged batch. */
export async function* batchHistoryTurns(
  source: HistoryBlockTurns,
  signal?: AbortSignal
): HistoryBlockBatches {
  let batch: ForeignHistoryBlock[] = [];
  let bytes = 0;
  let startedAt = Date.now();
  const reset = () => {
    batch = [];
    bytes = 0;
    startedAt = Date.now();
  };
  while (true) {
    signal?.throwIfAborted();
    const next = await source.next();
    if (next.done) {
      if (batch.length) yield batch;
      return next.value;
    }
    for (const block of next.value) {
      signal?.throwIfAborted();
      const size = Buffer.byteLength(JSON.stringify(block), "utf8");
      if (
        batch.length &&
        (batch.length >= HISTORY_IMPORT_PARSE_BATCH_POLICY.entryLimit ||
          bytes + size > HISTORY_IMPORT_PARSE_BATCH_POLICY.byteLimit ||
          Date.now() - startedAt >= HISTORY_IMPORT_PARSE_BATCH_POLICY.sliceMs)
      ) {
        yield batch;
        signal?.throwIfAborted();
        reset();
      }
      batch.push(block);
      bytes += size;
    }
  }
}

export function digest(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

export function opaqueSessionId(key: ExternalSessionKey) {
  return digest(
    [
      key.sourceKind,
      key.storageFingerprint,
      key.canonicalNativeId,
      ...[...key.aliases].sort(),
    ].join("\0")
  ).slice(0, 40);
}

export async function fingerprint(path: string, parserVersion = HISTORY_PARSER_VERSION) {
  const value = await stat(path, { bigint: true });
  return {
    device: String(value.dev),
    inode: String(value.ino),
    mtimeNs: String(value.mtimeNs),
    size: Number(value.size),
    parserVersion,
  } satisfies HistoryFileFingerprint;
}

export function fingerprintRevision(value: HistoryFileFingerprint) {
  return digest(JSON.stringify(value));
}

export function sameFingerprint(
  left: HistoryFileFingerprint,
  right: HistoryFileFingerprint
) {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.mtimeNs === right.mtimeNs &&
    left.size === right.size &&
    left.parserVersion === right.parserVersion
  );
}

export function isWithin(root: string, candidate: string) {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export async function canonicalDirectory(path: string) {
  return realpath(path);
}

export async function readStableText(
  path: string,
  expected?: HistoryFileFingerprint,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const before = await fingerprint(path, expected?.parserVersion);
  if (expected && !sameFingerprint(before, expected)) {
    throw Object.assign(new Error("HISTORY_REVISION_CHANGED"), {
      code: "HISTORY_REVISION_CHANGED",
    });
  }
  if (before.size > HISTORY_COMPAT_FILE_BYTES) {
    throw new Error("历史会话文件超过 64 MiB 安全上限");
  }
  const handle = await open(path, "r");
  try {
    const body = await handle.readFile({ encoding: "utf8", signal });
    signal?.throwIfAborted();
    const after = await fingerprint(path, before.parserVersion);
    if (!sameFingerprint(before, after)) {
      throw Object.assign(new Error("HISTORY_REVISION_CHANGED"), {
        code: "HISTORY_REVISION_CHANGED",
      });
    }
    return { body, fingerprint: after };
  } finally {
    await handle.close();
  }
}

/**
 * 只读文件头部并按完整行切割：整文件落进窗口时等价全文；更大的文件截到
 * 最后一个换行符（丢弃的尾行必然不完整或未见完整体）。追加中的文件天然安全。
 */
export async function readHeadLines(path: string, bytes = QUICK_META_HEAD_BYTES) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    const sawWholeFile = bytesRead < bytes;
    const body = buffer.subarray(0, bytesRead).toString("utf8");
    if (sawWholeFile) return { ...jsonl(body), sawWholeFile };
    const cut = body.lastIndexOf("\n");
    return { lines: cut < 0 ? [] : body.slice(0, cut).split("\n").filter(Boolean), incompleteTail: false, sawWholeFile };
  } finally {
    await handle.close();
  }
}

export function jsonl(body: string) {
  const complete = body.endsWith("\n");
  const lines = body.split("\n");
  if (!complete) lines.pop();
  return { lines: lines.filter(Boolean), incompleteTail: !complete && body.length > 0 };
}

export async function readStableJsonl(
  path: string,
  expected?: HistoryFileFingerprint,
  signal?: AbortSignal
) {
  let latest: (Awaited<ReturnType<typeof readStableText>> & ReturnType<typeof jsonl>) | null = null;
  let lastFailure: unknown;
  for (const waitMs of [0, ...INCOMPLETE_TAIL_RETRY_MS]) {
    if (waitMs && signal) await delay(waitMs, undefined, { signal });
    else if (waitMs) await delay(waitMs);
    try {
      const stable = await readStableText(path, expected, signal);
      latest = { ...stable, ...jsonl(stable.body) };
      if (!latest.incompleteTail) return latest;
    } catch (cause) {
      lastFailure = cause;
      if (expected || !isHistoryRevisionChange(cause)) throw cause;
    }
  }
  if (latest) return latest;
  throw lastFailure;
}

/**
 * Streams complete JSONL records without retaining the source body. The fingerprint is checked
 * on both sides; a final unterminated record is reported as an incomplete tail and never parsed.
 */
export async function* streamStableJsonl(
  path: string,
  expected?: HistoryFileFingerprint,
  signal?: AbortSignal
): StableJsonlLines {
  signal?.throwIfAborted();
  const before = await fingerprint(path, expected?.parserVersion);
  if (expected && !sameFingerprint(before, expected)) {
    throw Object.assign(new Error("HISTORY_REVISION_CHANGED"), {
      code: "HISTORY_REVISION_CHANGED",
    });
  }
  if (before.size > HISTORY_FILE_BYTES) {
    throw new Error("流式历史会话文件超过 4 GiB 安全上限");
  }
  const stream = createReadStream(path, {
    encoding: "utf8",
    highWaterMark: 64 * 1024,
    signal,
  });
  let pending = "";
  let index = 0;
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted();
      pending += chunk;
      if (Buffer.byteLength(pending, "utf8") > HISTORY_STREAM_LINE_BYTES) {
        throw new Error("历史会话单条记录超过 64 MiB 安全上限");
      }
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        if (line) yield { line, index: index++ };
        newline = pending.indexOf("\n");
      }
    }
  } finally {
    stream.destroy();
  }
  const after = await fingerprint(path, before.parserVersion);
  if (!sameFingerprint(before, after)) {
    throw Object.assign(new Error("HISTORY_REVISION_CHANGED"), {
      code: "HISTORY_REVISION_CHANGED",
    });
  }
  return pending.length > 0;
}

function isHistoryRevisionChange(cause: unknown) {
  return (cause as { code?: unknown })?.code === "HISTORY_REVISION_CHANGED";
}

/** 搜索解析每 256 行把控制权交还 main loop，使 cancel/页截止能中止 CPU 扫描。 */
export async function historyParseCheckpoint(
  signal: AbortSignal | undefined,
  index: number
) {
  if (!signal) return;
  signal.throwIfAborted();
  if (index % 256 !== 0) return;
  await yieldHistoryParse(signal);
}

/** SQLite 等同步批次每批都必须让出 main loop，不能只在批次前看 signal。 */
export async function yieldHistoryParse(signal?: AbortSignal) {
  if (!signal) return;
  signal.throwIfAborted();
  await yieldToEventLoop(undefined, { signal });
}

export function escapedUnsupported(value: string) {
  const bytes = Buffer.from(value, "utf8");
  const clipped = bytes.subarray(0, UNSUPPORTED_PREVIEW_BYTES).toString("utf8");
  return clipped
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function timestamp(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? Math.round(value * 1_000) : Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.isFinite(fallback) ? Math.max(0, Math.round(fallback)) : 0;
}

export function sourceCount(scan: AdapterScan): HistorySourceCount {
  return {
    sourceKind: scan.sourceKind,
    installed: scan.installed,
    count: scan.entries.length,
  };
}

export function normalizedAliases(values: Iterable<string | null | undefined>) {
  return [...new Set([...values].map((value) => value?.trim()).filter(Boolean) as string[])].sort();
}

/* ── 工具与工时附着：三家（codex/kimi/opencode 流式源）共用的收尾语义 ── */

export function drainTools(tools: Map<string, ForeignToolEvent>) {
  const list = [...tools.values()];
  tools.clear();
  return list;
}

/** 悬空工具挂到最近一条 assistant；找不到（无 assistant）则丢弃。 */
export function attachPendingTools(blocks: ForeignHistoryBlock[], tools: Map<string, ForeignToolEvent>) {
  if (!tools.size) return;
  let lastAssistant = -1;
  blocks.forEach((block, index) => {
    if (block.kind === "message" && block.role === "assistant") lastAssistant = index;
  });
  if (lastAssistant < 0) return;
  const block = blocks[lastAssistant];
  if (block?.kind !== "message") return;
  blocks[lastAssistant] = { ...block, tools: [...(block.tools ?? []), ...drainTools(tools)] };
}

/**
 * turn 工时账（codex task_complete / kimi turn.ended）归属：反向找到本 turn
 * （最近一条 user 之后）的末条 assistant。先撞到 user 即本 turn 无 assistant
 * （审批中止等），账无处可挂便丢弃——只报源里真有的账，不发明。重试 turn 的
 * 第二次账覆盖前账，报的是最后一次执行。
 */
export function attachWorkedFor(blocks: ForeignHistoryBlock[], durationMs: unknown) {
  const ms = typeof durationMs === "number" && Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null;
  if (ms === null) return;
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block?.kind !== "message") continue;
    if (block.role === "user") return;
    blocks[index] = { ...block, workedForMs: ms };
    return;
  }
}

/**
 * 列表标题的唯一整形入口。源里真有的标题（codex sqlite AI 标题、claude
 * custom-title）不含这些语法，过一遍无损；fallback 到用户消息原文时，
 * markdown 链接/图片/代码/粗体是机器语法不是内容——`[@@x](file:///…)`
 * 裸奔进侧栏就是另一套视觉方言。URL 若是正文本身则保留：剥语法，不剥内容。
 */
export function humanTitle(value: string) {
  return value
    /* `]\(` 是产品 @ 引用的转义变体；尾部未闭合的残链来自源侧 200 字符截断 */
    .replace(/!\[([^\]]*)\]\\?\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\\?\([^)]*\)/g, "$1")
    .replace(/!?\[([^\]]+)\]\\?\([^)]*$/, "$1")
    .replace(/`+([^`\n]*)`+/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
