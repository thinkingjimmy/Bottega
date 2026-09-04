/**
 * [INPUT]: Depends on Node fs/path/module, user home, the history-import adapter kernel and the shared turn-folding seam
 * [OUTPUT]: Provides CodexHistoryAdapter with active/archive scans and constant-memory metadata plus bounded two-pass JSONL streaming for response/event selection, tools, task duration, state metadata, one-assistant-per-turn folding, and product-context envelope stripping in both messages and titles
 * [POS]: the history-import Codex CLI format adapter; SQLite is open with readOnly and as an independent source revision
 */

import { createRequire } from "node:module";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ForeignHistoryMessage, ForeignToolEvent } from "../../../shared/history-import-ipc";
import {
  HISTORY_FILE_BYTES,
  HISTORY_PARSER_VERSION,
  batchHistoryTurns,
  collectHistoryBatches,
  digest,
  fingerprint,
  attachPendingTools,
  attachWorkedFor,
  drainTools,
  fingerprintRevision,
  humanTitle,
  initialSourceIncarnation,
  isWithin,
  normalizedAliases,
  opaqueSessionId,
  readHeadLines,
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
type StateMeta = { id: string; title?: string; path?: string };

export class CodexHistoryAdapter implements HistoryAdapter {
  readonly sourceKind = "codex" as const;
  readonly parserVersion = HISTORY_PARSER_VERSION;
  private readonly codexRoot: string;

  constructor(home: string) { this.codexRoot = join(home, ".codex"); }

  async scanProject(canonicalRoot: string, depth: ScanDepth = "full"): Promise<AdapterScan> {
    const storage = await storageFingerprint(this.codexRoot);
    if (!storage) return emptyScan();
    const state = readCodexState(join(this.codexRoot, "state_5.sqlite"));
    const stateByPath = new Map(state.rows.flatMap((row) => row.path ? [[row.path, row] as const] : []));
    const entries: AdapterEntry[] = [];
    for (const [directory, archived] of [
      [join(this.codexRoot, "sessions"), false],
      [join(this.codexRoot, "archived_sessions"), true],
    ] as const) {
      for (const path of await rolloutFiles(directory)) {
        try {
          const meta = await sessionMeta(path, canonicalRoot, depth);
          if (!meta) continue;
          const value = await fingerprint(path, this.parserVersion);
          const db = stateByPath.get(path) ?? state.rows.find((row) => row.id === meta.sessionId);
          const stem = rolloutStem(path);
          const canonicalNativeId = db?.id || meta.sessionId || stem;
          const aliases = normalizedAliases([canonicalNativeId, db?.id, meta.sessionId, stem]);
          const key = {
            sourceKind: this.sourceKind,
            storageFingerprint: storage,
            canonicalNativeId,
            aliases,
            resumeAlias: meta.sessionId || db?.id || stem,
          } as const;
          entries.push({
            opaqueId: opaqueSessionId(key), projectId: "", sourceKind: this.sourceKind, key,
            title: humanTitle(db?.title || meta.title || "Codex 会话"), cwd: meta.cwd,
            createdAt: meta.createdAt, updatedAt: meta.updatedAt,
            historyRevision: digest(`${fingerprintRevision(value)}:${state.revision}`),
            canResume: true, archived, incompleteTail: meta.incompleteTail,
            sourceIncarnation: initialSourceIncarnation(key, value),
            sourcePath: path, fingerprint: value,
          });
        } catch {
          /* 逐文件 fail-soft：EACCES、活跃写入与损坏文件一律跳过，整条来源不受累 */
        }
      }
    }
    entries.sort((left, right) => right.createdAt - left.createdAt || left.opaqueId.localeCompare(right.opaqueId));
    return {
      sourceKind: this.sourceKind,
      installed: true,
      entries,
      sourceRevision: digest(`${state.revision}:${entries.map((entry) => entry.historyRevision).join("\0")}`),
    };
  }

  parseBatches(entry: AdapterEntry, signal?: AbortSignal): HistoryBlockBatches {
    return batchHistoryTurns(foldHistoryTurns(this.parseTurns(entry, signal), signal), signal);
  }

  async parse(entry: AdapterEntry, signal?: AbortSignal): Promise<ParsedHistory> {
    return collectHistoryBatches(this.parseBatches(entry, signal));
  }

  /* rollout 是 runtime 的日志，不是对话稿：session_meta/turn_context/
     event_msg/world_state/compacted 都是运行时记录，不是谁说过的话。
     这里不列白名单——凡不是用户/助手消息的记录一律跳过，Codex 明天新增
     的第六种记录不需要我们再改一行代码。 */
  private async *parseTurns(
    entry: AdapterEntry,
    signal?: AbortSignal
  ): HistoryBlockTurns {
    const hasResponseMessages = await containsResponseMessages(entry, signal);
    const source = streamStableJsonl(entry.sourcePath, entry.fingerprint, signal);
    let blocks: ForeignHistoryMessage[] = [];
    const toolCalls = new Map<string, ForeignToolEvent>();
    const flush = () => {
      if (!blocks.length) return [];
      const ready = blocks;
      blocks = [];
      return ready;
    };
    while (true) {
      const next = await source.next();
      if (next.done) {
        attachPendingTools(blocks, toolCalls);
        const ready = flush();
        if (ready.length) yield ready;
        return next.value;
      }
      const { line, index } = next.value;
      const seq = index + 1;
      let raw: Json;
      try { raw = JSON.parse(line) as Json; }
      catch { raw = {}; }
      const payload = object(raw.payload);
      if (!Object.keys(raw).length) continue;
      if (raw.type === "response_item") {
        const block = responseItem(payload, raw.timestamp, seq, entry, toolCalls);
        if (block) {
          if (block.role === "user") {
            attachPendingTools(blocks, toolCalls);
            const ready = flush();
            if (ready.length) yield ready;
          }
          blocks.push(block.role === "assistant" && toolCalls.size
            ? { ...block, tools: drainTools(toolCalls) }
            : block);
        }
        continue;
      }
      // runtime 的 turn 工时账：挂到本 turn 末条 assistant；两种流（response_item/event_msg）都在此拦截
      if (raw.type === "event_msg" && payload?.type === "task_complete") {
        attachWorkedFor(blocks, payload.duration_ms);
        continue;
      }
      if (!hasResponseMessages && raw.type === "event_msg") {
        const block = eventMessage(payload, raw.timestamp, seq, entry);
        if (block) {
          if (block.role === "user") {
            const ready = flush();
            if (ready.length) yield ready;
          }
          blocks.push(block);
        }
        continue;
      }
    }
  }
}

async function containsResponseMessages(entry: AdapterEntry, signal?: AbortSignal) {
  const source = streamStableJsonl(entry.sourcePath, entry.fingerprint, signal);
  while (true) {
    const next = await source.next();
    if (next.done) return false;
    try {
      const raw = JSON.parse(next.value.line) as Json;
      const payload = object(raw.payload);
      if (raw.type === "response_item" && payload?.type === "message") {
        await source.return(false);
        return true;
      }
    } catch {
      /* Invalid records are surfaced during the second, publishing pass. */
    }
  }
}

/**
 * 两档会话元数据。session_meta 位于 rollout 首行，头读即可裁决归属——
 * cwd 不属于本 Project 的文件（绝大多数）零全文成本跳过；subagent 内部线程
 * （guardian 审批评估、thread_spawn worker）继承父会话 cwd 但不是用户会话，
 * 同样在此排除。identity 档命中后以 stat 兜底呈现字段，full 档回到全文取
 * title/时间。头部未见 session_meta 的异形文件退回全文，不猜。
 * 4 GiB 流式上限在此统一裁决，两档收录结论必须一致。
 */
async function sessionMeta(path: string, root: string, depth: ScanDepth) {
  const fallback = await stat(path);
  if (fallback.size > HISTORY_FILE_BYTES) return null;
  const head = await readHeadLines(path);
  let cwd = "", sessionId = "";
  for (const line of head.lines) {
    let raw: Json; try { raw = JSON.parse(line) as Json; } catch { continue; }
    if (raw.type !== "session_meta") continue;
    const payload = object(raw.payload);
    if (subagentThread(payload)) return null;
    cwd ||= string(payload?.cwd) ?? "";
    sessionId ||= string(payload?.id) ?? "";
    if (cwd && sessionId) break;
  }
  if (cwd && !isWithin(root, cwd)) return null;
  if (depth === "identity" && cwd && sessionId) {
    return {
      cwd,
      sessionId,
      title: "",
      incompleteTail: false,
      createdAt: timestamp(undefined, fallback.birthtimeMs),
      updatedAt: timestamp(undefined, fallback.mtimeMs),
    };
  }
  return fullMeta(path, root);
}

async function fullMeta(path: string, root: string) {
  const source = streamStableJsonl(path);
  let cwd = "", sessionId = "", title = "";
  let createdAt = Number.POSITIVE_INFINITY, updatedAt = 0;
  let incompleteTail = false;
  while (true) {
    const next = await source.next();
    if (next.done) {
      incompleteTail = next.value;
      break;
    }
    const { line } = next.value;
    let raw: Json; try { raw = JSON.parse(line) as Json; } catch { continue; }
    const payload = object(raw.payload);
    const at = timestamp(raw.timestamp ?? payload?.timestamp, 0);
    if (at) { createdAt = Math.min(createdAt, at); updatedAt = Math.max(updatedAt, at); }
    if (raw.type === "session_meta") {
      if (subagentThread(payload)) {
        await source.return(false);
        return null;
      }
      cwd ||= string(payload?.cwd) ?? "";
      sessionId ||= string(payload?.id) ?? "";
    }
    if (!title) title = codexMessageText(raw, "user");
  }
  if (!cwd || !isWithin(root, cwd)) return null;
  const fallback = await stat(path);
  return {
    cwd, sessionId, title, incompleteTail,
    createdAt: Number.isFinite(createdAt) ? createdAt : timestamp(undefined, fallback.birthtimeMs),
    updatedAt: updatedAt || timestamp(undefined, fallback.mtimeMs),
  };
}

function responseItem(payload: Json | null, recordTimestamp: unknown, seq: number, entry: AdapterEntry, tools: Map<string, ForeignToolEvent>): ForeignHistoryMessage | null {
  if (!payload) return null;
  if (payload.type === "message") {
    const role = payload.role === "assistant" ? "assistant" : payload.role === "user" ? "user" : null;
    if (!role) return null;
    const content = stripProductContext(contentText(payload.content));
    if (!content.trim() || injected(content)) return null;
    const id = string(payload.id) ?? `${role}-${seq}`;
    return { kind: "message", id, nativeTurnId: id, deliverySeq: seq, role, content, createdAt: timestamp(recordTimestamp ?? payload.timestamp, entry.createdAt) };
  }
  if (payload.type === "function_call") {
    const id = string(payload.call_id) ?? string(payload.id) ?? `tool-${seq}`;
    tools.set(id, { id, name: string(payload.name) ?? "tool", input: string(payload.arguments) ?? safeJson(payload.arguments) });
  }
  if (payload.type === "function_call_output") {
    const id = string(payload.call_id);
    const current = id ? tools.get(id) : undefined;
    if (current) tools.set(id!, { ...current, output: contentText(payload.output) });
  }
  return null;
}

function eventMessage(payload: Json | null, recordTimestamp: unknown, seq: number, entry: AdapterEntry): ForeignHistoryMessage | null {
  if (!payload) return null;
  const role = payload.type === "agent_message" ? "assistant" : payload.type === "user_message" ? "user" : null;
  const content = stripProductContext(string(payload.message) ?? string(payload.text) ?? "");
  if (!role || !content.trim() || injected(content)) return null;
  const id = string(payload.id) ?? `${role}-${seq}`;
  return { kind: "message", id, nativeTurnId: id, deliverySeq: seq, role, content, createdAt: timestamp(recordTimestamp ?? payload.timestamp, entry.createdAt) };
}

function readCodexState(path: string): { rows: StateMeta[]; revision: string } {
  let value; try { value = requireSqlite().DatabaseSync; } catch { return { rows: [], revision: "unavailable" }; }
  try {
    const db = new value(path, { readOnly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
      const table = tables.find((item) => ["threads", "sessions"].includes(item.name));
      if (!table) return { rows: [], revision: "empty" };
      const columns = db.prepare(`PRAGMA table_info(${table.name})`).all() as Array<{ name: string }>;
      const names = new Set(columns.map((column) => column.name));
      const id = first(names, ["id", "thread_id", "session_id"]);
      if (!id) return { rows: [], revision: "unknown-schema" };
      const title = first(names, ["title", "name"]);
      const rollout = first(names, ["rollout_path", "path", "file_path"]);
      const selected = [id, title, rollout].filter(Boolean).join(", ");
      const rows = db.prepare(`SELECT ${selected} FROM ${table.name}`).all() as Json[];
      const normalized = rows.map((row) => ({
        id: String(row[id]),
        ...(title && typeof row[title] === "string" ? { title: row[title] as string } : {}),
        ...(rollout && typeof row[rollout] === "string" ? { path: row[rollout] as string } : {}),
      }));
      return { rows: normalized, revision: digest(JSON.stringify(normalized)) };
    } finally { db.close(); }
  } catch { return { rows: [], revision: "unreadable" }; }
}

const requireSqlite = () => createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new(path: string, options: { readOnly: boolean }) => { prepare(sql: string): { all(): unknown[] }; close(): void } };
const first = (names: Set<string>, candidates: string[]) => candidates.find((name) => names.has(name));
async function rolloutFiles(root: string): Promise<string[]> { try { const entries = await readdir(root, { withFileTypes: true }); const nested = await Promise.all(entries.map((entry) => { const path = join(root, entry.name); return entry.isDirectory() ? rolloutFiles(path) : entry.isFile() && entry.name.endsWith(".jsonl") ? [path] : []; })); return nested.flat(); } catch { return []; } }
const rolloutStem = (path: string) => basename(path, ".jsonl").split("-").at(-1) ?? basename(path, ".jsonl");
/* 标题只认用户自己写下的那句话：产品信封先剥，剥空即换下一条候选。 */
function codexMessageText(raw: Json, role: string) { const payload = object(raw.payload); return stripProductContext(raw.type === "response_item" && payload?.type === "message" && payload.role === role ? contentText(payload.content) : raw.type === "event_msg" && payload?.type === `${role}_message` ? string(payload.message) ?? "" : ""); }
function contentText(value: unknown): string { if (typeof value === "string") return value; if (!Array.isArray(value)) return ""; return value.map((item) => { const part = object(item); if (!part || part.type === "reasoning" || part.type === "encrypted_content") return ""; return string(part.text) ?? string(part.output_text) ?? string(part.input_text) ?? ""; }).filter(Boolean).join("\n"); }
const injected = (value: string) => /<environment_context>|<developer>|<system>|# AGENTS\.md instructions/i.test(value);
/** subagent 线程（guardian 审批评估、thread_spawn worker）是运行时内部产物，不是用户会话 */
const subagentThread = (payload: Json | null) => payload?.thread_source === "subagent" || !!object(payload?.source)?.subagent;
const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const string = (value: unknown) => typeof value === "string" && value ? value : null;
const safeJson = (value: unknown) => { try { return JSON.stringify(value); } catch { return "[unserializable]"; } };
const emptyScan = (): AdapterScan => ({ sourceKind: "codex", installed: false, entries: [], sourceRevision: "missing" });
async function storageFingerprint(root: string) { try { const value = await fingerprint(root); return digest(`${value.device}:${value.inode}`); } catch { return null; } }
