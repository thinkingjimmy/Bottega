/**
 * [INPUT]: Depends on Node Atomic files IO, ledger-values Purge schema and persistence/serial-queue
 * [OUTPUT]: Provides upsert/patch, immutable, deleting mode, preview-bound Home, deleting permissions, active Project, querying, damaged isolation and terminal compression
 * [POS]: The purge leaves lock the chat-home; No execution of files or side effects across stores
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SerialQueue } from "../persistence/serial-queue";
import {
  emptyPurgeJournal,
  purgeIntentSchema,
  purgeJournalSchema,
  type PurgeIntent,
  type PurgeJournalState,
} from "./ledger-values";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export class PurgeJournal {
  readonly filePath: string;
  private readonly queue = new SerialQueue();
  private state = emptyPurgeJournal();
  private warning = "";

  constructor(
    userData: string,
    private readonly now: () => number = Date.now
  ) {
    this.filePath = join(userData, "chat-purge-journal.json");
  }

  async initialize() {
    await this.queue.enqueue(async () => {
      try {
        this.state = purgeJournalSchema.parse(
          JSON.parse(await readFile(this.filePath, "utf8"))
        );
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
          this.state = emptyPurgeJournal();
        } else {
          const isolated = this.filePath.replace(
            /\.json$/,
            `.corrupt-${this.now()}.json`
          );
          await rename(this.filePath, isolated);
          this.state = emptyPurgeJournal();
          this.warning = `Purge journal 损坏，已隔离到 ${isolated}。`;
        }
      }
      this.compact();
      await this.persist(this.state);
    });
    return this.warning;
  }

  listActive() {
    return Object.values(this.state.intents)
      .filter((intent) => !["completed"].includes(intent.phase))
      .map((value) => structuredClone(value));
  }

  hasActiveProject(projectId: string) {
    return this.listActive().some(
      (intent) =>
        intent.targets.some(
          (target) => target.kind === "project" && target.id === projectId
        )
    );
  }

  put(intent: PurgeIntent) {
    return this.queue.enqueue(async () => {
      const parsed = purgeIntentSchema.parse(intent);
      const current = this.state.intents[parsed.intentId];
      if (current) return structuredClone(current);
      const next = structuredClone(this.state);
      next.intents[parsed.intentId] = parsed;
      await this.commit(next);
      return structuredClone(parsed);
    });
  }

  patch(intentId: string, patch: Partial<PurgeIntent>) {
    return this.queue.enqueue(async () => {
      const current = this.state.intents[intentId];
      if (!current) throw new Error("PurgeIntent 不存在");
      if (patch.deletionMode && patch.deletionMode !== current.deletionMode) {
        throw new Error("PurgeIntent 删除模式不可变");
      }
      const intent = purgeIntentSchema.parse({ ...current, ...patch });
      const next = structuredClone(this.state);
      next.intents[intentId] = intent;
      await this.commit(next);
      return structuredClone(intent);
    });
  }

  async closeAndFlush() {
    this.queue.close();
    await this.queue.flush();
  }

  reopen() {
    this.queue.reopen();
  }

  private compact() {
    const now = this.now();
    for (const [intentId, intent] of Object.entries(this.state.intents)) {
      if (
        intent.phase === "completed" &&
        intent.terminalAt !== undefined &&
        now - intent.terminalAt > RETENTION_MS
      ) {
        delete this.state.intents[intentId];
      }
    }
  }

  private async commit(next: PurgeJournalState) {
    const parsed = purgeJournalSchema.parse(next);
    await this.persist(parsed);
    this.state = parsed;
  }

  private async persist(state: PurgeJournalState) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.filePath);
  }
}
