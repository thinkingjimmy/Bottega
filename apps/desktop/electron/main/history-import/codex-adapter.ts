/**
 * [INPUT]: Depends on Node fs/path/module, user home and history-import adapter
 * [OUTPUT]: Provides CodexHistoryAdapter; The first reading is attributed to filter + identity/full. Two read-only scans active/archive rollout, can stop the full text reading/double analysis, response_item/event_msg option one, task_complete, work time logging with state_5.sqlite alias/title, complete
 * [POS]: the history-import Codex CLI format adapter; SQLite is open with readOnly and as an independent source revision
 */

import { createRequire } from "node:module";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ForeignHistoryBlock, ForeignHistoryMessage, ForeignToolEvent } from "../../../shared/history-import-ipc";
import {
  HISTORY_FILE_BYTES,
  HISTORY_PARSER_VERSION,
  digest,
  escapedUnsupported,
  fingerprint,
  attachPendingTools,
  attachWorkedFor,
  drainTools,
  fingerprintRevision,
  humanTitle,
  historyParseCheckpoint,
  initialSourceIncarnation,
  isWithin,
  normalizedAliases,
  opaqueSessionId,
  readHeadLines,
  readStableJsonl,
  timestamp,
  type AdapterEntry,
  type AdapterScan,
  type HistoryAdapter,
  type ParsedHistory,
  type ScanDepth,
} from "./adapter";

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
            canResume: true, archived, incompleteTail: meta.incompleteTail, divergence: false,
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

  async parse(entry: AdapterEntry, signal?: AbortSignal): Promise<ParsedHistory> {
    const source = await readStableJsonl(entry.sourcePath, entry.fingerprint, signal);
    const records: Array<{ raw: Json; line: string; seq: number }> = [];
    let hasResponseMessages = false;
    for (const [index, line] of source.lines.entries()) {
      await historyParseCheckpoint(signal, index);
      try {
        const raw = JSON.parse(line) as Json;
        records.push({ raw, line, seq: index + 1 });
        const payload = object(raw.payload);
        if (raw.type === "response_item" && payload?.type === "message") hasResponseMessages = true;
      } catch {
        records.push({ raw: {}, line, seq: index + 1 });
      }
    }
    const blocks: ForeignHistoryBlock[] = [];
    const toolCalls = new Map<string, ForeignToolEvent>();
    for (const [index, record] of records.entries()) {
      await historyParseCheckpoint(signal, index);
      const payload = object(record.raw.payload);
      if (!Object.keys(record.raw).length) {
        blocks.push(unsupported(record.line, record.seq, "invalid-json"));
        continue;
      }
      if (record.raw.type === "response_item") {
        const block = responseItem(payload, record.raw.timestamp, record.seq, entry, toolCalls);
        if (block) {
          if (block.role === "user") attachPendingTools(blocks, toolCalls);
          blocks.push(block.role === "assistant" && toolCalls.size
            ? { ...block, tools: drainTools(toolCalls) }
            : block);
        }
        continue;
      }
      // runtime 的 turn 工时账：挂到本 turn 末条 assistant；两种流（response_item/event_msg）都在此拦截
      if (record.raw.type === "event_msg" && payload?.type === "task_complete") {
        attachWorkedFor(blocks, payload.duration_ms);
        continue;
      }
      if (!hasResponseMessages && record.raw.type === "event_msg") {
        const block = eventMessage(payload, record.raw.timestamp, record.seq, entry);
        if (block) blocks.push(block);
        continue;
      }
      if (["session_meta", "turn_context", "event_msg"].includes(String(record.raw.type))) continue;
      blocks.push(unsupported(record.line, record.seq, "unsupported-record"));
    }
    attachPendingTools(blocks, toolCalls);
    return { blocks, incompleteTail: source.incompleteTail };
  }
}

/**
 * 两档会话元数据。session_meta 位于 rollout 首行，头读即可裁决归属——
 * cwd 不属于本 Project 的文件（绝大多数）零全文成本跳过；subagent 内部线程
 * （guardian 审批评估、thread_spawn worker）继承父会话 cwd 但不是用户会话，
 * 同样在此排除。identity 档命中后以 stat 兜底呈现字段，full 档回到全文取
 * title/时间。头部未见 session_meta 的异形文件退回全文，不猜。
 * 64 MiB 上限在此统一裁决，两档收录结论必须一致。
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
  const source = await readStableJsonl(path);
  let cwd = "", sessionId = "", title = "";
  let createdAt = Number.POSITIVE_INFINITY, updatedAt = 0;
  for (const line of source.lines) {
    let raw: Json; try { raw = JSON.parse(line) as Json; } catch { continue; }
    const payload = object(raw.payload);
    const at = timestamp(raw.timestamp ?? payload?.timestamp, 0);
    if (at) { createdAt = Math.min(createdAt, at); updatedAt = Math.max(updatedAt, at); }
    if (raw.type === "session_meta") {
      if (subagentThread(payload)) return null;
      cwd ||= string(payload?.cwd) ?? "";
      sessionId ||= string(payload?.id) ?? "";
    }
    if (!title) title = codexMessageText(raw, "user");
  }
  if (!cwd || !isWithin(root, cwd)) return null;
  const fallback = await stat(path);
  return {
    cwd, sessionId, title, incompleteTail: source.incompleteTail,
    createdAt: Number.isFinite(createdAt) ? createdAt : timestamp(undefined, fallback.birthtimeMs),
    updatedAt: updatedAt || timestamp(undefined, fallback.mtimeMs),
  };
}

function responseItem(payload: Json | null, recordTimestamp: unknown, seq: number, entry: AdapterEntry, tools: Map<string, ForeignToolEvent>): ForeignHistoryMessage | null {
  if (!payload) return null;
  if (payload.type === "message") {
    const role = payload.role === "assistant" ? "assistant" : payload.role === "user" ? "user" : null;
    if (!role) return null;
    const content = contentText(payload.content);
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
  const content = string(payload.message) ?? string(payload.text) ?? "";
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
function codexMessageText(raw: Json, role: string) { const payload = object(raw.payload); return raw.type === "response_item" && payload?.type === "message" && payload.role === role ? contentText(payload.content) : raw.type === "event_msg" && payload?.type === `${role}_message` ? string(payload.message) ?? "" : ""; }
function contentText(value: unknown): string { if (typeof value === "string") return value; if (!Array.isArray(value)) return ""; return value.map((item) => { const part = object(item); if (!part || part.type === "reasoning" || part.type === "encrypted_content") return ""; return string(part.text) ?? string(part.output_text) ?? string(part.input_text) ?? ""; }).filter(Boolean).join("\n"); }
const injected = (value: string) => /<environment_context>|<developer>|<system>|# AGENTS\.md instructions/i.test(value);
/** subagent 线程（guardian 审批评估、thread_spawn worker）是运行时内部产物，不是用户会话 */
const subagentThread = (payload: Json | null) => payload?.thread_source === "subagent" || !!object(payload?.source)?.subagent;
function unsupported(line: string, seq: number, reason: string) { return { kind: "unsupported" as const, id: `unsupported-${seq}`, deliverySeq: seq, createdAt: 0, reason, escapedPreview: escapedUnsupported(line) }; }
const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const string = (value: unknown) => typeof value === "string" && value ? value : null;
const safeJson = (value: unknown) => { try { return JSON.stringify(value); } catch { return "[unserializable]"; } };
const emptyScan = (): AdapterScan => ({ sourceKind: "codex", installed: false, entries: [], sourceRevision: "missing" });
async function storageFingerprint(root: string) { try { const value = await fingerprint(root); return digest(`${value.device}:${value.inode}`); } catch { return null; } }
