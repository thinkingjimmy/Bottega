/**
 * [INPUT]: Depends on Node fs/path, Zod schemas, and SerialQueue
 * [OUTPUT]: Parent-synced atomic publication, durable and cheap directory guards, optional final byte-publication guards and strict ledger loading; unsupported canonical bytes are preserved without empty replacement.
 * [POS]: The persistence I/O boundary; DurableJson owns the recovery decision for unreadable content so no ledger can turn a schema drift into a fatal startup
 */

import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { z } from "zod";
import { SerialQueue } from "./serial-queue";
import { recoverDurableCorruption, DurableRecoveryHeldError } from "./recovery-policy";

export const isErrnoCode = (cause: unknown, code: string) =>
  cause instanceof Error && (cause as NodeJS.ErrnoException).code === code;
export type DurableReplaceFileFaults = Readonly<{
  /** Test-only crash boundary: directory entry exists but its parent is not synced. */
  afterDirectoryCreated?: (input: {
    directory: string;
    parent: string;
  }) => void | Promise<void>;
  /** Test-only ordering witness for a published directory entry. */
  afterDirectoryParentSynced?: (input: {
    directory: string;
    parent: string;
    created: boolean;
  }) => void | Promise<void>;
  /** Test-only crash boundary: target rename succeeded, parent fsync has not. */
  afterRename?: (input: { filePath: string; content: string }) => void | Promise<void>;
}>;

/** 只表示“磁盘字节已读到，但无法信任其内容”；IO 与运行期写坏不属于此类。 */
export class DurableFileCorruptionError extends Error {
  constructor(readonly filePath: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Durable file is corrupted: ${filePath}: ${detail}`, { cause });
    this.name = "DurableFileCorruptionError";
  }
}

/**
 * WAL、checkpoint 与普通 JSON 状态共用同一个落盘原语。rename 只保证名字切换
 * 原子；临时文件与父目录都 sync 后，才保证掉电恢复时提交顺序仍成立。
 */
export async function durableReplaceFile(
  filePath: string,
  content: string,
  mode = 0o600,
  faults: DurableReplaceFileFaults = {}
) {
  return durableReplace(filePath, content, mode, faults);
}

/** Raw evidence must never pass through UTF-8 decoding before publication. */
export async function durableReplaceBytes(
  filePath: string,
  content: Uint8Array,
  mode = 0o600,
  guard?: () => void
) {
  return durableReplace(filePath, content, mode, {}, guard);
}

async function durableReplace(
  filePath: string,
  content: string | Uint8Array,
  mode: number,
  faults: DurableReplaceFileFaults = {},
  guard?: () => void
) {
  guard?.();
  const directory = dirname(filePath);
  await ensureDurableDirectory(directory, 0o700, faults);
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", mode);
  try {
    try {
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw cause;
  }
  try {
    guard?.();
    await rename(temporary, filePath);
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw cause;
  }
  if (typeof content === "string") {
    await faults.afterRename?.({ filePath, content });
  }
  await syncDirectory(directory);
  guard?.();
}

/**
 * Publish a directory from the nearest existing ancestor down. Every new child
 * is created only after its parent entry is durable, then its own parent is
 * synced before a later ledger may reference the child. An existing leaf also
 * gets the parent barrier, which heals an interrupted create on replay.
 */
export async function ensureDurableDirectory(
  directory: string,
  mode = 0o700,
  faults: DurableReplaceFileFaults = {}
): Promise<void> {
  const parent = dirname(directory);
  if (parent === directory) return;
  let created = false;
  try {
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`Durable directory 边界不是真实目录：${directory}`);
    }
  } catch (cause) {
    if (!isErrnoCode(cause, "ENOENT")) throw cause;
    await ensureDurableDirectory(parent, mode, faults);
    try {
      await mkdir(directory, { mode });
      created = true;
    } catch (mkdirCause) {
      if (!isErrnoCode(mkdirCause, "EEXIST")) {
        throw mkdirCause;
      }
      const metadata = await lstat(directory);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error(`Durable directory 边界不是真实目录：${directory}`);
      }
    }
  }
  if (created) await faults.afterDirectoryCreated?.({ directory, parent });
  await syncDirectory(parent);
  await faults.afterDirectoryParentSynced?.({ directory, parent, created });
}

/**
 * Cheap sibling of ensureDurableDirectory for rebuildable caches: the same 0o700
 * creation and symlink guard without the ancestor barrier, so a per-file
 * re-validation in a hot loop does not pay a directory fsync every time.
 */
export async function ensureGuardedDirectory(directory: string, failure: string, mode = 0o700) {
  await mkdir(directory, { mode }).catch(cause => { if (!isErrnoCode(cause, "EEXIST")) throw cause; });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(failure);
}

/** Filesystems that cannot fsync a directory handle (EINVAL/ENOTSUP) have nothing further to flush. */
export async function syncDirectory(directory: string) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } catch (cause) {
    if (!isErrnoCode(cause, "EINVAL") && !isErrnoCode(cause, "ENOTSUP")) throw cause;
  } finally {
    await handle.close();
  }
}

/* ============================================================
 * 损坏隔离：改名留证而非删除，最多保留最近三份避免无限累积。
 * initialize 读到无法信任的内容时自动走这里；owner 只在自己的领域不变量
 * 失败时才需要手动调用它。
 * ============================================================ */
export async function quarantineDurableFile(filePath: string, createId: () => string = randomUUID) {
  const directory = dirname(filePath);
  await ensureDurableDirectory(directory);
  try {
    await rename(filePath, `${filePath}.quarantine-${Date.now()}-${createId()}`);
  } catch (cause) {
    if (!isErrnoCode(cause, "ENOENT")) throw cause;
  }
  await syncDirectory(directory);
  const prefix = `${filePath.slice(directory.length + 1)}.quarantine-`;
  const entries = (await readdir(directory).catch(() => []))
    .filter((entry) => entry.startsWith(prefix))
    .sort()
    .reverse();
  await Promise.all(
    entries.slice(3).map((entry) =>
      rm(join(directory, entry), { force: true }).catch(() => undefined)
    )
  );
}

export class DurableJson<T> {
  private state: T;
  private ready = false;
  private poisoned = false;
  private held = false;
  private readonly queue = new SerialQueue();

  constructor(
    readonly filePath: string,
    private readonly schema: z.ZodType<T>,
    empty: () => T,
    private readonly faults: DurableReplaceFileFaults = {}
  ) {
    this.state = empty();
  }

  // Unsupported or corrupt persisted authority never becomes a writable empty ledger.
  async initialize() {
    if (this.poisoned) {
      throw new Error(`Durable authority 已 poisoned，必须新建实例重开：${this.filePath}`);
    }
    return this.queue.enqueue(async (): Promise<{ quarantined: boolean }> => {
      const content = await this.readExisting();
      if (content === null) {
        if (await this.recover(content)) return { quarantined: true };
        await this.persistOrPoison(this.state);
        this.ready = true;
        return { quarantined: false };
      }
      const loaded = this.decode(content);
      if (loaded.ok) {
        this.state = loaded.state;
        this.ready = true;
        return { quarantined: false };
      }
      if (await this.recover(content)) return { quarantined: true };
      this.poisoned = true;
      throw loaded.error;
    });
  }

  private async recover(content: string | null) {
    const recovery = await recoverDurableCorruption(this.filePath, content);
    if (!recovery) return false;
    this.held = recovery.held;
    if (this.held) recovery.released(() => this.queue.enqueue(async () => {
      await this.persistOrPoison(this.state); this.held = false; this.ready = true;
    }));
    else await this.persistOrPoison(this.state);
    this.ready = true;
    return true;
  }

  private decode(
    content: string
  ): { ok: true; state: T } | { ok: false; error: DurableFileCorruptionError } {
    let raw: unknown;
    try {
      raw = JSON.parse(content) as unknown;
    } catch (cause) {
      return { ok: false, error: new DurableFileCorruptionError(this.filePath, cause) };
    }
    const current = this.schema.safeParse(raw);
    return current.success
      ? { ok: true, state: current.data }
      : { ok: false, error: new DurableFileCorruptionError(this.filePath, current.error) };
  }

  snapshot() {
    this.assertReady();
    return structuredClone(this.state);
  }

  mutate<R>(operation: (state: T) => R | Promise<R>) {
    return this.queue.enqueue(async () => {
      this.assertReady();
      if (this.held) throw new DurableRecoveryHeldError();
      const previous = structuredClone(this.state);
      try {
        const result = await operation(this.state);
        this.state = this.schema.parse(this.state);
        await this.persistOrPoison(this.state);
        return structuredClone(result);
      } catch (cause) {
        if (!this.poisoned) this.state = previous;
        throw cause;
      }
    });
  }

  async closeAndFlush() {
    this.queue.close();
    await this.queue.flush();
  }

  private async readExisting() {
    try {
      return await readFile(this.filePath, "utf8");
    } catch (cause) {
      if (isErrnoCode(cause, "ENOENT")) return null;
      throw cause;
    }
  }

  /* receipt 是跨 owner 的提交证明：file fsync + atomic rename + 目录 fsync
     缺一不可，否则掉电后 checkpoint 可能引用一条从未落盘的 receipt。
     tmp 名唯一（O_EXCL），崩溃残留不会被下一次写复用。 */
  private async persist(state: T) {
    await durableReplaceFile(
      this.filePath,
      `${JSON.stringify(state, null, 2)}\n`,
      0o600,
      this.faults
    );
  }

  private async persistOrPoison(state: T) {
    try {
      await this.persist(state);
    } catch (cause) {
      this.ready = false;
      this.poisoned = true;
      throw cause;
    }
  }

  private assertReady() {
    if (!this.ready || this.poisoned) {
      throw new Error(`Durable authority 未 ready 或已 poisoned：${this.filePath}`);
    }
  }
}
