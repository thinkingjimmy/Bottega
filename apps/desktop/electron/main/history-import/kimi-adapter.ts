/**
 * [INPUT]: Depends on Node fs/path, user home, default root outside the KIMI_CODE_HOME syntax, and history-import adapter, public core
 * [OUTPUT]: Provides KimiHistoryAdapter with state metadata and turn-bounded wire.jsonl streaming for prompts (product-context envelope stripped), content parts, tools, results, duration, and one-assistant-per-turn folding
 * [POS]: The history-imported Kimi CLI format adapter; Read only ~/.kimi-code/sessions, session_index.jsonl
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ForeignHistoryMessage, ForeignToolEvent } from "../../../shared/history-import-ipc";
import {
  HISTORY_FILE_BYTES,
  HISTORY_PARSER_VERSION,
  attachPendingTools,
  attachWorkedFor,
  batchHistoryTurns,
  collectHistoryBatches,
  digest,
  drainTools,
  fingerprint,
  fingerprintRevision,
  humanTitle,
  initialSourceIncarnation,
  isWithin,
  normalizedAliases,
  opaqueSessionId,
  streamStableJsonl,
  timestamp,
  type AdapterEntry,
  type AdapterScan,
  type HistoryAdapter,
  type HistoryBlockBatches,
  type HistoryBlockTurns,
  type ParsedHistory,
  type ScanDepth,
} from "./adapter";
import { foldHistoryTurns, stripProductContext } from "./turn-folding";

type Json = Record<string, unknown>;

export class KimiHistoryAdapter implements HistoryAdapter {
  readonly sourceKind = "kimi" as const;
  readonly parserVersion = HISTORY_PARSER_VERSION;
  private readonly kimiRoot: string;

  constructor(home: string) { this.kimiRoot = join(home, ".kimi-code"); }

  /* state.json 是每会话一份的小 JSON（workDir/title/时间全在），identity 与
   * full 两档同一次读取即得——两档收录结论天然一致。指纹对 wire.jsonl：
   * 它才是内容变化的载体。 */
  async scanProject(canonicalRoot: string, _depth: ScanDepth = "full"): Promise<AdapterScan> {
    const storage = await storageFingerprint(this.kimiRoot);
    if (!storage) return emptyScan();
    const entries: AdapterEntry[] = [];
    for (const directory of await sessionDirectories(join(this.kimiRoot, "sessions"))) {
      try {
        const state = await sessionState(join(directory, "state.json"));
        if (!state?.workDir || !isWithin(canonicalRoot, state.workDir)) continue;
        /* lastPrompt 缺席即从未开口的空会话（实测 "New Session" 全为此形）——
         * 无内容可转录，不值一行侧栏噪音 */
        if (!state.lastPrompt) continue;
        const wire = join(directory, "agents", "main", "wire.jsonl");
        const size = (await stat(wire)).size;
        if (size > HISTORY_FILE_BYTES) continue;
        const value = await fingerprint(wire, this.parserVersion);
        const mtimeMs = Number(BigInt(value.mtimeNs) / 1_000_000n);
        const nativeId = basename(directory);
        const key = {
          sourceKind: this.sourceKind,
          storageFingerprint: storage,
          canonicalNativeId: nativeId,
          aliases: normalizedAliases([nativeId]),
          resumeAlias: nativeId,
        } as const;
        entries.push({
          opaqueId: opaqueSessionId(key), projectId: "", sourceKind: this.sourceKind, key,
          title: humanTitle(state.title || "Kimi 会话"), cwd: state.workDir,
          createdAt: timestamp(state.createdAt, mtimeMs),
          updatedAt: timestamp(state.updatedAt, mtimeMs),
          historyRevision: fingerprintRevision(value),
          /* canResume：产品同款 session/resume 已对 TUI 家族会话真机实测通过
           * （dev 记录见 todo/08-22-kimi-opencode-history-import.md D2'）*/
          canResume: true, archived: false, incompleteTail: false,
          sourceIncarnation: initialSourceIncarnation(key, value),
          sourcePath: wire, fingerprint: value,
        });
      } catch {
        /* 逐会话 fail-soft：缺 state.json/wire、活跃写入与损坏一律跳过 */
      }
    }
    entries.sort((left, right) => right.createdAt - left.createdAt || left.opaqueId.localeCompare(right.opaqueId));
    return {
      sourceKind: this.sourceKind,
      installed: true,
      entries,
      sourceRevision: digest(entries.map((entry) => entry.historyRevision).join("\0")),
    };
  }

  /* wire 顺序流：turn.prompt 即 user；content.part(text) 按 turn 累积成
   * assistant 分片，turn 边界（下一个 prompt / turn.ended）落块；think 分片
   * 与 codex reasoning 同律不进正文。tool.call/result 按 toolCallId 配对，
   * turn.ended.durationMs 与 codex task_complete 同律挂本 turn 末条 assistant。 */
  parseBatches(entry: AdapterEntry, signal?: AbortSignal): HistoryBlockBatches {
    return batchHistoryTurns(foldHistoryTurns(this.parseTurns(entry, signal), signal), signal);
  }

  async parse(entry: AdapterEntry, signal?: AbortSignal): Promise<ParsedHistory> {
    return collectHistoryBatches(this.parseBatches(entry, signal));
  }

  private async *parseTurns(
    entry: AdapterEntry,
    signal?: AbortSignal
  ): HistoryBlockTurns {
    const source = streamStableJsonl(entry.sourcePath, entry.fingerprint, signal);
    let blocks: ForeignHistoryMessage[] = [];
    const tools = new Map<string, ForeignToolEvent>();
    let buffer = "", bufferSeq = 0, bufferAt = 0;
    const flush = () => {
      const content = buffer.trim();
      buffer = "";
      if (!content) return;
      const id = `assistant-${bufferSeq}`;
      blocks.push({
        kind: "message", id, nativeTurnId: id, deliverySeq: bufferSeq, role: "assistant",
        content, createdAt: bufferAt, tools: tools.size ? drainTools(tools) : undefined,
      } satisfies ForeignHistoryMessage);
    };
    const publish = () => {
      if (!blocks.length) return [];
      const ready = blocks;
      blocks = [];
      return ready;
    };
    while (true) {
      const next = await source.next();
      if (next.done) {
        flush();
        attachPendingTools(blocks, tools);
        const ready = publish();
        if (ready.length) yield ready;
        return next.value;
      }
      const { line, index } = next.value;
      const seq = index + 1;
      let raw: Json; try { raw = JSON.parse(line) as Json; } catch { continue; }
      const at = timestamp(raw.time, entry.createdAt);
      if (raw.type === "turn.prompt") {
        flush();
        attachPendingTools(blocks, tools);
        const ready = publish();
        if (ready.length) yield ready;
        const content = promptText(raw.input);
        if (content) {
          blocks.push({
            kind: "message", id: `user-${seq}`, nativeTurnId: `user-${seq}`, deliverySeq: seq,
            role: "user", content, createdAt: at,
          } satisfies ForeignHistoryMessage);
        }
        continue;
      }
      if (raw.type === "turn.ended") {
        flush();
        attachWorkedFor(blocks, (raw as { durationMs?: unknown }).durationMs);
        continue;
      }
      if (raw.type !== "context.append_loop_event") continue;
      const event = object(raw.event);
      if (!event) continue;
      if (event.type === "content.part") {
        const part = object(event.part);
        const text = part?.type === "text" ? string(part.text) : null;
        if (text) {
          if (!buffer) { bufferSeq = seq; bufferAt = at; }
          buffer += text;
        }
        continue;
      }
      if (event.type === "tool.call") {
        const id = string(event.toolCallId) ?? `tool-${seq}`;
        tools.set(id, { id, name: string(event.name) ?? "tool", input: safeJson(event.args) });
        continue;
      }
      if (event.type === "tool.result") {
        const id = string(event.toolCallId);
        const current = id ? tools.get(id) : undefined;
        if (current) {
          const result = object(event.result);
          tools.set(id!, { ...current, output: string(result?.output) ?? safeJson(event.result) });
        }
      }
    }
  }
}

async function sessionState(path: string) {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Json;
    return {
      workDir: string(raw.workDir) ?? "",
      title: string(raw.title) ?? "",
      lastPrompt: string(raw.lastPrompt) ?? "",
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  } catch { return null; }
}

async function sessionDirectories(root: string): Promise<string[]> {
  try {
    const buckets = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(buckets.map(async (bucket) => {
      if (!bucket.isDirectory() || !bucket.name.startsWith("wd_")) return [];
      const bucketPath = join(root, bucket.name);
      const sessions = await readdir(bucketPath, { withFileTypes: true }).catch(() => []);
      return sessions
        .filter((session) => session.isDirectory() && session.name.startsWith("session_"))
        .map((session) => join(bucketPath, session.name));
    }));
    return nested.flat();
  } catch { return []; }
}

/* 与 codex/claude 同律：产品自己的 <product_context …> 信封不是用户说的话。 */
function promptText(input: unknown): string {
  if (typeof input === "string") return stripProductContext(input).trim();
  if (!Array.isArray(input)) return "";
  return input
    .map((item) => { const part = object(item); return part ? stripProductContext(string(part.text) ?? "") : ""; })
    .filter(Boolean)
    .join("\n")
    .trim();
}

const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const string = (value: unknown) => typeof value === "string" && value ? value : null;
const safeJson = (value: unknown) => { try { return JSON.stringify(value); } catch { return "[unserializable]"; } };
const emptyScan = (): AdapterScan => ({ sourceKind: "kimi", installed: false, entries: [], sourceRevision: "missing" });
async function storageFingerprint(root: string) { try { const value = await fingerprint(root); return digest(`${value.device}:${value.inode}`); } catch { return null; } }
