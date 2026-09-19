/**
 * [INPUT]: Depends on Node fs/path/module, user home, the history-import adapter kernel (bounded fan-out, head reads, stable streams) and the shared turn-folding seam
 * [OUTPUT]: Provides CodexHistoryAdapter with a warm-able identity index (state_5.sqlite `threads.cwd` answers ownership, rollout heads only for files Codex has not indexed, both cached per adapter), active/archive scans, constant-memory metadata plus bounded two-pass JSONL streaming for response/event selection, tools, task duration, one-assistant-per-turn folding, and product-context envelope stripping in both messages and titles
 * [POS]: The history-import adapter for the Codex CLI format; state_5.sqlite is opened read-only for identities and per-entry titles, and each entry's revision moves only with its own file and its own title row
 */

import { createRequire } from "node:module";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ForeignHistoryMessage, ForeignToolEvent } from "../../../shared/history-import-ipc";
import {
  HISTORY_FILE_BYTES,
  HISTORY_PARSER_VERSION,
  SCAN_FANOUT,
  batchHistoryTurns,
  collectHistoryBatches,
  digest,
  fingerprint,
  attachPendingTools,
  attachWorkedFor,
  drainTools,
  fingerprintRevision,
  storageFingerprint,
  initialSourceIncarnation,
  isWithin,
  mapWithLimit,
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
import { envelopeFreeTitle, foldHistoryTurns, stripProductEnvelopes } from "./turn-folding";

type Json = Record<string, unknown>;
/** One `threads` row as Codex indexes it; `cwd`/`subagent` exist only when the schema carries them. */
type StateRow = { id: string; path?: string; cwd?: string; subagent?: boolean };
type CodexState = { byPath: Map<string, StateRow>; byId: Map<string, StateRow> };
/** What ownership needs to know about a rollout. A head is written once, so an identity never changes. */
type Identity = { cwd: string; sessionId: string; subagent: boolean };
type RolloutFile = { path: string; archived: boolean };
type IdentityIndex = { storage: string; state: CodexState; files: Array<RolloutFile & { identity: Identity | null }> };

export class CodexHistoryAdapter implements HistoryAdapter {
  readonly sourceKind = "codex" as const;
  readonly parserVersion = HISTORY_PARSER_VERSION;
  private readonly codexRoot: string;
  private readonly statePath: string;
  /* 每个 rollout 的头只写一次：cwd 与 id 之后再不会变，所以读到一次就记一辈子，
     重扫不再打开它。Codex 自己已索引的文件连这一次都省——直接读它的库。 */
  private readonly heads = new Map<string, Identity>();
  private state: { key: string; value: CodexState } | null = null;
  private indexFlight: Promise<IdentityIndex | null> | null = null;

  constructor(home: string) {
    this.codexRoot = join(home, ".codex");
    this.statePath = join(this.codexRoot, "state_5.sqlite");
  }

  /** 在文件夹还没选定时就把每个 rollout 的身份备好——选择器打开的那几秒足够。 */
  async warm() {
    await this.index();
  }

  async scanProject(canonicalRoot: string, depth: ScanDepth = "full"): Promise<AdapterScan> {
    const index = await this.index();
    if (!index) return emptyScan();
    const owned = index.files.filter((file): file is RolloutFile & { identity: Identity } =>
      Boolean(file.identity && !file.identity.subagent && isWithin(canonicalRoot, file.identity.cwd)));
    const rowOf = ({ path, identity }: RolloutFile & { identity: Identity }) =>
      index.state.byPath.get(path) ?? (identity.sessionId ? index.state.byId.get(identity.sessionId) : undefined);
    const titles = readCodexTitles(this.statePath, owned.flatMap((file) => rowOf(file)?.id ?? []));
    const entries = (await mapWithLimit(owned, SCAN_FANOUT, async (file): Promise<AdapterEntry | null> => {
      const { path, archived, identity } = file;
      try {
        const meta = depth === "identity" ? await quickMeta(path) : await fullMeta(path);
        if (!meta) return null;
        const value = await fingerprint(path, this.parserVersion);
        const db = rowOf(file);
        const dbTitle = db ? titles.get(db.id) : undefined;
        const stem = rolloutStem(path);
        const canonicalNativeId = db?.id || identity.sessionId || stem;
        const aliases = normalizedAliases([canonicalNativeId, db?.id, identity.sessionId, stem]);
        const key = {
          sourceKind: this.sourceKind,
          storageFingerprint: index.storage,
          canonicalNativeId,
          aliases,
          resumeAlias: identity.sessionId || db?.id || stem,
        } as const;
        return {
          opaqueId: opaqueSessionId(key), projectId: "", sourceKind: this.sourceKind, key,
          /* state 库的标题是另一路来路：它没走正文那条剥离路径，产品信封会
             原样爬进侧栏——剥完为空就退回消息正文推出的标题。 */
          title: envelopeFreeTitle(dbTitle, meta.title, "Codex 会话"), cwd: identity.cwd,
          createdAt: meta.createdAt, updatedAt: meta.updatedAt,
          /* 只随自己的文件与自己那行标题走；从前整张 threads 表的摘要都在里面，
             别处新开一个会话就让这里每条历史换代。 */
          historyRevision: digest(`${fingerprintRevision(value)}:${dbTitle ?? ""}`),
          canResume: true, archived, incompleteTail: meta.incompleteTail,
          sourceIncarnation: initialSourceIncarnation(key, value),
          sourcePath: path, fingerprint: value,
        };
      } catch {
        /* 逐文件 fail-soft：EACCES、活跃写入与损坏文件一律跳过，整条来源不受累 */
        return null;
      }
    })).filter((entry): entry is AdapterEntry => entry !== null);
    entries.sort((left, right) => right.createdAt - left.createdAt || left.opaqueId.localeCompare(right.opaqueId));
    return {
      sourceKind: this.sourceKind,
      installed: true,
      entries,
      sourceRevision: digest(entries.map((entry) => entry.historyRevision).join("\0")),
    };
  }

  /** 同一时刻只建一份索引：预热还在跑时选定了文件夹，扫描直接搭那趟车。 */
  private index() {
    if (this.indexFlight) return this.indexFlight;
    const flight = this.buildIndex().finally(() => {
      if (this.indexFlight === flight) this.indexFlight = null;
    });
    this.indexFlight = flight;
    return flight;
  }

  private async buildIndex(): Promise<IdentityIndex | null> {
    const storage = await storageFingerprint(this.codexRoot);
    if (!storage) return null;
    const [state, files] = await Promise.all([this.readState(), rolloutFiles(this.codexRoot)]);
    const resolved = await mapWithLimit(files, SCAN_FANOUT, async (file) => ({ ...file, identity: await this.identity(file.path, state) }));
    return { storage, state, files: resolved };
  }

  private async identity(path: string, state: CodexState): Promise<Identity | null> {
    const row = state.byPath.get(path);
    if (row?.cwd) return { cwd: row.cwd, sessionId: row.id, subagent: Boolean(row.subagent) };
    const cached = this.heads.get(path);
    if (cached) return cached;
    const read = await readIdentity(path).catch(() => null);
    if (read) this.heads.set(path, read);
    return read;
  }

  /* 库本身 200 MB、WAL 常改：按主文件与 -wal 的 size/mtime 记一份，没变就不重读。
     读到旧一拍也无妨——库里没有的文件一律退回读头，答案不会因此缺失。 */
  private async readState(): Promise<CodexState> {
    const key = await stateKey(this.statePath);
    if (this.state?.key === key) return this.state.value;
    const value = readCodexState(this.statePath);
    this.state = { key, value };
    return value;
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

/* ── 身份与呈现是两次读 ────────────────────────────────────────
 * 归属只看 session_meta（rollout 首行）：头读一次即可裁决，cwd 不属于本
 * Project 的文件零全文成本跳过；subagent 内部线程（guardian 审批评估、
 * thread_spawn worker）继承父会话 cwd 但不是用户会话，同样在此排除。头部
 * 未见 session_meta 的异形文件退回全文找，不猜。
 * 呈现字段另读：identity 档以 stat 兜底，full 档回到全文取 title/时间。
 * 4 GiB 流式上限在此统一裁决，两档收录结论必须一致。
 * ────────────────────────────────────────────────────────── */
async function readIdentity(path: string): Promise<Identity | null> {
  if ((await stat(path)).size > HISTORY_FILE_BYTES) return null;
  const head = await readHeadLines(path);
  const found = identityIn(head.lines);
  if (found || head.sawWholeFile) return found;
  return streamIdentity(path);
}

function identityIn(lines: Iterable<string>): Identity | null {
  let cwd = "", sessionId = "", subagent = false;
  for (const line of lines) {
    let raw: Json; try { raw = JSON.parse(line) as Json; } catch { continue; }
    if (raw.type !== "session_meta") continue;
    const payload = object(raw.payload);
    subagent ||= subagentThread(payload);
    cwd ||= string(payload?.cwd) ?? "";
    sessionId ||= string(payload?.id) ?? "";
    if (cwd && sessionId) break;
  }
  return cwd ? { cwd, sessionId, subagent } : null;
}

async function streamIdentity(path: string): Promise<Identity | null> {
  const source = streamStableJsonl(path);
  while (true) {
    const next = await source.next();
    if (next.done) return null;
    const found = identityIn([next.value.line]);
    if (found) {
      await source.return(false);
      return found;
    }
  }
}

async function quickMeta(path: string) {
  const fallback = await stat(path);
  if (fallback.size > HISTORY_FILE_BYTES) return null;
  return {
    title: "",
    incompleteTail: false,
    createdAt: timestamp(undefined, fallback.birthtimeMs),
    updatedAt: timestamp(undefined, fallback.mtimeMs),
  };
}

async function fullMeta(path: string) {
  const fallback = await stat(path);
  if (fallback.size > HISTORY_FILE_BYTES) return null;
  const source = streamStableJsonl(path);
  let title = "";
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
    if (!title) title = codexMessageText(raw, "user");
  }
  return {
    title, incompleteTail,
    createdAt: Number.isFinite(createdAt) ? createdAt : timestamp(undefined, fallback.birthtimeMs),
    updatedAt: updatedAt || timestamp(undefined, fallback.mtimeMs),
  };
}

function responseItem(payload: Json | null, recordTimestamp: unknown, seq: number, entry: AdapterEntry, tools: Map<string, ForeignToolEvent>): ForeignHistoryMessage | null {
  if (!payload) return null;
  if (payload.type === "message") {
    const role = payload.role === "assistant" ? "assistant" : payload.role === "user" ? "user" : null;
    if (!role) return null;
    const content = stripProductEnvelopes(contentText(payload.content));
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
  const content = stripProductEnvelopes(string(payload.message) ?? string(payload.text) ?? "");
  if (!role || !content.trim() || injected(content)) return null;
  const id = string(payload.id) ?? `${role}-${seq}`;
  return { kind: "message", id, nativeTurnId: id, deliverySeq: seq, role, content, createdAt: timestamp(recordTimestamp ?? payload.timestamp, entry.createdAt) };
}

/* ── Codex 自己的库 ─────────────────────────────────────────────
 * `threads` 表带 rollout_path / cwd / source：归属问题它 0.1 秒就能答，
 * 而逐个读 4,090 个 rollout 的头要 2 秒。列名按候选探测，认不出的 schema
 * 退回读头；库不存在、锁住或损坏同样退回——库是头的缓存，不是真相的替身。
 * 标题另查：`title` 列存的是整句首条消息（本机 4k 行合计 55 MB），只在
 * 命中的那几行上点查。
 * ────────────────────────────────────────────────────────── */
type ThreadsSchema = { table: string; id: string; title?: string; rollout?: string; cwd?: string; source?: string };
type SqliteDatabase = { prepare(sql: string): { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown }; close(): void };

function withCodexState<T>(path: string, fallback: T, read: (db: SqliteDatabase, schema: ThreadsSchema) => T): T {
  let sqlite; try { sqlite = requireSqlite().DatabaseSync; } catch { return fallback; }
  try {
    const db = new sqlite(path, { readOnly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
      const table = tables.find((item) => ["threads", "sessions"].includes(item.name));
      if (!table) return fallback;
      const columns = db.prepare(`PRAGMA table_info(${table.name})`).all() as Array<{ name: string }>;
      const names = new Set(columns.map((column) => column.name));
      const id = first(names, ["id", "thread_id", "session_id"]);
      if (!id) return fallback;
      return read(db, {
        table: table.name, id,
        title: first(names, ["title", "name"]),
        rollout: first(names, ["rollout_path", "path", "file_path"]),
        cwd: first(names, ["cwd", "working_directory"]),
        source: first(names, ["source"]),
      });
    } finally { db.close(); }
  } catch { return fallback; }
}

const emptyState = (): CodexState => ({ byPath: new Map(), byId: new Map() });

function readCodexState(path: string): CodexState {
  return withCodexState(path, emptyState(), (db, schema) => {
    const selected = [schema.id, schema.rollout, schema.cwd, schema.source].filter(Boolean).join(", ");
    const rows = db.prepare(`SELECT ${selected} FROM ${schema.table}`).all() as Json[];
    const state = emptyState();
    for (const raw of rows) {
      const row: StateRow = { id: String(raw[schema.id]) };
      const rollout = schema.rollout ? string(raw[schema.rollout]) : null;
      const cwd = schema.cwd ? string(raw[schema.cwd]) : null;
      if (rollout) row.path = rollout;
      if (cwd) row.cwd = cwd;
      if (schema.source && subagentSource(raw[schema.source])) row.subagent = true;
      state.byId.set(row.id, row);
      if (rollout) state.byPath.set(rollout, row);
    }
    return state;
  });
}

function readCodexTitles(path: string, ids: string[]): Map<string, string> {
  if (!ids.length) return new Map();
  return withCodexState(path, new Map<string, string>(), (db, schema) => {
    const titles = new Map<string, string>();
    if (!schema.title) return titles;
    const lookup = db.prepare(`SELECT ${schema.title} AS title FROM ${schema.table} WHERE ${schema.id} = ?`);
    for (const id of new Set(ids)) {
      const title = string(object(lookup.get(id))?.title);
      if (title) titles.set(id, title);
    }
    return titles;
  });
}

/** 库里的 `source` 是 `cli`/`vscode`/`exec` 这样的字面量，或 subagent 线程的一段 JSON。 */
function subagentSource(value: unknown) {
  const source = string(value);
  if (!source?.startsWith("{")) return false;
  try { return !!object(JSON.parse(source))?.subagent; } catch { return false; }
}

async function stateKey(path: string) {
  const parts = await Promise.all([path, `${path}-wal`].map(async (candidate) => {
    try { const value = await stat(candidate); return `${value.size}:${value.mtimeMs}`; } catch { return "-"; }
  }));
  return parts.join("|");
}

const requireSqlite = () => createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new(path: string, options: { readOnly: boolean }) => SqliteDatabase };
const first = (names: Set<string>, candidates: string[]) => candidates.find((name) => names.has(name));
async function rolloutFiles(codexRoot: string): Promise<RolloutFile[]> {
  const walk = async (root: string): Promise<string[]> => {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      const nested = await Promise.all(entries.map((entry) => {
        const path = join(root, entry.name);
        return entry.isDirectory() ? walk(path) : entry.isFile() && entry.name.endsWith(".jsonl") ? [path] : [];
      }));
      return nested.flat();
    } catch { return []; }
  };
  const [active, archived] = await Promise.all([walk(join(codexRoot, "sessions")), walk(join(codexRoot, "archived_sessions"))]);
  return [...active.map((path) => ({ path, archived: false })), ...archived.map((path) => ({ path, archived: true }))];
}
const rolloutStem = (path: string) => basename(path, ".jsonl").split("-").at(-1) ?? basename(path, ".jsonl");
/* 标题只认用户自己写下的那句话：产品信封先剥，剥空即换下一条候选。 */
function codexMessageText(raw: Json, role: string) { const payload = object(raw.payload); return stripProductEnvelopes(raw.type === "response_item" && payload?.type === "message" && payload.role === role ? contentText(payload.content) : raw.type === "event_msg" && payload?.type === `${role}_message` ? string(payload.message) ?? "" : ""); }
function contentText(value: unknown): string { if (typeof value === "string") return value; if (!Array.isArray(value)) return ""; return value.map((item) => { const part = object(item); if (!part || part.type === "reasoning" || part.type === "encrypted_content") return ""; return string(part.text) ?? string(part.output_text) ?? string(part.input_text) ?? ""; }).filter(Boolean).join("\n"); }
const injected = (value: string) => /<environment_context>|<developer>|<system>|# AGENTS\.md instructions/i.test(value);
/** subagent 线程（guardian 审批评估、thread_spawn worker）是运行时内部产物，不是用户会话 */
const subagentThread = (payload: Json | null) => payload?.thread_source === "subagent" || !!object(payload?.source)?.subagent;
const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const string = (value: unknown) => typeof value === "string" && value ? value : null;
const safeJson = (value: unknown) => { try { return JSON.stringify(value); } catch { return "[unserializable]"; } };
const emptyScan = (): AdapterScan => ({ sourceKind: "codex", installed: false, entries: [], sourceRevision: "missing" });
