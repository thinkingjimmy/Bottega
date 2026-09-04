/**
 * [INPUT]: Depends on Node module/path, user home(XDG_DATA_HOME missing ~/.local/share) with history-import adapter Public core
 * [OUTPUT]: Provides OpencodeHistoryAdapter with read-only session scans and transaction-fenced paged message streams, revision checks, limits, tools, duration, product-context envelope stripping, and one-assistant-per-turn folding
 * [POS]: The history-import OpenCode format adapter; The session_message migration target is empty and can be switched to todo/08-22-kimi-opencode-history-import.md L1); WAL search for read to keep single-generation snapshots
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import type { ForeignHistoryMessage, ForeignToolEvent } from "../../../shared/history-import-ipc";
import {
  HISTORY_PARSER_VERSION,
  batchHistoryTurns,
  collectHistoryBatches,
  digest,
  fingerprint,
  humanTitle,
  initialSourceIncarnation,
  isWithin,
  normalizedAliases,
  opaqueSessionId,
  timestamp,
  type AdapterEntry,
  type AdapterScan,
  type HistoryAdapter,
  type HistoryBlockBatches,
  type HistoryBlockTurns,
  type ParsedHistory,
  type ScanDepth,
  yieldHistoryParse,
} from "./adapter";
import { foldHistoryTurns, stripProductContext } from "./turn-folding";
import { HISTORY_FILE_BYTES } from "./adapter";

type Json = Record<string, unknown>;
type Row = Record<string, unknown>;

const UNNAMED_TITLE = /^New session - /;
const SQLITE_PAGE_ROWS = 128;

type PendingMessage = {
  id: string;
  timeCreated: unknown;
  data: string | null;
  parts: Json[];
  deliverySeq: number;
};
type ParseState = { current: PendingMessage | null; nextDeliverySeq: number };

export class OpencodeHistoryAdapter implements HistoryAdapter {
  readonly sourceKind = "opencode" as const;
  readonly parserVersion = HISTORY_PARSER_VERSION;
  private readonly databasePath: string;

  constructor(home: string, env: NodeJS.ProcessEnv = process.env) {
    const dataRoot = env.XDG_DATA_HOME?.trim() || join(home, ".local", "share");
    this.databasePath = join(dataRoot, "opencode", "opencode.db");
  }

  async scanProject(canonicalRoot: string, _depth: ScanDepth = "full"): Promise<AdapterScan> {
    let value; try { value = await fingerprint(this.databasePath, this.parserVersion); } catch { return emptyScan(); }
    const storage = digest(`${value.device}:${value.inode}`);
    const entries: AdapterEntry[] = [];
    try {
      withDatabase(this.databasePath, (db) => {
        const rows = db.prepare(
          "SELECT id, directory, title, time_created, time_updated, time_archived FROM session WHERE parent_id IS NULL"
        ).all() as Row[];
        const fallbackTitles = unnamedFallbackTitles(db, rows);
        for (const row of rows) {
          const id = asString(row.id), directory = asString(row.directory);
          if (!id || !directory || !isWithin(canonicalRoot, directory)) continue;
          const storedTitle = asString(row.title) ?? "";
          const title = UNNAMED_TITLE.test(storedTitle)
            ? fallbackTitles.get(id) ?? storedTitle
            : storedTitle;
          const key = {
            sourceKind: this.sourceKind,
            storageFingerprint: storage,
            canonicalNativeId: id,
            aliases: normalizedAliases([id]),
            resumeAlias: id,
          } as const;
          const updatedAt = timestamp(row.time_updated, 0);
          entries.push({
            opaqueId: opaqueSessionId(key), projectId: "", sourceKind: this.sourceKind, key,
            title: humanTitle(title || "OpenCode 会话"), cwd: directory,
            createdAt: timestamp(row.time_created, updatedAt), updatedAt,
            /* 库级 mtime 拼 per-session time_updated：别的会话写库不轮换本行 revision */
            historyRevision: digest(`${id}:${String(row.time_updated)}`),
            /* 产品同径 session/resume 已对非 ACP 家族会话真机闭环：
             * DEV/agents/probes/opencode/resume.mjs + verified-capabilities 2026-08-23。 */
            canResume: true, archived: row.time_archived != null, incompleteTail: false,
            sourceIncarnation: initialSourceIncarnation(key, value),
            sourcePath: this.databasePath, fingerprint: value,
          });
        }
      });
    } catch { return emptyScan(); }
    entries.sort((left, right) => right.createdAt - left.createdAt || left.opaqueId.localeCompare(right.opaqueId));
    return {
      sourceKind: this.sourceKind,
      installed: true,
      entries,
      sourceRevision: digest(entries.map((entry) => entry.historyRevision).join("\0")),
    };
  }

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
    const db = new (requireSqlite().DatabaseSync)(this.databasePath, { readOnly: true });
    try {
      signal?.throwIfAborted();
      db.exec("BEGIN");
      let committed = false;
      try {
        assertSessionRevision(db, entry);
        const state: ParseState = { current: null, nextDeliverySeq: 1 };
        let offset = 0;
        let bytes = 0;
        while (true) {
          await yieldHistoryParse(signal);
          const page = db.prepare(
            "SELECT m.id AS message_id, m.time_created AS time_created, m.data AS message_data, " +
            "p.id AS part_id, p.data AS part_data FROM message m " +
            "LEFT JOIN part p ON p.message_id = m.id AND p.session_id = m.session_id " +
            "WHERE m.session_id = ? ORDER BY m.time_created, m.id, p.id LIMIT ? OFFSET ?"
          ).all(entry.key.canonicalNativeId, SQLITE_PAGE_ROWS, offset) as Row[];
          if (!page.length) break;
          for (const row of page) {
            bytes += Buffer.byteLength(asString(row.message_data) ?? "", "utf8");
            bytes += Buffer.byteLength(asString(row.part_data) ?? "", "utf8");
          }
          if (bytes > HISTORY_FILE_BYTES) throw new Error("HISTORY_OVERSIZE");
          const ready = consumeRows(page, state, entry);
          if (ready.length) yield ready;
          offset += page.length;
        }
        const last = takeMessage(state, entry);
        if (last) yield [last];
        assertSessionRevision(db, entry);
        db.exec("COMMIT");
        committed = true;
        assertSessionRevision(db, entry);
      } finally {
        if (!committed) {
          try { db.exec("ROLLBACK"); } catch { /* 原错误优先 */ }
        }
      }
      return false;
    } finally {
      db.close();
    }
  }
}

function consumeRows(page: Row[], state: ParseState, entry: AdapterEntry) {
  const blocks: ForeignHistoryMessage[] = [];
  for (const row of page) {
    const messageId = asString(row.message_id);
    if (!messageId) continue;
    if (messageId !== state.current?.id) {
      const ready = takeMessage(state, entry);
      if (ready) blocks.push(ready);
      state.current = {
        id: messageId,
        timeCreated: row.time_created,
        data: asString(row.message_data),
        parts: [],
        deliverySeq: state.nextDeliverySeq++,
      };
    }
    const part = parseJson(asString(row.part_data));
    if (part) state.current.parts.push(part);
  }
  return blocks;
}

function takeMessage(state: ParseState, entry: AdapterEntry): ForeignHistoryMessage | null {
  const row = state.current;
  if (!row) return null;
  state.current = null;
  const data = parseJson(row.data);
  const role = data?.role === "assistant" ? "assistant" : data?.role === "user" ? "user" : null;
  if (!role) return null;
  /* 与 codex/claude 同律：产品自己的 <product_context …> 信封不是用户说的话。 */
  const content = row.parts.filter((part) => part.type === "text")
    .map((part) => stripProductContext(asString(part.text) ?? "")).filter(Boolean).join("\n").trim();
  const tools = role === "assistant" ? toolEvents(row.parts) : [];
  if (!content && !tools.length) return null;
  const time = object(data?.time);
  const workedForMs = role === "assistant" ? durationOf(time) : undefined;
  return {
    kind: "message", id: row.id, nativeTurnId: row.id,
    deliverySeq: row.deliverySeq, role, content: content || "（仅工具活动）",
    createdAt: timestamp(time?.created ?? row.timeCreated, entry.createdAt),
    ...(tools.length ? { tools } : {}),
    ...(workedForMs !== undefined ? { workedForMs } : {}),
  } satisfies ForeignHistoryMessage;
}

function assertSessionRevision(db: Database, entry: AdapterEntry) {
  const row = db.prepare(
    "SELECT time_updated FROM session WHERE id = ?"
  ).all(entry.key.canonicalNativeId)[0] as Row | undefined;
  if (
    !row ||
    digest(`${entry.key.canonicalNativeId}:${String(row.time_updated)}`) !==
      entry.historyRevision
  ) {
    throw Object.assign(new Error("历史会话已变化"), {
      code: "HISTORY_REVISION_CHANGED",
    });
  }
}

/* tool part 形态按上游源码约定 fail-soft 提取（本机零真样，见 L3 账本）：
 * {type:"tool", callID?, tool:<name>, state:{input,output,...}}——字段缺失
 * 只降级为空，不炸整行。 */
function toolEvents(parts: Json[]): ForeignToolEvent[] {
  return parts
    .filter((part) => part.type === "tool")
    .map((part, index) => {
      const state = object(part.state);
      const id = asString(part.callID) ?? asString(part.id) ?? `tool-${index + 1}`;
      return {
        id,
        name: asString(part.tool) ?? "tool",
        ...(state?.input !== undefined ? { input: safeJson(state.input) } : {}),
        ...(asString(state?.output) ? { output: asString(state?.output)! } : {}),
      };
    });
}

function durationOf(time: Json | null): number | undefined {
  const created = typeof time?.created === "number" ? time.created : null;
  const completed = typeof time?.completed === "number" ? time.completed : null;
  if (created === null || completed === null || completed < created) return undefined;
  return Math.round(completed - created);
}

/** 未命名会话（"New session - <ISO>"）退首条 user text part；一条 join 拿全库首条。 */
function unnamedFallbackTitles(db: Database, rows: Row[]) {
  const titles = new Map<string, string>();
  if (!rows.some((row) => UNNAMED_TITLE.test(asString(row.title) ?? ""))) return titles;
  try {
    const candidates = db.prepare(
      "SELECT m.session_id AS sid, p.data AS data FROM part p JOIN message m ON p.message_id = m.id " +
      "WHERE json_extract(m.data, '$.role') = 'user' AND json_extract(p.data, '$.type') = 'text' " +
      "ORDER BY m.time_created, p.id"
    ).all() as Row[];
    for (const row of candidates) {
      const sid = asString(row.sid);
      if (!sid || titles.has(sid)) continue;
      const text = asString(parseJson(asString(row.data))?.text);
      if (text) titles.set(sid, text);
    }
  } catch { /* JSON1 缺席等一律放弃 fallback，保留存量标题 */ }
  return titles;
}

type Database = {
  prepare(sql: string): { all(...args: unknown[]): unknown[] };
  exec(sql: string): void;
  close(): void;
};
const requireSqlite = () => createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new(path: string, options: { readOnly: boolean }) => Database };

function withDatabase<T>(path: string, body: (db: Database) => T): T {
  const db = new (requireSqlite().DatabaseSync)(path, { readOnly: true });
  try { return body(db); } finally { db.close(); }
}

const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const asString = (value: unknown) => typeof value === "string" && value ? value : null;
const parseJson = (value: string | null): Json | null => { if (!value) return null; try { return object(JSON.parse(value)); } catch { return null; } };
const safeJson = (value: unknown) => { try { return JSON.stringify(value); } catch { return "[unserializable]"; } };
const emptyScan = (): AdapterScan => ({ sourceKind: "opencode", installed: false, entries: [], sourceRevision: "missing" });
