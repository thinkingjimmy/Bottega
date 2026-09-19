/**
 * [INPUT]: Depends on the existing confirmed Chat head and native committed-device columns.
 * [OUTPUT]: Provides local execution snapshots and pending classification, classification drift and pending/permanent deletion fences for new user admission.
 * [POS]: SQLite execution fence; it never acquires an online lease or rejects late assistant evidence.
 */
import { z } from "zod";
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import { canonicalJson } from "@ai-chat/cloud-protocol";
import type { SqliteDatabase } from "../../connection";
import type { Row } from "../../repository/codec";
export const localExecutionStateSchema = z.object({ deviceId: z.string(), head: cloudChatHeadSchema,
  residence: z.enum(["native", "mirror"]),
  lastCommittedDeviceId: z.string().nullable(), deleted: z.boolean() }).strict().nullable();
export function localExecutionState(db: SqliteDatabase, chatId: string, deviceId: string) {
  const row = db.prepare(`SELECT c.cloud_state,c.cloud_last_committed_executor_device_id,m.confirmed_json,m.deleted
    FROM chats c LEFT JOIN cloud_chat_metadata_state m ON m.chat_id=c.id WHERE c.id=?`).get(chatId) as Row | undefined;
  if (!row || row.cloud_state === "local-only" || !row.confirmed_json) return null;
  const head = cloudChatHeadSchema.parse(JSON.parse(String(row.confirmed_json)));
  return localExecutionStateSchema.parse({ deviceId, head, residence: row.cloud_state === "mirror" ? "mirror" : "native", deleted: Boolean(row.deleted),
    lastCommittedDeviceId: row.cloud_last_committed_executor_device_id ?? head.lastCommittedExecutorDeviceId });
}
export function assertLocalExecutor(db: SqliteDatabase, chatId: string, deviceId: string, expectedEpoch?: number) {
  if (db.prepare("SELECT 1 FROM chat_classification_candidates WHERE chat_id=? AND state IN ('pending','confirmed') LIMIT 1").get(chatId)) throw new Error("CHAT_CLASSIFICATION_PENDING");
  if (db.prepare("SELECT 1 FROM cloud_tombstones WHERE chat_id=? LIMIT 1").get(chatId)) throw new Error("CHAT_DELETED");
  if (db.prepare("SELECT 1 FROM cloud_outbox WHERE entity_id=? AND kind='delete-chat' LIMIT 1").get(chatId)) throw new Error("CHAT_DELETION_PENDING");
  const state = localExecutionState(db, chatId, deviceId); if (!state) return null;
  const { head } = state;
  const classification = db.prepare("SELECT conversation_kind,portable_app_id,portable_project_id FROM chats WHERE id=?").get(chatId) as Row;
  if (canonicalJson({ conversationKind: classification.conversation_kind, appId: classification.portable_app_id, projectId: classification.portable_project_id }) !==
      canonicalJson(head.chat.classification)) throw new Error("CHAT_CLASSIFICATION_REVIEW_REQUIRED");
  if (head.executorDeviceId !== deviceId || expectedEpoch !== undefined && head.executionEpoch !== expectedEpoch) throw new Error("CLOUD_EXECUTOR_CHANGED");
  if (head.archivedAt !== null) throw new Error("ARCHIVED");
  if (head.executionPreparation && (head.executionPreparation.deviceId !== deviceId || head.executionPreparation.executionEpoch !== head.executionEpoch || head.executionPreparation.state !== "ready")) {
    throw new Error("CLOUD_EXECUTOR_NOT_READY");
  }
  return state;
}
