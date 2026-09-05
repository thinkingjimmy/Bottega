/**
 * [INPUT]: Depends on node:sqlite from the active runtime plus fs/path for private database files
 * [OUTPUT]: Provides the single SQLite connection owner, WAL runtime safety gate, verified production pragmas, transaction helper, throttled high-water checkpoints, integrity/foreign-key/revision-convergence gates, and metrics
 * [POS]: Lowest Chat SQLite runtime layer; only the dedicated database worker may construct a production connection
 */

import { createRequire } from "node:module";
import { chmod, lstat, mkdir, open, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { runMigrations } from "./migrations";

export type SqliteValue = null | number | bigint | string | Uint8Array;

export type SqliteStatement = {
  all(...values: SqliteValue[]): unknown[];
  get(...values: SqliteValue[]): unknown;
  iterate(...values: SqliteValue[]): IterableIterator<unknown>;
  run(...values: SqliteValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
};

export type SqliteDatabase = {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
};

type NodeSqlite = {
  DatabaseSync: new (
    path: string,
    options?: { readOnly?: boolean; timeout?: number }
  ) => SqliteDatabase;
};

export type ConnectionMode = "canonical" | "verification";

export type CheckpointMetrics = Readonly<{
  mode: "PASSIVE" | "TRUNCATE";
  busy: number;
  logFrames: number;
  checkpointedFrames: number;
  durationMs: number;
  walBytes: number;
}>;

export type ConnectionMetrics = Readonly<{
  databaseBytes: number;
  walBytes: number;
  pageBytes: number;
  pageCount: number;
  freePages: number;
  journalMode: string;
  synchronous: number;
  walAutocheckpointPages: number;
}>;

export const DEFAULT_WAL_HIGH_WATER_BYTES = 64 * 1024 * 1024;
const HIGH_WATER_CHECKPOINT_COOLDOWN_MS = 1_000;

const versionParts = (value: string) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) throw new Error(`SQLite runtime version is invalid: ${value}`);
  return match.slice(1).map(Number) as [number, number, number];
};

const atLeast = (
  actual: readonly number[],
  expected: readonly number[]
) => {
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) return actual[index]! > expected[index]!;
  }
  return true;
};

/** SQLite's 2026 WAL-reset advisory names these fixed release lines. */
export function assertWalRuntimeSafe(version: string) {
  const actual = versionParts(version);
  const fixed = atLeast(actual, [3, 51, 3]) ||
    (actual[0] === 3 && actual[1] === 50 && actual[2] >= 7) ||
    (actual[0] === 3 && actual[1] === 44 && actual[2] >= 6);
  if (!fixed) {
    throw new Error(
      `SQLite ${version} is blocked for production WAL: the WAL-reset fix is required`
    );
  }
}

const requireSqlite = () =>
  createRequire(import.meta.url)("node:sqlite") as NodeSqlite;

const pragmaValue = (database: SqliteDatabase, name: string) => {
  const row = database.prepare(`PRAGMA ${name}`).get() as
    | Record<string, unknown>
    | undefined;
  return row ? Object.values(row)[0] : undefined;
};

const assertPragma = (
  database: SqliteDatabase,
  name: string,
  expected: string | number
) => {
  const actual = pragmaValue(database, name);
  if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error(`SQLite ${name}=${String(actual)}; expected ${expected}`);
  }
};

export function transaction<T>(database: SqliteDatabase, run: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    database.exec("COMMIT");
    return result;
  } catch (cause) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // The original failure is authoritative; rollback may report no active transaction.
    }
    throw cause;
  }
}

async function assertPrivateDatabase(path: string) {
  const value = await lstat(path);
  if (!value.isFile() || value.isSymbolicLink()) {
    throw new Error("Chat database must be a regular file");
  }
  if (process.platform !== "win32" && (value.mode & 0o077) !== 0) {
    await chmod(path, 0o600);
  }
}

async function captureSafeExistingPath(path: string) {
  try {
    const value = await lstat(path);
    if (!value.isFile() || value.isSymbolicLink()) {
      throw new Error("Chat database must be a regular file");
    }
    return value;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    return null;
  }
}

async function assertSameDatabaseFile(path: string, expected: Awaited<ReturnType<typeof lstat>>) {
  const actual = await lstat(path);
  if (
    !actual.isFile() ||
    actual.isSymbolicLink() ||
    actual.dev !== expected.dev ||
    actual.ino !== expected.ino
  ) {
    throw new Error("Chat database file identity changed while opening");
  }
}

export class ChatSqliteConnection {
  readonly database: SqliteDatabase;
  private closed = false;
  private checkpointInFlight: Promise<CheckpointMetrics | null> | null = null;
  private lastHighWaterCheckpointAt = Number.NEGATIVE_INFINITY;

  private constructor(
    readonly path: string,
    readonly mode: ConnectionMode,
    database: SqliteDatabase
  ) {
    this.database = database;
  }

  static async open(path: string, mode: ConnectionMode) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // DatabaseSync follows symlinks and creates missing files. Resolve the file
    // identity before either behavior can mutate an attacker-controlled target.
    let existing = await captureSafeExistingPath(path);
    if (!existing) {
      const placeholder = await open(path, "wx", 0o600);
      await placeholder.close();
      existing = await captureSafeExistingPath(path);
      if (!existing) throw new Error("Chat database placeholder disappeared");
    }
    const { DatabaseSync } = requireSqlite();
    const database = new DatabaseSync(path, { timeout: 5_000 });
    const connection = new ChatSqliteConnection(path, mode, database);
    try {
      await assertSameDatabaseFile(path, existing);
      if (mode === "canonical" && process.versions.electron) {
        const row = database.prepare("SELECT sqlite_version() version").get() as {
          version?: unknown;
        };
        assertWalRuntimeSafe(String(row.version ?? ""));
      }
      connection.configure();
      runMigrations(database);
      await assertPrivateDatabase(path);
      return connection;
    } catch (cause) {
      database.close();
      throw cause;
    }
  }

  private configure() {
    const journal = this.mode === "canonical" ? "WAL" : "DELETE";
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec(`PRAGMA journal_mode = ${journal}`);
    this.database.exec("PRAGMA synchronous = FULL");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.database.exec("PRAGMA wal_autocheckpoint = 0");
    this.database.exec("PRAGMA cache_size = -32768");
    this.database.exec("PRAGMA cache_spill = OFF");
    assertPragma(this.database, "foreign_keys", 1);
    assertPragma(this.database, "journal_mode", journal.toLowerCase());
    assertPragma(this.database, "synchronous", 2);
    assertPragma(this.database, "busy_timeout", 5_000);
    assertPragma(this.database, "wal_autocheckpoint", 0);
    assertPragma(this.database, "cache_size", -32_768);
    assertPragma(this.database, "cache_spill", 0);
  }

  startupGate() {
    const startedAt = performance.now();
    const migration = this.database
      .prepare(
        "SELECT version, name, checksum FROM schema_migrations ORDER BY version DESC LIMIT 1"
      )
      .get();
    const activeGeneration = this.database
      .prepare(
        `SELECT a.chat_id, a.generation_id
           FROM chat_active_import_generations a
           JOIN chat_import_generations g
             ON g.chat_id = a.chat_id AND g.generation_id = a.generation_id
          WHERE g.state <> 'ready' LIMIT 1`
      )
      .get();
    if (activeGeneration) {
      throw new Error("Startup gate found a non-ready active import generation");
    }
    return {
      durationMs: performance.now() - startedAt,
      migration,
    };
  }

  maintenanceGate() {
    const integrity = this.database.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>;
    if (integrity.length !== 1 || Object.values(integrity[0] ?? {})[0] !== "ok") {
      throw new Error("SQLite integrity_check failed");
    }
    const foreignKeys = this.database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeys.length) throw new Error("SQLite foreign_key_check failed");
    this.database.exec(
      "INSERT INTO chat_search_fts(chat_search_fts, rank) VALUES('integrity-check', 1)"
    );
    const invalidSequence = this.database
      .prepare(
        `SELECT c.id
           FROM chats c
           LEFT JOIN (SELECT chat_id, MAX(seq) max_seq FROM chat_messages GROUP BY chat_id) m
             ON m.chat_id = c.id
          WHERE c.lifecycle_kind <> 'external-readonly'
            AND c.next_seq <= COALESCE(m.max_seq, 0)
          LIMIT 1`
      )
      .get();
    if (invalidSequence) throw new Error("Chat next_seq invariant failed");
    /* 两个版本号必须一致：原生 append 的 CAS 同时比对 chats 的
       native_message_revision 与本机 timeline_revision，错开一格就是
       「这条会话再也写不进下一条消息」。只读段没有原生尾巴，不受此约。 */
    const divergedRevision = this.database
      .prepare(
        `SELECT c.id FROM chats c
           JOIN chat_local_aggregate_state a ON a.chat_id = c.id
          WHERE c.lifecycle_kind <> 'external-readonly'
            AND c.native_message_revision <> a.timeline_revision
          LIMIT 1`
      )
      .get();
    if (divergedRevision) throw new Error("Chat message revision invariant failed");
    const readonlyBinding = this.database
      .prepare(
        `SELECT c.id FROM chats c
          JOIN chat_device_bindings b ON b.chat_id = c.id AND b.state = 'ready'
         WHERE c.lifecycle_kind = 'external-readonly' LIMIT 1`
      )
      .get();
    if (readonlyBinding) throw new Error("Readonly Chat has an executable binding");
    const crossChatGeneration = this.database
      .prepare(
        `SELECT e.chat_id, e.generation_id, e.entry_version_id
           FROM chat_import_generation_entries e
           JOIN chat_import_entry_versions v ON v.entry_version_id = e.entry_version_id
          WHERE v.chat_id <> e.chat_id LIMIT 1`
      )
      .get();
    if (crossChatGeneration) throw new Error("Import generation crosses Chat ownership");
    const danglingSearch = this.database
      .prepare(
        `SELECT d.row_id FROM chat_search_documents d
          LEFT JOIN chats c ON c.id = d.chat_id
         WHERE c.id IS NULL LIMIT 1`
      )
      .get();
    if (danglingSearch) throw new Error("Search projection references a missing Chat");
    return {
      integrity: "ok",
      foreignKeys: 0,
      domainInvariants: "ok",
      ftsRank: 1,
    } as const;
  }

  async metrics(): Promise<ConnectionMetrics> {
    const [database, wal] = await Promise.all([
      stat(this.path).catch(() => null),
      stat(`${this.path}-wal`).catch(() => null),
    ]);
    return {
      databaseBytes: database?.size ?? 0,
      walBytes: wal?.size ?? 0,
      pageBytes: Number(pragmaValue(this.database, "page_size") ?? 0),
      pageCount: Number(pragmaValue(this.database, "page_count") ?? 0),
      freePages: Number(pragmaValue(this.database, "freelist_count") ?? 0),
      journalMode: String(pragmaValue(this.database, "journal_mode") ?? ""),
      synchronous: Number(pragmaValue(this.database, "synchronous") ?? -1),
      walAutocheckpointPages: Number(pragmaValue(this.database, "wal_autocheckpoint") ?? 0),
    };
  }

  maybeCheckpoint(highWaterBytes = DEFAULT_WAL_HIGH_WATER_BYTES) {
    if (this.mode !== "canonical" || this.closed) return Promise.resolve(null);
    if (this.checkpointInFlight) return this.checkpointInFlight;
    const now = Date.now();
    if (now - this.lastHighWaterCheckpointAt < HIGH_WATER_CHECKPOINT_COOLDOWN_MS) {
      return Promise.resolve(null);
    }
    this.checkpointInFlight = this.metrics()
      .then((metrics) => {
        if (metrics.walBytes < highWaterBytes) return null;
        this.lastHighWaterCheckpointAt = Date.now();
        return this.checkpoint("TRUNCATE");
      })
      .finally(() => {
        this.checkpointInFlight = null;
      });
    return this.checkpointInFlight;
  }

  async checkpoint(mode: "PASSIVE" | "TRUNCATE"): Promise<CheckpointMetrics> {
    const startedAt = performance.now();
    const row = this.database.prepare(`PRAGMA wal_checkpoint(${mode})`).get() as
      | Record<string, unknown>
      | undefined;
    const values = Object.values(row ?? {});
    const wal = await stat(`${this.path}-wal`).catch(() => null);
    return {
      mode,
      busy: Number(values[0] ?? 0),
      logFrames: Number(values[1] ?? 0),
      checkpointedFrames: Number(values[2] ?? 0),
      durationMs: performance.now() - startedAt,
      walBytes: wal?.size ?? 0,
    };
  }

  async closeAndFlush() {
    if (this.closed) return;
    if (this.checkpointInFlight) await this.checkpointInFlight;
    if (this.mode === "canonical") await this.checkpoint("TRUNCATE");
    this.closed = true;
    this.database.close();
  }
}
