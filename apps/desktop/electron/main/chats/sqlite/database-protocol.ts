/**
 * [INPUT]: Depends on shared Chat/adoption contracts, Chat metadata, Chat facts, and connection modes
 * [OUTPUT]: Provides the closed query/narrow-fact/mutation/import/continuation/maintenance command vocabulary whose history-import entry is always one whole source message, the keyset search-document cursor, result map, receipts, transport envelopes, and delegated runtime decoders
 * [POS]: Trust boundary between Electron main and the sole SQLite owner; arbitrary SQL can never cross this port
 */

import type {
  ChatAttachmentMeta,
  ChatFindCursor,
  ChatFindPage,
  ChatMessage,
  ChatOutlineCursor,
  ChatRecord,
  ChatOutlinePage,
  PersistedSubagent,
  ChatTimelineAroundInput,
  ChatTimelinePage,
  ChatTimelinePageInput,
} from "../../../../shared/chats-ipc";
import type { ChatFacts, ChatMetadata } from "../chat-summary";
import type { ConnectionMode } from "./connection";
import {
  parseDatabaseRequestValue,
  parseDatabaseResponseValue,
} from "./database-protocol-validation";

export type ChatDatabaseFailure = Readonly<{
  kind:
    | "constraint"
    | "conflict"
    | "corrupt"
    | "future-schema"
    | "locked"
    | "disk-full"
    | "protocol"
    | "unknown";
  message: string;
}>;

export type MutationReceipt<T> = Readonly<{
  operationId: string;
  requestHash: string;
  kind: string;
  targetId: string | null;
  result: T;
  committedAt: number;
}>;

export type MutationOutcome<T> =
  | { status: "committed"; receipt: MutationReceipt<T> }
  | { status: "rejected"; failure: ChatDatabaseFailure }
  | { status: "outcome_unknown"; operationId: string; reason: string };

export type MemoryChatSummary = Readonly<{
  id: string;
  incarnationId: string;
  homeDir: string | null;
  lastSeq: number;
  trimmedThroughSeq: number;
}>;

export type MemoryNativeSegmentPage = Readonly<{
  id: string;
  incarnationId: string;
  projectId: string | null;
  homeDir: string | null;
  lastSeq: number;
  trimmedThroughSeq: number;
  precedingUser: ChatMessage | null;
  messages: ChatMessage[];
  nextAfterSeq: number | null;
}>;

export type SearchDocumentHit = Readonly<{
  chatId: string;
  documentKind: "title" | "native" | "imported-version";
  sourceRowId: string;
  searchText: string;
  message: ChatMessage | null;
  messageId: string | null;
  messageSeq: number | null;
  messageRole: "user" | "assistant" | null;
  timelineSegment: "native" | "imported" | null;
  title: string | null;
  agent: ChatRecord["agent"];
  updatedAt: number;
  activeGenerationId: string | null;
  incarnationId: string | null;
  coreRevision: number;
  nativeMessageRevision: number;
}>;

/* 键集游标：上一页最后一条命中的排序键本身（updated_at DESC, chat_id,
   document kind rank, row_id）。用偏移量分页时，扫描期间任何一条 Chat 被
   touch 都会整体推移窗口，前一页读过的会重发、没读到的会被跳过。 */
export type SearchDocumentCursor = Readonly<{
  updatedAt: number;
  chatId: string;
  kindRank: number;
  rowId: number;
}>;

export type HistoryImportSource = Readonly<{
  projectId: string;
  sourceKind: import("../../../../shared/history-import-ipc").HistorySourceKind;
  storageFingerprint: string;
  canonicalNativeId: string;
  aliases: string[];
  resumeAlias: string;
  originalCwd: string;
  title: string;
  archivedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  historyRevision: string;
  sourceIncarnation: string;
  sourceSize: number;
  sourceMtimeNs: string;
  incompleteTail: boolean | "unknown";
  canResume: boolean;
  sourceStatus: "match" | "changed" | "missing";
}>;

export type HistoryImportEntryInput = Readonly<{
  sourceEntryId: string;
  sourceMessageId?: string | null;
  deliverySeq: number;
  role: "user" | "assistant";
  content: string;
  createdAt?: number | null;
  payload?: unknown;
  searchText: string;
  projection?: Readonly<{
    codecVersion: 1;
    contentDigest: string;
    normalizedSearchText: string;
    searchTextDigest: string;
    gramsText: string;
    gramsDigest: string;
  }>;
}>;

export type PreparedHistoryImportBatch = Readonly<{
  kind: "prepared-history-import";
  entries: HistoryImportEntryInput[];
}>;

export type ContinuationSagaSnapshot = Readonly<{
  sagaId: string;
  chatId: string;
  generationId: string;
  deviceId: string;
  homeIntentId: string;
  continuationInput: import("../../../../shared/chats-ipc").AdoptChatInput | null;
  homeReceipt: unknown | null;
  homeDirIdentity: unknown | null;
  intentOperationId: string;
  finalizeOperationId: string;
  state:
    | "intent-written"
    | "home-preparing"
    | "home-committed"
    | "finalizing"
    | "completed"
    | "rolling-back-precommit"
    | "committed-orphan"
    | "failed";
  lastError: string | null;
  updatedAt: number;
}>;

export type ContinuationHomeEvidence = Readonly<{
  receipt: Readonly<{
    phase: "committed";
    chatId: string;
    intentId: string;
    incarnationId: string;
    homeDir: string;
  }>;
  homeDirIdentity: Readonly<{
    root: Readonly<{ dev: string; ino: string }>;
    home: Readonly<{ dev: string; ino: string }>;
  }>;
}>;

export type DatabaseCommand =
  | {
      kind: "initialize";
      databasePath: string;
      deviceId: string;
      mode: ConnectionMode;
    }
  | { kind: "list-metadata"; deviceId: string; chatId?: string }
  | { kind: "get-record"; chatId: string; deviceId: string }
  | {
      kind: "get-native-message";
      chatId: string;
      deviceId: string;
      selector:
        | { kind: "id"; messageId: string }
        | { kind: "seq"; seq: number }
        | { kind: "first-user" };
    }
  | { kind: "get-native-messages"; chatId: string; deviceId: string }
  | { kind: "get-native-subagents"; chatId: string; deviceId: string }
  | { kind: "get-timeline-page"; input: ChatTimelinePageInput; deviceId: string }
  | { kind: "get-timeline-around"; input: ChatTimelineAroundInput; deviceId: string }
  | { kind: "get-outline-page"; chatId: string; cursor?: ChatOutlineCursor; limit: number; deviceId: string }
  | {
      kind: "find-messages";
      chatId: string;
      grams: string[];
      tokens: string[];
      cursor?: ChatFindCursor;
      limit: number;
      deviceId: string;
    }
  | {
      kind: "upsert-record";
      operationId: string;
      requestHash: string;
      record: ChatRecord;
      deviceId: string;
      lifecycleKind?: "native" | "external-managed";
      expectedAggregateRevision?: number | null;
    }
  | {
      /* 事实变更的窄口：只写 chats + chat_local_*（标题变了才动 title 文档），
         chat_messages / chat_subagents / 原生搜索文档一行都不碰。 */
      kind: "update-chat-facts";
      operationId: string;
      requestHash: string;
      chatId: string;
      deviceId: string;
      expectedAggregateRevision: number;
      facts: ChatFacts;
    }
  | {
      kind: "append-message";
      operationId: string;
      requestHash: string;
      chatId: string;
      deviceId: string;
      message: ChatMessage;
      expectedAggregateRevision: number;
      expectedMessageRevision: number;
      nextAggregateRevision: number;
      nextMessageRevision: number;
      nextSeq: number;
      updatedAt: number;
      retainedFromSeq: number;
      trimmedThroughSeq: number;
    }
  | {
      kind: "commit-turn";
      operationId: string;
      requestHash: string;
      chatId: string;
      deviceId: string;
      message: ChatMessage | null;
      subagents: Record<string, PersistedSubagent>;
      expectedAggregateRevision: number;
      expectedMessageRevision: number;
      nextAggregateRevision: number;
      nextMessageRevision: number;
      nextSeq: number;
      updatedAt: number;
      retainedFromSeq: number;
      trimmedThroughSeq: number;
    }
  | {
      kind: "update-readonly-presentation";
      operationId: string;
      requestHash: string;
      chatId: string;
      deviceId: string;
      expectedAggregateRevision: number;
      nextAggregateRevision: number;
      updatedAt: number;
      presentation:
        | {
            kind: "title";
            title: ChatRecord["title"];
            titleSource: ChatRecord["titleSource"];
            titleJob: ChatRecord["titleJob"];
          }
        | { kind: "archive"; archivedAt: number | null };
    }
  | {
      kind: "remove-record";
      operationId: string;
      requestHash: string;
      chatId: string;
      deviceId: string;
      expectedIncarnationId?: string;
    }
  | { kind: "get-operation-receipt"; operationId: string }
  | { kind: "list-attachment-ids" }
  | { kind: "has-attachment-reference"; chatId: string; attachmentId: string; deviceId: string }
  | { kind: "get-attachment-reference"; chatId: string; attachmentId: string; deviceId: string }
  | { kind: "list-memory-summaries"; deviceId: string }
  | {
      kind: "get-memory-native-segment";
      chatId: string;
      deviceId: string;
      afterSeq: number;
      limit: number;
    }
  | {
      kind: "search-documents";
      grams: string[];
      cursor: SearchDocumentCursor | null;
      limit: number;
      deviceId: string;
    }
  | {
      kind: "begin-history-import";
      operationId: string;
      requestHash: string;
      deviceId: string;
      source: HistoryImportSource;
    }
  | {
      kind: "append-history-import-batch";
      operationId: string;
      requestHash: string;
      runId: string;
      sourceRevision: string;
      expectedCursor: string | null;
      expectedRollingDigest: string;
      nextCursor: string;
      entries: HistoryImportEntryInput[];
    }
  | {
      kind: "finalize-history-import";
      operationId: string;
      requestHash: string;
      runId: string;
      expectedEntryCount: number;
      expectedByteSize: number;
      expectedRollingDigest: string;
      /* 解析器读完整个文件之后的判词。扫描期那一格只是抽头几 KB 的猜测，
         谁跑得晚谁说了算——缺席表示这条源没有解析器裁决可用。 */
      incompleteTail?: boolean;
    }
  | {
      kind: "cancel-history-import";
      operationId: string;
      requestHash: string;
      runId: string;
      reason: string;
    }
  | {
      kind: "mark-import-source-status";
      operationId: string;
      requestHash: string;
      chatId: string;
      sourceStatus: "match" | "missing";
    }
  | { kind: "get-history-import-run"; runId: string }
  | {
      kind: "begin-continuation-saga";
      operationId: string;
      requestHash: string;
      chatId: string;
      generationId: string;
      deviceId: string;
      homeIntentId: string;
      continuationInput: import("../../../../shared/chats-ipc").AdoptChatInput;
      finalizeOperationId: string;
      now: number;
    }
  | {
      kind: "mark-continuation-home-preparing";
      operationId: string;
      requestHash: string;
      sagaId: string;
      now: number;
    }
  | {
      kind: "record-continuation-home-committed";
      operationId: string;
      requestHash: string;
      sagaId: string;
      homeReceipt: ContinuationHomeEvidence["receipt"];
      homeDirIdentity: ContinuationHomeEvidence["homeDirIdentity"];
      now: number;
    }
  | {
      kind: "finalize-continuation-saga";
      operationId: string;
      requestHash: string;
      sagaId: string;
      deviceId: string;
      expectedGenerationId: string;
      incarnationId: string;
      homeDir: string;
      session: import("../../../../shared/agent-ipc").SessionRef;
      firstMessage: ChatMessage;
      adoptionSnapshotId: string;
      snapshotDigest: string;
      startState: import("../../../../shared/placement/facts").ChatStartState;
      context: import("../../../../shared/placement/facts").ConversationContext;
      appRole: import("../../../../shared/chats-ipc").AppChatRole | null;
      grants: import("../../../../shared/apps-ipc").AppGrantRecord[];
      grantRevision: number;
      now: number;
    }
  | {
      kind: "fail-continuation-precommit";
      operationId: string;
      requestHash: string;
      sagaId: string;
      reason: string;
      now: number;
    }
  | {
      kind: "isolate-continuation-orphan";
      operationId: string;
      requestHash: string;
      sagaId: string;
      reason: string;
      now: number;
    }
  | { kind: "list-reconcilable-continuations" }
  | { kind: "maintenance-gate" }
  | { kind: "close" };

export type DatabaseRequest = Readonly<{
  protocolVersion: 1;
  requestId: string;
  command: DatabaseCommand;
}>;

export type DatabaseResponse =
  | Readonly<{
      protocolVersion: 1;
      requestId: string;
      ok: true;
      result: unknown;
    }>
  | Readonly<{
      protocolVersion: 1;
      requestId: string;
      ok: false;
      failure: ChatDatabaseFailure;
    }>;

/* 维护闸门的判决书：产品侧要能读懂它才谈得上「跑过一次维护」。 */
export type MaintenanceGateReport = Readonly<{
  integrity: "ok";
  foreignKeys: number;
  domainInvariants: "ok";
  ftsRank: number;
  sourceProjection: Readonly<{ documents: number; repaired: number }>;
}>;

export type UpsertResult = Readonly<{
  chatId: string;
  aggregateRevision: number;
  nativeMessageRevision: number;
}>;

export type RemoveResult = Readonly<{
  chatId: string;
  attachments: ChatAttachmentMeta[];
}>;

export type DatabaseResults = {
  initialize: {
    sqliteVersion: string;
    compileOptions: string[];
    startupMs: number;
  };
  "list-metadata": ChatMetadata[];
  "get-record": ChatRecord | null;
  "get-native-message": ChatMessage | null;
  "get-native-messages": ChatMessage[];
  "get-native-subagents": Record<string, PersistedSubagent>;
  "get-timeline-page": ChatTimelinePage | null;
  "get-timeline-around": ChatTimelinePage | null;
  "get-outline-page": ChatOutlinePage | null;
  "find-messages": ChatFindPage | null;
  "upsert-record": MutationOutcome<UpsertResult>;
  "update-chat-facts": MutationOutcome<UpsertResult>;
  "append-message": MutationOutcome<UpsertResult>;
  "commit-turn": MutationOutcome<UpsertResult>;
  "update-readonly-presentation": MutationOutcome<UpsertResult>;
  "remove-record": MutationOutcome<RemoveResult>;
  "get-operation-receipt": MutationReceipt<unknown> | null;
  "list-attachment-ids": string[];
  "has-attachment-reference": boolean;
  "get-attachment-reference": ChatAttachmentMeta | null;
  "list-memory-summaries": MemoryChatSummary[];
  "get-memory-native-segment": MemoryNativeSegmentPage | null;
  "search-documents": { hits: SearchDocumentHit[]; nextCursor: SearchDocumentCursor | null };
  "begin-history-import": MutationOutcome<{
    runId: string;
    chatId: string;
    generationId: string;
    cursor: string | null;
    rollingDigest: string;
    committedEntryCount: number;
    committedBytes: number;
  }>;
  "append-history-import-batch": MutationOutcome<{
    runId: string;
    cursor: string;
    rollingDigest: string;
    committedEntryCount: number;
    committedBytes: number;
  }> & { transactionDurationMs?: number };
  "finalize-history-import": MutationOutcome<{
    runId: string;
    chatId: string;
    generationId: string;
    supersededGenerationId: string | null;
    gc: {
      deletedGenerations: number;
      deletedEntryVersions: number;
      deletedBlobDigests: string[];
    };
  }>;
  "cancel-history-import": MutationOutcome<{ runId: string; cancelled: true }>;
  "mark-import-source-status": MutationOutcome<{
    chatId: string;
    sourceStatus: "match" | "missing";
    changed: boolean;
  }>;
  "get-history-import-run": {
    runId: string;
    chatId: string;
    generationId: string;
    state: "running" | "completed" | "cancelled" | "failed";
    sourceRevision: string;
    cursor: string | null;
    rollingDigest: string;
    committedEntryCount: number;
    committedBytes: number;
    lastDeliverySeq: number;
  } | null;
  "begin-continuation-saga": MutationOutcome<ContinuationSagaSnapshot>;
  "mark-continuation-home-preparing": MutationOutcome<ContinuationSagaSnapshot>;
  "record-continuation-home-committed": MutationOutcome<ContinuationSagaSnapshot>;
  "finalize-continuation-saga": MutationOutcome<{
    saga: ContinuationSagaSnapshot;
    chatId: string;
    aggregateRevision: number;
    nativeMessageRevision: number;
  }>;
  "fail-continuation-precommit": MutationOutcome<ContinuationSagaSnapshot>;
  "isolate-continuation-orphan": MutationOutcome<ContinuationSagaSnapshot>;
  "list-reconcilable-continuations": ContinuationSagaSnapshot[];
  "maintenance-gate": MaintenanceGateReport;
  close: { closed: true };
};

export function parseDatabaseRequest(value: unknown): DatabaseRequest {
  return parseDatabaseRequestValue(value);
}

export function parseDatabaseResponse(
  value: unknown,
  expectedRequestId: string,
  expectedKind?: DatabaseCommand["kind"]
): DatabaseResponse {
  return parseDatabaseResponseValue(value, expectedRequestId, expectedKind);
}
