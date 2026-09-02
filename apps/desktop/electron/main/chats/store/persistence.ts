/**
 * [INPUT]: Depends on canonical Chat records, the typed SQLite client, and mutation outcome errors
 * [OUTPUT]: Provides aggregate, narrow fact, narrow message, and narrow message-plus-subagent persistence operations
 * [POS]: Durable write adapter beneath ChatStore; queueing, metadata publication, and domain transitions remain in the coordinator
 */

import { createHash, randomUUID } from "node:crypto";
import type { ChatMessage, ChatRecord } from "../../../../shared/chats-ipc";
import type { ChatFacts } from "../chat-summary";
import type { ChatDatabaseClient } from "../sqlite/database-client";
import type { MutationOutcome } from "../sqlite/database-protocol";
import { ChatMutationOutcomeUnknownError } from "./mutation-outcome";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function requireSqlite(input: {
  database: ChatDatabaseClient | null;
  deviceId: string | null;
}) {
  if (!input.database) throw new Error("Chat SQLite database is unavailable");
  if (!input.deviceId) throw new Error("Chat device identity is unavailable");
  return { database: input.database, deviceId: input.deviceId };
}

function committed(outcome: MutationOutcome<unknown>) {
  if (outcome && typeof outcome === "object" && "status" in outcome) {
    if (outcome.status === "committed") return;
    if (outcome.status === "outcome_unknown") {
      throw new ChatMutationOutcomeUnknownError(outcome.operationId, outcome.reason);
    }
    if (outcome.status === "rejected") throw new Error(outcome.failure.message);
  }
  throw new Error("Chat mutation returned an invalid outcome");
}

export async function persistRecordToStorage(input: {
  record: ChatRecord;
  database: ChatDatabaseClient | null;
  deviceId: string | null;
  expectedAggregateRevision: number | null;
  onCommit(): void;
}) {
  const { database, deviceId } = requireSqlite(input);
  const operationId = randomUUID();
  committed(await database.execute({
    kind: "upsert-record",
    operationId,
    requestHash: hash({
      operationId,
      record: input.record,
      deviceId,
      expectedAggregateRevision: input.expectedAggregateRevision,
    }),
    record: input.record,
    deviceId,
    lifecycleKind: input.record.importOrigin ? "external-managed" : "native",
    expectedAggregateRevision: input.expectedAggregateRevision,
  }));
  input.onCommit();
}

/* 事实变更的窄写入：命令里没有 messages/subagents/branches，写入面因此
   与它们无关；CAS 与整聚合写入共用同一个 expectedAggregateRevision。 */
export async function persistFactsToStorage(input: {
  facts: ChatFacts;
  database: ChatDatabaseClient | null;
  deviceId: string | null;
  expectedAggregateRevision: number;
  onCommit(): void;
}) {
  const { database, deviceId } = requireSqlite(input);
  const operationId = randomUUID();
  const command = {
    kind: "update-chat-facts" as const,
    operationId,
    chatId: input.facts.id,
    deviceId,
    expectedAggregateRevision: input.expectedAggregateRevision,
    facts: input.facts,
  };
  committed(await database.execute({ ...command, requestHash: hash(command) }));
  input.onCommit();
}

export async function persistAppendedMessageToStorage(input: {
  current: ChatRecord;
  record: ChatRecord;
  message: ChatMessage;
  database: ChatDatabaseClient | null;
  deviceId: string | null;
  onCommit(): void;
}) {
  const { database, deviceId } = requireSqlite(input);
  const operationId = randomUUID();
  const command = {
    kind: "append-message" as const,
    operationId,
    chatId: input.record.id,
    deviceId,
    message: input.message,
    expectedAggregateRevision: input.current.chatRecordRevision,
    expectedMessageRevision: input.current.chatMessageRevision,
    nextAggregateRevision: input.record.chatRecordRevision,
    nextMessageRevision: input.record.chatMessageRevision,
    nextSeq: input.record.nextSeq,
    updatedAt: input.record.updatedAt,
    retainedFromSeq: input.record.messages[0]?.seq ?? input.message.seq,
    trimmedThroughSeq: input.record.trimmedThroughSeq ?? 0,
  };
  committed(await database.execute({ ...command, requestHash: hash(command) }));
  input.onCommit();
}

export async function persistTurnCommitToStorage(input: {
  current: ChatRecord;
  record: ChatRecord;
  message: ChatMessage | null;
  database: ChatDatabaseClient | null;
  deviceId: string | null;
  onCommit(): void;
}) {
  const { database, deviceId } = requireSqlite(input);
  const operationId = randomUUID();
  const command = {
    kind: "commit-turn" as const,
    operationId,
    chatId: input.record.id,
    deviceId,
    message: input.message,
    subagents: input.record.subagents ?? {},
    expectedAggregateRevision: input.current.chatRecordRevision,
    expectedMessageRevision: input.current.chatMessageRevision,
    nextAggregateRevision: input.record.chatRecordRevision,
    nextMessageRevision: input.record.chatMessageRevision,
    nextSeq: input.record.nextSeq,
    updatedAt: input.record.updatedAt,
    retainedFromSeq: input.record.messages[0]?.seq ?? input.message?.seq ?? 1,
    trimmedThroughSeq: input.record.trimmedThroughSeq ?? 0,
  };
  committed(await database.execute({ ...command, requestHash: hash(command) }));
  input.onCommit();
}
