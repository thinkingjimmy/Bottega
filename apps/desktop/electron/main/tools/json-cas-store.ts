/**
 * [INPUT]: Depends on Node fs, persistence/durable-json durableReplaceFile, and a per-store validated state schema, and statusError from main/errors
 * [OUTPUT]: Provides JsonCasStore (serialized mutation lane, main→backup→empty recovery, backup-then-main commit, change watchers, backup rewrite), storeError, serialize, and byteLength
 * [POS]: Shared persistence skeleton for the manual MCP secret ledger and the Project Tool Policy store; domain validation, projections, and CAS rules stay in each store
 */

import { chmod, readFile } from "node:fs/promises";
import { statusError } from "../errors";
import { durableReplaceFile } from "../persistence/durable-json";

export type JsonCasStoreDependencies = Readonly<{
  readText?: (path: string) => Promise<string>;
  atomicWrite?: (path: string, content: string) => Promise<void>;
}>;

export type JsonCasStoreOptions<TState> = Readonly<{
  filePath: string;
  label: string;
  maxFileBytes: number;
  empty: () => TState;
  validate: (raw: unknown) => TState;
  dependencies?: JsonCasStoreDependencies;
}>;

export abstract class JsonCasStore<TState, TEvent> {
  readonly filePath: string;
  readonly backupPath: string;
  protected state: TState;
  private previousValidated: TState | undefined;
  private queue: Promise<void> = Promise.resolve();
  private readonly watchers = new Set<(event: TEvent) => void>();
  private readonly readText: (path: string) => Promise<string>;
  private readonly writeText: (path: string, content: string) => Promise<void>;

  constructor(private readonly options: JsonCasStoreOptions<TState>) {
    this.filePath = options.filePath;
    this.backupPath = `${options.filePath}.bak`;
    this.state = options.empty();
    this.readText =
      options.dependencies?.readText ?? ((path) => readFile(path, "utf8"));
    this.writeText =
      options.dependencies?.atomicWrite ??
      ((path, content) => durableReplaceFile(path, content));
  }

  onChanged(listener: (event: TEvent) => void) {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  async closeAndFlush() {
    await this.queue;
  }

  protected mutate<T>(operation: () => Promise<T>) {
    const result = this.queue.then(operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  /** main → backup → empty; anything but a missing pair is a corruption fence, never a silent rebuild. */
  protected async recover() {
    try {
      this.accept(await this.readValidated(this.filePath));
    } catch (mainCause) {
      const mainMissing = isMissing(mainCause);
      try {
        const backup = await this.readValidated(this.backupPath);
        await this.writeText(this.filePath, serialize(backup));
        this.accept(backup);
      } catch (backupCause) {
        if (!mainMissing || !isMissing(backupCause)) {
          throw storeError("store-corrupt", `${this.options.label} 主档与备份均无法读取`);
        }
        const initial = this.options.empty();
        await this.writeText(this.filePath, serialize(initial));
        this.accept(initial);
      }
    }
    await chmod(this.filePath, 0o600);
  }

  /** The previous validated state moves to backup before the new state replaces main. */
  protected async commitState(next: TState, events: readonly TEvent[]) {
    if (this.previousValidated) {
      await this.writeText(this.backupPath, serialize(this.previousValidated));
    }
    await this.writeText(this.filePath, serialize(next));
    this.accept(next);
    for (const event of events) for (const watcher of this.watchers) watcher(event);
  }

  /* Owner cleanup must scrub both generations. Rewriting backup last, even when
     active had nothing to remove, keeps a failed rewrite retryable on the next call. */
  protected rewriteBackup() {
    return this.writeText(this.backupPath, serialize(this.state));
  }

  private async readValidated(path: string) {
    const raw = await this.readText(path);
    if (byteLength(raw) > this.options.maxFileBytes) {
      throw new Error(`${this.options.label} 超过总字节预算`);
    }
    return this.options.validate(JSON.parse(raw));
  }

  private accept(state: TState) {
    this.state = state;
    this.previousValidated = structuredClone(state);
  }
}

export const byteLength = (value: string) => Buffer.byteLength(value, "utf8");

export function serialize(state: unknown) {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export function storeError(code: string, message: string) {
  return statusError(409, message, { code });
}

const isMissing = (cause: unknown) =>
  (cause as NodeJS.ErrnoException).code === "ENOENT";
