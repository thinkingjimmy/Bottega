/**
 * [INPUT]: Depends on the shared ChatStoreState cell, the ChatReadModel projection, the typed SQLite client, the abortable immutable history pump with its requireCommitted gate, and continuation commands
 * [OUTPUT]: Serializes import receipts, readonly presentation that wakes publication on a real metadata edit, prepared replay sealing, and nullable-session continuation mutations while parsing stays outside the Chat queue.
 * [POS]: SQLite import/continuation collaborator of ChatStore; durable SQL stays isolated in the database worker and every mutation here rides the shared serial queue
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  AdoptChatInput,
  ChatMessage,
  ChatRecord,
} from "../../../../shared/chats-ipc";
import type { ForeignHistoryMessage } from "../../../../shared/history-import-ipc";
import type { PreparedHistoryImportBatch } from "../sqlite/database-protocol";
import type { ChatStartState, ConversationContext } from "../../../../shared/placement/facts";
import type { AppGrantRecord } from "../../../../shared/apps-ipc";
import type { SessionRef } from "../../../../shared/agent-ipc";
import type {
  ContinuationHomeEvidence,
  HistoryImportSource,
} from "../sqlite/database-protocol";
import { ChatNotFoundError } from "../chat-commit";
import { assertChatId } from "../chat-guards";
import { requireCommitted, syncExternalHistory as runHistorySync } from "./history-sync";
import type { ChatReadModel } from "./read-api";
import type { ChatStoreState } from "./state";
import { metadataEdited, type ChatSyncApi } from "./sync/api";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class ChatHistorySagaApi {
  constructor(
    private readonly state: ChatStoreState,
    private readonly reads: ChatReadModel,
    private readonly sync: ChatSyncApi
  ) {}

  updateReadonlyPresentation(
    chatId: string,
    presentation:
      | { kind: "title"; title: string }
      | { kind: "archive"; archivedAt: number | null }
      | { kind: "sort"; sortKey: number | null }
  ) {
    return this.state.queue.enqueue(async () => {
      assertChatId(chatId);
      const current = this.state.metadata.get(chatId);
      if (!current) throw new ChatNotFoundError("聊天不存在");
      if (current.readOnlyReason !== "external-readonly") {
        throw new Error("Chat is no longer readonly; retry the presentation mutation");
      }
      const now = this.state.now();
      const operationId = randomUUID();
      const titleJob =
        presentation.kind === "title" && current.titleJob.state === "pending"
          ? {
              state: "superseded" as const,
              jobId: current.titleJob.jobId,
              supersededAt: now,
            }
          : current.titleJob;
      const command = {
        kind: "update-readonly-presentation" as const,
        operationId,
        chatId,
        deviceId: this.state.requireDeviceId(),
        expectedAggregateRevision: current.chatRecordRevision,
        nextAggregateRevision: current.chatRecordRevision + 1,
        updatedAt: now,
        presentation:
          presentation.kind === "title"
            ? {
                kind: "title" as const,
                title: presentation.title,
                titleSource: "user" as const,
                titleJob,
              }
            : presentation,
      };
      requireCommitted(await this.state.requireDatabase().execute({
        ...command,
        requestHash: hash(command),
      }));
      await this.state.refreshMetadata(chatId);
      const record = this.reads.getMetadata(chatId);
      if (!record) throw new ChatNotFoundError("聊天账本不存在");
      // Same presentation values, same queued patch: an imported row must not wait for the periodic pass either.
      if (metadataEdited(current, record)) this.sync.notifyAppended("chat", chatId);
      return record;
    });
  }

  /* 扫描说了算的那一格：源文件从扫描里消失就是 "missing"，回来就是
     "match"。同值不写、不推 revision、不播报——每一轮扫描都会经过这里。 */
  markImportSourceStatus(chatId: string, sourceStatus: "match" | "missing") {
    return this.state.queue.enqueue(async () => {
      assertChatId(chatId);
      if (!this.state.metadata.has(chatId)) return null;
      const command = {
        kind: "mark-import-source-status" as const,
        operationId: randomUUID(),
        chatId,
        sourceStatus,
      };
      const result = requireCommitted(await this.state.requireDatabase().execute({
        ...command,
        requestHash: hash(command),
      }));
      return result.changed ? await this.state.refreshMetadata(chatId) : null;
    });
  }

  async syncExternalHistory(
    source: HistoryImportSource,
    blocks:
      | readonly ForeignHistoryMessage[]
      | AsyncIterable<readonly ForeignHistoryMessage[] | PreparedHistoryImportBatch>,
    signal?: AbortSignal
  ) {
    const result = await runHistorySync({
      database: { execute: command => this.state.queue.enqueue(() => this.state.requireDatabase().execute(command)) },
      deviceId: this.state.requireDeviceId(), source, blocks, signal,
    });
    return this.state.queue.enqueue(async () => {
      const metadata = await this.state.refreshMetadata(result.chatId);
      this.sync.notifyAppended("chat", result.chatId);
      return { ...structuredClone(result), metadata };
    });
  }

  /* 收养 saga 的每一步都是一次持久化写，还要顺手改 metadata：它们必须
     和 create/append/setTitle 排同一条队。调用方（adopted-chat、启动对账、
     coordinator）都在队列之外，绕不出自锁。 */
  beginExternalContinuation(input: {
    chatId: string;
    generationId: string;
    homeIntentId: string;
    continuationInput: AdoptChatInput;
    operationId: string;
    finalizeOperationId: string;
    now: number;
  }) {
    return this.state.queue.enqueue(async () => {
      const command = {
        kind: "begin-continuation-saga" as const,
        ...input,
        deviceId: this.state.requireDeviceId(),
      };
      return requireCommitted(await this.state.requireDatabase().execute({
        ...command,
        requestHash: hash(command),
      }));
    });
  }

  markContinuationHomePreparing(sagaId: string, operationId: string, now: number,
    continuationInput?: import("../../../../shared/chats-ipc").AdoptChatInput) {
    return this.state.queue.enqueue(async () => {
      const command = {
        kind: "mark-continuation-home-preparing" as const,
        sagaId,
        operationId,
        now,
        ...(continuationInput ? { continuationInput } : {}),
      };
      return requireCommitted(await this.state.requireDatabase().execute({
        ...command,
        requestHash: hash(command),
      }));
    });
  }

  recordContinuationHomeCommitted(
    sagaId: string,
    operationId: string,
    evidence: ContinuationHomeEvidence,
    now: number
  ) {
    return this.state.queue.enqueue(async () => {
      const command = {
        kind: "record-continuation-home-committed" as const,
        sagaId,
        operationId,
        homeReceipt: evidence.receipt,
        homeDirIdentity: evidence.homeDirIdentity,
        now,
      };
      return requireCommitted(await this.state.requireDatabase().execute({
        ...command,
        requestHash: hash(command),
      }));
    });
  }

  finalizeExternalContinuation(input: {
    sagaId: string;
    operationId: string;
    expectedGenerationId: string;
    incarnationId: string;
    homeDir: string;
    session: SessionRef | null;
    options?: import("../../../../shared/agent-ipc").AgentTurnOptions;
    firstMessage: ChatMessage;
    adoptionSnapshotId: string | null;
    snapshotDigest: string | null;
    notice?: import("../../../../shared/chats-ipc").NoticeChatMessage;
    startState: ChatStartState;
    context: ConversationContext;
    appRole: ChatRecord["appRole"];
    grants: AppGrantRecord[];
    grantRevision: number;
    now: number;
  }) {
    return this.state.queue.enqueue(async () => {
      const command = {
        kind: "finalize-continuation-saga" as const,
        ...input,
        deviceId: this.state.requireDeviceId(),
      };
      const result = requireCommitted(await this.state.requireDatabase().execute({
        ...command,
        requestHash: hash(command),
      }));
      await this.state.refreshMetadata(result.chatId);
      this.sync.notifyAppended("chat", result.chatId);
      return result;
    });
  }

  listReconcilableContinuations() {
    return this.state.requireDatabase().execute({ kind: "list-reconcilable-continuations" });
  }

  failContinuationPrecommit(
    sagaId: string,
    operationId: string,
    reason: string,
    now: number
  ) {
    return this.state.queue.enqueue(async () => {
      const command = {
        kind: "fail-continuation-precommit" as const,
        sagaId,
        operationId,
        reason,
        now,
      };
      return requireCommitted(await this.state.requireDatabase().execute({
        ...command,
        requestHash: hash(command),
      }));
    });
  }

  isolateContinuationOrphan(
    sagaId: string,
    operationId: string,
    reason: string,
    now: number
  ) {
    return this.state.queue.enqueue(async () => {
      const command = {
        kind: "isolate-continuation-orphan" as const,
        sagaId,
        operationId,
        reason,
        now,
      };
      return requireCommitted(await this.state.requireDatabase().execute({
        ...command,
        requestHash: hash(command),
      }));
    });
  }
}
