/**
 * [INPUT]: Depends on the shared ChatStoreState cell, the ChatReadModel projection, the typed SQLite client, the abortable immutable history pump, and continuation commands
 * [OUTPUT]: Provides ChatHistorySagaApi: readonly presentation mutations, no-op-on-equal imported source_status marking that returns fresh metadata only when it actually moved, cancellable receipt-boundary external-history synchronization, and serialized receipt-gated continuation begin/finalize/precommit-fail/orphan-isolation operations
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
  MutationOutcome,
} from "../sqlite/database-protocol";
import { ChatNotFoundError } from "../chat-commit";
import { assertChatId } from "../chat-guards";
import { syncExternalHistory as runHistorySync } from "./history-sync";
import type { ChatReadModel } from "./read-api";
import type { ChatStoreState } from "./state";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function resultOf<T>(outcome: MutationOutcome<T>) {
  if (outcome.status === "committed") return outcome.receipt.result;
  if (outcome.status === "outcome_unknown") {
    throw Object.assign(new Error(outcome.reason), {
      status: outcome.status,
      operationId: outcome.operationId,
    });
  }
  throw new Error(outcome.failure.message);
}

export class ChatHistorySagaApi {
  constructor(
    private readonly state: ChatStoreState,
    private readonly reads: ChatReadModel
  ) {}

  updateReadonlyPresentation(
    chatId: string,
    presentation:
      | { kind: "title"; title: string }
      | { kind: "archive"; archivedAt: number | null }
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
      resultOf(await this.state.requireDatabase().execute({
        ...command,
        requestHash: hash(command),
      }));
      await this.state.refreshMetadata(chatId);
      const record = this.reads.getMetadata(chatId);
      if (!record) throw new ChatNotFoundError("聊天账本不存在");
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
      const result = resultOf(await this.state.requireDatabase().execute({
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
    return this.state.queue.enqueue(async () => {
      const result = await runHistorySync({
        database: this.state.requireDatabase(),
        deviceId: this.state.requireDeviceId(),
        source,
        blocks,
        signal,
      });
      const metadata = await this.state.refreshMetadata(result.chatId);
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
      return resultOf(await this.state.requireDatabase().execute({
        ...command,
        requestHash: hash(command),
      }));
    });
  }

  markContinuationHomePreparing(sagaId: string, operationId: string, now: number) {
    return this.state.queue.enqueue(async () => {
      const command = {
        kind: "mark-continuation-home-preparing" as const,
        sagaId,
        operationId,
        now,
      };
      return resultOf(await this.state.requireDatabase().execute({
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
      return resultOf(await this.state.requireDatabase().execute({
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
    session: SessionRef;
    firstMessage: ChatMessage;
    adoptionSnapshotId: string;
    snapshotDigest: string;
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
      const result = resultOf(await this.state.requireDatabase().execute({
        ...command,
        requestHash: hash(command),
      }));
      await this.state.refreshMetadata(result.chatId);
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
      return resultOf(await this.state.requireDatabase().execute({
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
      return resultOf(await this.state.requireDatabase().execute({
        ...command,
        requestHash: hash(command),
      }));
    });
  }
}
