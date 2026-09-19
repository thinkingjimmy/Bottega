/**
 * [INPUT]: Depends on the original SQLite fact reader, confirmed execution fence and durable metadata/options outbox.
 * [OUTPUT]: Returns exact admission facts and atomically retains original initialization ciphertext across later executor custody.
 * [POS]: Original SQLite execution owner; read admission is separate from the narrow initialization compare-and-swap.
 */
import { z } from "zod";
import { canonicalJson } from "@ai-chat/cloud-protocol";
import { frozenRemoteChatInitializationSchema, validateChatPacket } from "@ai-chat/cloud-protocol/chats/encrypted";
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import { chatFactsSchema } from "../../../chat-schema";
import type { SqliteDatabase } from "../../connection";
import type { ChatRepositoryReader } from "../../repository/reader";
import { assertLocalExecutor, localExecutionStateSchema } from "./state";
export const remoteAdmissionStateSchema = z.object({ execution: localExecutionStateSchema, facts: chatFactsSchema, pending: z.boolean() }).strict().nullable();
export function remoteAdmissionState(db: SqliteDatabase, reader: ChatRepositoryReader, scope: SyncScope, deviceId: string, chatId: string) {
  const metadata = reader.listMetadata(deviceId, chatId)[0]; if (!metadata) return null;
  const execution = assertLocalExecutor(db, chatId, deviceId);
  const { preview: _preview, ...facts } = metadata;
  const pending = Boolean(db.prepare(`SELECT 1 FROM cloud_outbox WHERE environment=? AND user_id=?
    AND json_extract(payload_json,'$.chatId')=? AND (metadata_status IN ('queued','blocked','conflicted')
      OR json_extract(payload_json,'$.optionsOperation') IS NOT NULL) LIMIT 1`).get(scope.environment, scope.userId, chatId));
  return remoteAdmissionStateSchema.parse({ execution, facts, pending });
}

export function remoteInitialization(db: SqliteDatabase, scope: SyncScope, deviceId: string, chatId: string,
  input?: z.infer<typeof frozenRemoteChatInitializationSchema>) {
  const row = db.prepare("SELECT confirmed_json,remote_initial_json,deleted FROM cloud_chat_metadata_state WHERE chat_id=? AND environment=? AND user_id=?")
    .get(chatId, scope.environment, scope.userId) as { confirmed_json: string | null; remote_initial_json: string | null; deleted: number } | undefined;
  if (!row || !row.confirmed_json || row.deleted || db.prepare("SELECT 1 FROM cloud_tombstones WHERE chat_id=? LIMIT 1").get(chatId)) throw new Error("EXECUTION_IDENTITY_CHANGED");
  const head = cloudChatHeadSchema.parse(JSON.parse(row.confirmed_json));
  if (head.executorDeviceId !== deviceId || head.archivedAt !== null || head.chat.classification.conversationKind !== "ordinary") throw new Error("EXECUTION_IDENTITY_CHANGED");
  const old = row.remote_initial_json ? frozenRemoteChatInitializationSchema.parse(JSON.parse(row.remote_initial_json)) : null;
  if (!input) return old;
  const value = frozenRemoteChatInitializationSchema.parse(input);
  if (value.chatId !== chatId || value.incarnationId !== head.chat.incarnationId || value.executionEpoch !== head.executionEpoch || head.executionPreparation?.state === "ready") throw new Error("EXECUTION_IDENTITY_CHANGED");
  for (const packet of [value.facts, value.options]) validateChatPacket(value.encryptedSpace.scope, chatId, packet);
  if (old) {
    if (canonicalJson(old) === canonicalJson(value)) return old;
    const { executionEpoch: oldEpoch, ...original } = old, { executionEpoch, ...rebound } = value;
    if (executionEpoch <= oldEpoch || canonicalJson(original) !== canonicalJson(rebound)) throw new Error("REMOTE_INITIAL_IDENTITY_CONFLICT");
    const updated = db.prepare("UPDATE cloud_chat_metadata_state SET remote_initial_json=? WHERE chat_id=? AND environment=? AND user_id=? AND remote_initial_json=?")
      .run(canonicalJson(value), chatId, scope.environment, scope.userId, row.remote_initial_json);
    if (Number(updated.changes) !== 1) throw new Error("REMOTE_INITIAL_IDENTITY_CONFLICT");
    return value;
  }
  const json = canonicalJson(value); if (Buffer.byteLength(json, "utf8") > 131_072) throw new Error("REMOTE_INITIAL_LIMIT");
  db.prepare("UPDATE cloud_chat_metadata_state SET remote_initial_json=? WHERE chat_id=? AND environment=? AND user_id=? AND remote_initial_json IS NULL")
    .run(json, chatId, scope.environment, scope.userId); return value;
}
