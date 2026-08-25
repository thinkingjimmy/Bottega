/**
 * [INPUT]: Depends on Node durable fs, ChatRecord/attachment metadata; Policy/Delivery receipt, reservation drain, incarnation, CAS main file removal and resource release steps
 * [OUTPUT]: Provides immutable mode/old-Space capsule, per-journal claim, per effect checkpoint, deleted-proven/unknown, decreases the failure of determination and clearance
 * [POS]: The main deleted the only source of truth that proves it; Intent before Policy→drain→ Delivery→Chat bytes, receipt/checkpoint collapsed by operationId
 */

import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
} from "node:fs/promises";
import { join } from "node:path";
import type {
  ChatAttachmentMeta,
  ChatRecord,
} from "../../../shared/chats-ipc";

type Stage =
  | "prepared"
  | "fenced"
  | "policy-applied"
  | "drained"
  | "delivery-applied"
  | "chat-removed"
  | "resources-released"
  | "cleaned";

export type ConversationDeletionMode = "local-only" | "cleanup-and-rebuild";

export type DeletionMemoryIntent = Readonly<{
  operationId: string;
  sourceSessionKey: string;
  memorySpaceId: string;
}>;

export type DeletionRecord = Pick<ChatRecord, "id" | "incarnationId"> &
  Partial<Pick<ChatRecord, "projectId">>;

export type ConversationDeletionResource = {
  id: string;
  release(
    record: DeletionRecord,
    attachments: readonly ChatAttachmentMeta[],
    proof: "deleted-proven"
  ): Promise<void>;
};

type Journal = {
  schemaVersion: 2;
  operationId: string;
  mode: ConversationDeletionMode;
  record: DeletionRecord;
  memory: DeletionMemoryIntent;
  attachments: ChatAttachmentMeta[];
  policyReceiptDigest: string | null;
  deliveryReceiptDigests: string[];
  releasedResources: string[];
  stage: Stage;
  updatedAt: number;
};

type DeletionCallbacks = {
  snapshot(
    record: DeletionRecord,
    operationId: string
  ): Promise<DeletionMemoryIntent>;
  validateFence?(record: DeletionRecord): void;
  fence(record: DeletionRecord): Promise<void>;
  applyPolicy(intent: DeletionMemoryIntent): Promise<{ receiptDigest: string }>;
  drain(intent: DeletionMemoryIntent): Promise<void>;
  applyDelivery(
    intent: DeletionMemoryIntent
  ): Promise<ReadonlyArray<{ receiptDigest: string }>>;
  verifyReceipts?(
    intent: DeletionMemoryIntent,
    policyReceiptDigest: string,
    deliveryReceiptDigests: readonly string[],
    mode: ConversationDeletionMode
  ): Promise<void> | void;
  removeChat(record: DeletionRecord): Promise<void>;
  onChatRemoved(record: DeletionRecord): void;
  onCleanupError(record: DeletionRecord, cause: unknown): void;
  resources: readonly ConversationDeletionResource[];
};

const ORDER: Stage[] = [
  "prepared",
  "fenced",
  "policy-applied",
  "drained",
  "delivery-applied",
  "chat-removed",
  "resources-released",
  "cleaned",
];

export class ConversationDeletionCoordinator {
  private readonly claims = new Map<string, Promise<void>>();
  private readonly active = new Set<string>();

  constructor(private readonly root: string) {}

  async remove(
    record: ChatRecord,
    callbacks: DeletionCallbacks,
    mode: ConversationDeletionMode = "local-only"
  ) {
    await this.prepare(record, callbacks, mode);
    return this.drive(record, callbacks);
  }

  prepare(
    record: ChatRecord,
    callbacks: DeletionCallbacks,
    mode: ConversationDeletionMode = "local-only",
    preparedMemory?: DeletionMemoryIntent
  ) {
    const key = this.path(record.id, record.incarnationId);
    return this.enqueue(key, async () => {
      await mkdir(this.root, { recursive: true });
      const existing = await this.read(key);
      if (existing && existing.stage !== "cleaned") {
        /* mode 只允许单调升级：用户在 local-only 卡住后改选「删除并重建」，
           不得被旧 journal 静默降级成零 CleanupRequest 的「成功」。 */
        if (existing.mode === "local-only" && mode === "cleanup-and-rebuild") {
          existing.mode = mode;
          await this.write(existing);
        }
        this.active.add(key);
        if (existing.stage === "prepared") {
          callbacks.validateFence?.(existing.record);
          await callbacks.fence(existing.record);
          await this.advance(existing, "fenced");
        }
        return;
      }
      const operationId = `delete:${record.id}:${record.incarnationId}`;
      const deletionRecord = {
        id: record.id,
        incarnationId: record.incarnationId,
        ...(record.projectId ? { projectId: record.projectId } : {}),
      };
      const memory = preparedMemory ??
        await callbacks.snapshot(deletionRecord, operationId);
      const journal: Journal = {
        schemaVersion: 2,
        operationId,
        mode,
        record: {
          ...deletionRecord,
        },
        memory,
        attachments: record.messages.flatMap((message) =>
          message.role === "user" ? message.attachments ?? [] : []
        ),
        policyReceiptDigest: null,
        deliveryReceiptDigests: [],
        releasedResources: [],
        stage: "prepared",
        updatedAt: Date.now(),
      };
      callbacks.validateFence?.(journal.record);
      await this.write(journal);
      this.active.add(key);
      await callbacks.fence(journal.record);
      await this.advance(journal, "fenced");
    });
  }

  drive(record: DeletionRecord, callbacks: DeletionCallbacks) {
    const key = this.path(record.id, record.incarnationId);
    return this.enqueue(key, async () => {
      const journal = await this.read(key);
      if (!journal) throw new Error("Chat deletion intent 不存在");
      this.active.add(key);
      return this.resume(journal, callbacks);
    });
  }

  recover(callbacks: DeletionCallbacks, waitForCompletion = true) {
    return (async () => {
      await mkdir(this.root, { recursive: true });
      const tasks: Promise<unknown>[] = [];
      for (const entry of await readdir(this.root, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const journal = await this.read(join(this.root, entry.name));
        if (!journal || journal.stage === "cleaned") continue;
        // 单个 journal 的恢复失败只降级告警：一个坏 journal 不得阻断其余恢复，
        // 更不能把 rejection 冒泡进启动主链击穿整个应用
        const key = join(this.root, entry.name);
        this.active.add(key);
        tasks.push(this.enqueue(key, async () => {
          try {
            await this.resume(journal, callbacks);
          } catch (cause) {
            callbacks.onCleanupError(journal.record, cause);
          }
        }));
      }
      if (waitForCompletion) {
        await Promise.all(tasks);
      } else {
        void Promise.allSettled(tasks);
      }
    })();
  }

  async proof(chatId: string, incarnationId: string) {
    const journal = await this.read(this.path(chatId, incarnationId));
    return journal &&
      ORDER.indexOf(journal.stage) >= ORDER.indexOf("chat-removed")
      ? ("deleted-proven" as const)
      : ("unknown" as const);
  }

  hasActive(chatId: string, incarnationId?: string) {
    return [...this.active].some((path) => {
      const name = path.slice(path.lastIndexOf("/") + 1);
      return incarnationId
        ? name === `${chatId}.${incarnationId}.json`
        : name.startsWith(`${chatId}.`) && name.endsWith(".json");
    });
  }

  private enqueue<T>(key: string, task: () => Promise<T>) {
    const previous = this.claims.get(key) ?? Promise.resolve();
    const current = previous.then(task);
    const settled = current.then(() => undefined, () => undefined);
    this.claims.set(key, settled);
    void settled.finally(() => {
      if (this.claims.get(key) === settled) this.claims.delete(key);
    });
    return current;
  }

  private async resume(journal: Journal, callbacks: DeletionCallbacks) {
    if (journal.stage === "prepared") {
      await callbacks.fence(journal.record);
      await this.advance(journal, "fenced");
    }
    if (journal.stage === "fenced") {
      const receipt = await callbacks.applyPolicy(journal.memory);
      journal.policyReceiptDigest = receipt.receiptDigest;
      await this.advance(journal, "policy-applied");
    }
    if (journal.stage === "policy-applied") {
      await callbacks.drain(journal.memory);
      await this.advance(journal, "drained");
    }
    if (journal.stage === "drained") {
      if (journal.mode === "cleanup-and-rebuild") {
        const receipts = await callbacks.applyDelivery(journal.memory);
        journal.deliveryReceiptDigests = receipts.map(
          (receipt) => receipt.receiptDigest
        );
      }
      await this.advance(journal, "delivery-applied");
    }
    if (journal.stage === "delivery-applied") {
      if (!journal.policyReceiptDigest) {
        throw new Error("Chat deletion 缺少 Policy receipt");
      }
      await callbacks.verifyReceipts?.(
          journal.memory,
          journal.policyReceiptDigest,
          journal.deliveryReceiptDigests,
          journal.mode
        );
      await callbacks.removeChat(journal.record);
      await this.advance(journal, "chat-removed");
      callbacks.onChatRemoved(journal.record);
    }
    if (journal.stage === "chat-removed") {
      for (const resource of callbacks.resources) {
        if (journal.releasedResources.includes(resource.id)) continue;
        try {
          await resource.release(
            journal.record,
            journal.attachments,
            "deleted-proven"
          );
        } catch (cause) {
          callbacks.onCleanupError(journal.record, cause);
          return { cleanupPending: true as const };
        }
        journal.releasedResources.push(resource.id);
        await this.write(journal);
      }
      await this.advance(journal, "resources-released");
    }
    if (journal.stage === "resources-released") {
      await this.advance(journal, "cleaned");
    }
    if (journal.stage === "cleaned") {
      this.active.delete(this.path(journal.record.id, journal.record.incarnationId));
    }
    return { cleanupPending: false as const };
  }

  private async advance(journal: Journal, stage: Stage) {
    journal.stage = stage;
    await this.write(journal);
  }

  private async read(path: string): Promise<Journal | null> {
    try {
      const raw = JSON.parse(await readFile(path, "utf8")) as Partial<Journal>;
      if (
        raw.schemaVersion !== 2 ||
        typeof raw.operationId !== "string" ||
        (raw.mode !== "local-only" && raw.mode !== "cleanup-and-rebuild") ||
        !raw.record ||
        !raw.memory ||
        raw.memory.operationId !== raw.operationId ||
        typeof raw.memory.sourceSessionKey !== "string" ||
        typeof raw.memory.memorySpaceId !== "string" ||
        typeof raw.record.id !== "string" ||
        typeof raw.record.incarnationId !== "string" ||
        !ORDER.includes(raw.stage as Stage) ||
        !Array.isArray(raw.attachments) ||
        (raw.policyReceiptDigest !== null &&
          typeof raw.policyReceiptDigest !== "string") ||
        !Array.isArray(raw.deliveryReceiptDigests) ||
        !Array.isArray(raw.releasedResources)
      ) {
        return null;
      }
      return raw as Journal;
    } catch {
      return null;
    }
  }

  private async write(journal: Journal) {
    journal.updatedAt = Date.now();
    const path = this.path(journal.record.id, journal.record.incarnationId);
    const temporary = `${path}.${randomUUID()}.tmp`;
    const file = await open(temporary, "w", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(journal)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    const directory = await open(this.root, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  private path(chatId: string, incarnationId: string) {
    return join(this.root, `${chatId}.${incarnationId}.json`);
  }
}
