/**
 * [INPUT]: Depends on confirmed metadata, the scoped outbox, immutable retained sources and reviewed deletion identities.
 * [OUTPUT]: Fences pending classification before deletion admission. Captures deletion without removing content and retains its exact pending/conflicted/confirmed result across restart.
 * [POS]: Sole SQLite intent transaction; retained views never schedule work independently of the outbox.
 */
import { z } from "zod";
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import { deletionOperationSchema, deletionResultSchema, type DeletionResult } from "@ai-chat/cloud-protocol/lifecycle/model";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { chatDeletionViewSchema, type ChatDeletionRequest, type ChatDeletionKeep } from "../../../../../../shared/cloud/deletion";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { ChatRepositoryReader } from "../../repository/reader";
import type { Row } from "../../repository/codec";
import { readRetainedSource } from "../inventory/source";
import { enqueueSource, retainSource, releaseRoot } from "../retention";
import { archiveDeletion } from "../snapshots";
import { readChatFacts } from "../delivery/facts/state";
import { chatDeletionOperation } from "./model";
const attemptSchema = z.object({ outboxId: z.string(), head: cloudChatHeadSchema.nullable(), operation: deletionOperationSchema, result: deletionResultSchema.nullable() }).strict();
type Attempt = z.infer<typeof attemptSchema>;
const rootId = (scope: SyncScope, chatId: string) => `chat-deletion:${hashChatContent([scope, chatId])}`;
function readAttempt(db: SqliteDatabase, scope: SyncScope, chatId: string): Attempt | null {
  const row = db.prepare(`SELECT s.source_id,s.digest FROM chat_retained_sources s JOIN chat_retention_roots r ON r.source_id=s.source_id
    WHERE r.root_id=? AND s.chat_id=? AND s.environment=? AND s.user_id=? AND s.kind='chat-deletion-attempt' LIMIT 1`)
    .get(rootId(scope, chatId), chatId, scope.environment, scope.userId) as Row | undefined;
  return row ? attemptSchema.parse(readRetainedSource(db, { sourceId: String(row.source_id), digest: String(row.digest) })) : null;
}
function writeAttempt(db: SqliteDatabase, scope: SyncScope, chatId: string, attempt: Attempt, now: number) {
  const root = rootId(scope, chatId); releaseRoot(db, root);
  retainSource(db, { chatId, scope, kind: "chat-deletion-attempt", revision: attempt.head?.chat.cloudRevision ?? 0, rootId: root, payload: attempt, now });
}
export function readChatDeletion(db: SqliteDatabase, scope: SyncScope, chatId: string) {
  const attempt = readAttempt(db, scope, chatId);
  const row = db.prepare("SELECT confirmed_json,deleted FROM cloud_chat_metadata_state WHERE chat_id=? AND environment=? AND user_id=?")
    .get(chatId, scope.environment, scope.userId) as Row | undefined;
  const head = row?.confirmed_json ? cloudChatHeadSchema.parse(JSON.parse(String(row.confirmed_json))) : attempt?.head ?? null;
  const pending = Boolean(attempt && db.prepare("SELECT 1 FROM cloud_outbox WHERE id=? AND environment=? AND user_id=?")
    .get(attempt.outboxId, scope.environment, scope.userId));
  const facts = row ? readChatFacts(db, scope, chatId) : null;
  const reviewHash = hashChatContent([head?.chat ?? null, facts?.queueHash ?? null, Boolean(row?.deleted), attempt]);
  return chatDeletionViewSchema.parse({ head, operation: attempt?.operation ?? null, result: attempt?.result ?? null, pending, reviewHash });
}
export function requestChatDeletion(db: SqliteDatabase, reader: ChatRepositoryReader, scope: SyncScope, deviceId: string, input: ChatDeletionRequest, now: number) {
  if (db.prepare("SELECT 1 FROM chat_classification_candidates WHERE chat_id=? AND state IN ('pending','confirmed') LIMIT 1").get(input.chatId)) throw new Error("CHAT_DELETION_NOT_READY");
  const view = readChatDeletion(db, scope, input.chatId), facts = readChatFacts(db, scope, input.chatId), head = view.head;
  if (!head || head.chat.incarnationId !== input.incarnationId || head.chat.cloudRevision !== input.expectedRevision || view.reviewHash !== input.expectedReviewHash) throw new Error("CHAT_DELETION_REVIEW_CHANGED");
  if (view.pending || view.result && view.result.status !== "conflicted" || facts.status !== "idle") throw new Error("CHAT_DELETION_NOT_READY");
  const row = db.prepare("SELECT cloud_state,core_revision FROM chats WHERE id=? AND cloud_environment=? AND cloud_user_id=?")
    .get(input.chatId, scope.environment, scope.userId) as Row | undefined;
  if (!row || row.cloud_state === "local-only") throw new Error("CHAT_DELETION_IDENTITY_CHANGED");
  if (row.cloud_state !== "mirror") archiveDeletion(db, reader, input.chatId, input.incarnationId, deviceId, input.operationId, now);
  const payload = { chatId: input.chatId, incarnationId: input.incarnationId, classification: head.chat.classification, expectedRevision: input.expectedRevision };
  enqueueSource(db, { id: input.operationId, scope, chatId: input.chatId, entityKind: "tombstone", kind: "delete-chat", revision: Number(row.core_revision),
    payload, now });
  writeAttempt(db, scope, input.chatId, { outboxId: input.operationId, head, operation: chatDeletionOperation(input.operationId, input.chatId, payload), result: null }, now);
  return readChatDeletion(db, scope, input.chatId);
}
export function keepChatDeletion(db: SqliteDatabase, scope: SyncScope, input: ChatDeletionKeep) {
  const view = readChatDeletion(db, scope, input.chatId);
  if (view.pending || view.result?.status !== "conflicted" || view.reviewHash !== input.expectedReviewHash) throw new Error("CHAT_DELETION_REVIEW_CHANGED");
  releaseRoot(db, rootId(scope, input.chatId)); return readChatDeletion(db, scope, input.chatId);
}
export function recordDeletionResult(db: SqliteDatabase, scope: SyncScope, item: Row, result: DeletionResult, now: number) {
  const manifest = JSON.parse(String(item.payload_json)), chatId = String(manifest.chatId);
  const operation = chatDeletionOperation(String(item.id), chatId, readRetainedSource(db, manifest.sources[0]));
  const prior = readAttempt(db, scope, chatId);
  if (prior && prior.operation.operationId !== operation.operationId) throw new Error("CHAT_DELETION_ATTEMPT_CHANGED");
  writeAttempt(db, scope, chatId, { outboxId: String(item.id), operation, head: prior?.head ?? null, result }, now);
}
