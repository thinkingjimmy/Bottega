/**
 * [INPUT]: Depends on Node atomic file IO, ledger-values schema and persistence/serial-queue
 * [OUTPUT]: Provides ChatHomeLedger v1 with exact replay identity, atomic ownership transitions, corruption isolation, and 30-day tombstone compaction
 * [POS]: The creation/ownership leaf of the chat-home lock; Access to any other lock during lock-up
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SerialQueue } from "../persistence/serial-queue";
import {
  chatHomeLedgerSchema,
  chatHomeRecordSchema,
  emptyChatHomeLedger,
  type ChatHomeLedgerState,
  type ChatHomeRecord,
} from "./ledger-values";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const clone = <T>(value: T): T => structuredClone(value);

export class ChatHomeLedger {
  readonly filePath: string;
  private readonly queue = new SerialQueue();
  private state = emptyChatHomeLedger();
  private warning = "";

  constructor(
    userData: string,
    private readonly now: () => number = Date.now
  ) {
    this.filePath = join(userData, "chat-home-ledger.json");
  }

  async initialize() {
    await this.queue.enqueue(async () => {
      try {
        this.state = chatHomeLedgerSchema.parse(
          JSON.parse(await readFile(this.filePath, "utf8"))
        );
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
          this.state = emptyChatHomeLedger();
        } else {
          const isolated = this.filePath.replace(
            /\.json$/,
            `.corrupt-${this.now()}.json`
          );
          await rename(this.filePath, isolated);
          this.state = emptyChatHomeLedger();
          this.warning =
            `Chat Home 账本损坏，已隔离到 ${isolated}；现有目录均降级为无所有权证明。`;
        }
      }
      this.compact(this.now());
      await this.persist(this.state);
    });
    return this.warning;
  }

  get(chatId: string) {
    const record = this.state.chats[chatId];
    return record ? clone(record) : undefined;
  }

  list() {
    return Object.values(this.state.chats).map(clone);
  }

  validHomes() {
    return Object.values(this.state.chats)
      .filter(
        (record) =>
          record.ownership === "valid" && record.phase === "committed"
      )
      .map((record) => record.homeDir);
  }

  plan(record: ChatHomeRecord) {
    return this.queue.enqueue(async () => {
      const parsed = chatHomeRecordSchema.parse(record);
      const existing = this.state.chats[parsed.chatId];
      if (existing) {
        if (
          existing.intentId !== parsed.intentId ||
          existing.submissionHash !== parsed.submissionHash ||
          existing.incarnationId !== parsed.incarnationId ||
          existing.homeDir !== parsed.homeDir ||
          JSON.stringify(existing.workspaceScope) !== JSON.stringify(parsed.workspaceScope) ||
          JSON.stringify(existing.worktree ?? null) !== JSON.stringify(parsed.worktree ?? null)
        ) {
          throw new Error("CreationIntent 与已有 Chat Home ownership 冲突");
        }
        if (existing.phase !== "rolledBack") return clone(existing);
      }
      const next = clone(this.state);
      next.chats[parsed.chatId] = parsed;
      await this.commit(next);
      return clone(parsed);
    });
  }

  transition(
    chatId: string,
    expected: ChatHomeRecord["phase"] | ChatHomeRecord["phase"][],
    phase: ChatHomeRecord["phase"],
    patch: Partial<Pick<ChatHomeRecord, "ownership" | "terminalAt">> = {}
  ) {
    return this.queue.enqueue(async () => {
      const current = this.state.chats[chatId];
      if (!current) throw new Error("CreationIntent 不存在");
      const phases = Array.isArray(expected) ? expected : [expected];
      if (!phases.includes(current.phase)) return clone(current);
      const record = chatHomeRecordSchema.parse({
        ...current,
        ...patch,
        phase,
      });
      const next = clone(this.state);
      next.chats[chatId] = record;
      await this.commit(next);
      return clone(record);
    });
  }

  removeOwnership(chatId: string) {
    return this.queue.enqueue(async () => {
      if (!this.state.chats[chatId]) return;
      const next = clone(this.state);
      delete next.chats[chatId];
      await this.commit(next);
    });
  }

  async closeAndFlush() {
    this.queue.close();
    await this.queue.flush();
  }

  reopen() {
    this.queue.reopen();
  }

  private compact(now: number) {
    for (const [chatId, record] of Object.entries(this.state.chats)) {
      if (
        record.terminalAt !== undefined &&
        now - record.terminalAt > RETENTION_MS &&
        record.ownership === "invalid"
      ) {
        delete this.state.chats[chatId];
      }
    }
  }

  private async commit(next: ChatHomeLedgerState) {
    const parsed = chatHomeLedgerSchema.parse(next);
    await this.persist(parsed);
    this.state = parsed;
  }

  private async persist(state: ChatHomeLedgerState) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.filePath);
  }
}
