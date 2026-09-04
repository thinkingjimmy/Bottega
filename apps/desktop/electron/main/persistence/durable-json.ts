/**
 * [INPUT]: Depends on Node fs/path, Zod schemas, and SerialQueue
 * [OUTPUT]: Provides durable directory publication, atomic text/byte replacement, explicit corruption errors with retained diagnostics, quarantine, strict single-step upgrades, initialization that quarantines untrusted content and rebuilds empty by default (reporting `quarantined`), and serialized rollback-safe mutation
 * [POS]: The persistence I/O boundary; DurableJson owns the recovery decision for unreadable content so no ledger can turn a schema drift into a fatal startup
 */

import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { z } from "zod";
import { SerialQueue } from "./serial-queue";

export type DurableJsonUpgrade<T> = (raw: unknown) => T | undefined;
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
  mode = 0o600
) {
  return durableReplace(filePath, content, mode);
}

async function durableReplace(
  filePath: string,
  content: string | Uint8Array,
  mode: number,
  faults: DurableReplaceFileFaults = {}
) {
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
    await rename(temporary, filePath);
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw cause;
  }
  if (typeof content === "string") {
    await faults.afterRename?.({ filePath, content });
  }
  const parent = await open(directory, "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
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
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    await ensureDurableDirectory(parent, mode, faults);
    try {
      await mkdir(directory, { mode });
      created = true;
    } catch (mkdirCause) {
      if ((mkdirCause as NodeJS.ErrnoException).code !== "EEXIST") {
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

async function syncDirectory(directory: string) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/* ============================================================
 * 损坏隔离：改名留证而非删除，最多保留最近三份避免无限累积。
 * initialize 读到无法信任的内容时自动走这里；owner 只在自己的领域不变量
 * 失败时才需要手动调用它。
 * ============================================================ */
export async function quarantineDurableFile(filePath: string) {
  const directory = dirname(filePath);
  await ensureDurableDirectory(directory);
  try {
    await rename(filePath, `${filePath}.quarantine-${Date.now()}`);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
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
  private readonly queue = new SerialQueue();

  constructor(
    readonly filePath: string,
    private readonly schema: z.ZodType<T>,
    empty: () => T,
    private readonly faults: DurableReplaceFileFaults = {}
  ) {
    this.state = empty();
  }

  /* ── 读不出即隔离重建：这是 initialize 的默认语义，不是 owner 的选项 ──
     磁盘上的字节读到了却无法信任（JSON 坏了、schema 对不上、升级函数也
     不认）：改名留证、空态重建、照常 ready，并把 quarantined 告诉调用方。
     此前这层保护是一个可选的外层函数，二十多个账本从未调用它——任何一次
     「形状变了、号没升」都会让主进程起不来（09-04 的 process-custody 就是）。
     两类错误照常上抛：IO 错误（磁盘不动时空态同样写不进去，谎报 ready 只是
     把故障推迟到下一笔）与升级函数交出的非法状态（那是代码错误，隔离只会
     把它藏起来）。 */
  async initialize(upgrade?: DurableJsonUpgrade<T>) {
    if (this.poisoned) {
      throw new Error(`Durable authority 已 poisoned，必须新建实例重开：${this.filePath}`);
    }
    return this.queue.enqueue(async (): Promise<{ quarantined: boolean }> => {
      const content = await this.readExisting();
      if (content === null) {
        await this.persistOrPoison(this.state);
        this.ready = true;
        return { quarantined: false };
      }
      const loaded = this.decode(content, upgrade);
      if (loaded.ok) {
        if (loaded.persist) await this.persistOrPoison(loaded.state);
        this.state = loaded.state;
        this.ready = true;
        return { quarantined: false };
      }
      console.warn(
        `[durable-json] 账本无法读取，已隔离原件后空态重建（备份至 ${this.filePath}.quarantine-*）`,
        loaded.error
      );
      await quarantineDurableFile(this.filePath);
      await this.persistOrPoison(this.state);
      this.ready = true;
      return { quarantined: true };
    });
  }

  private decode(
    content: string,
    upgrade?: DurableJsonUpgrade<T>
  ): { ok: true; state: T; persist: boolean } | { ok: false; error: DurableFileCorruptionError } {
    let raw: unknown;
    try {
      raw = JSON.parse(content) as unknown;
    } catch (cause) {
      return { ok: false, error: new DurableFileCorruptionError(this.filePath, cause) };
    }
    const current = this.schema.safeParse(raw);
    if (current.success) return { ok: true, state: current.data, persist: false };
    const migrated = upgrade?.(raw);
    if (migrated === undefined) {
      return { ok: false, error: new DurableFileCorruptionError(this.filePath, current.error) };
    }
    return { ok: true, state: this.schema.parse(migrated), persist: true };
  }

  snapshot() {
    this.assertReady();
    return structuredClone(this.state);
  }

  mutate<R>(operation: (state: T) => R | Promise<R>) {
    return this.queue.enqueue(async () => {
      this.assertReady();
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
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
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
