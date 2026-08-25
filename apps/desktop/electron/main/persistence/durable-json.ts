/**
 * [INPUT]: Depends on Node fs/path, zod and SerialQueue
 * [OUTPUT]: Provides durableReplaceFile, quarantineDurableFile with DurableJson, performs 0600 + file fsync + atomic rename + directory fsync, durable replace, strict parse, single-step upgrades, sequential mutate and roll back memory failure
 * [POS]: The first is the persistence durable ledger IODurableJson itself decides whether to isolate the damage from the fail-closed and openly call the store layer to quarantine the DurableFile
 */

import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { z } from "zod";
import { SerialQueue } from "./serial-queue";

export type DurableJsonUpgrade<T> = (raw: unknown) => T | undefined;

/**
 * WAL、checkpoint 与普通 JSON 状态共用同一个落盘原语。rename 只保证名字切换
 * 原子；临时文件与父目录都 sync 后，才保证掉电恢复时提交顺序仍成立。
 */
export async function durableReplaceFile(
  filePath: string,
  content: string,
  mode = 0o600
) {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
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
  const parent = await open(directory, "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

/* ============================================================
 * 损坏隔离：改名留证而非删除，最多保留最近三份避免无限累积。
 * 隔离本身不是恢复——隔离后是 fail-closed 还是空态重建，由调用方决定。
 * ============================================================ */
export async function quarantineDurableFile(filePath: string) {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await rename(filePath, `${filePath}.quarantine-${Date.now()}`).catch(
    () => undefined
  );
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
  private readonly queue = new SerialQueue();

  constructor(
    readonly filePath: string,
    private readonly schema: z.ZodType<T>,
    empty: () => T
  ) {
    this.state = empty();
  }

  async initialize(upgrade?: DurableJsonUpgrade<T>) {
    await this.queue.enqueue(async () => {
      const content = await this.readExisting();
      if (content === null) {
        await this.persist(this.state);
        return;
      }
      const raw = JSON.parse(content) as unknown;
      const current = this.schema.safeParse(raw);
      if (current.success) {
        this.state = current.data;
        return;
      }
      const migrated = upgrade?.(raw);
      if (migrated === undefined) throw current.error;
      const next = this.schema.parse(migrated);
      await this.persist(next);
      this.state = next;
    });
  }

  snapshot() {
    return structuredClone(this.state);
  }

  mutate<R>(operation: (state: T) => R | Promise<R>) {
    return this.queue.enqueue(async () => {
      const previous = structuredClone(this.state);
      try {
        const result = await operation(this.state);
        this.state = this.schema.parse(this.state);
        await this.persist(this.state);
        return structuredClone(result);
      } catch (cause) {
        this.state = previous;
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
      `${JSON.stringify(state, null, 2)}\n`
    );
  }
}
