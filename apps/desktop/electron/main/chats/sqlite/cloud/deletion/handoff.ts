/**
 * [INPUT]: Depends on original App deletion custody, scoped source roots and authenticated portable Chat heads.
 * [OUTPUT]: Retains explicit App transcript handoff evidence and admits a readonly mirror when its delayed creation receipt returns.
 * [POS]: SQLite App cleanup handoff; published reading content never recreates native App role, context or grants.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "@ai-chat/cloud-protocol";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { Row } from "../../repository/codec";
import { retainSource } from "../retention";
import { readRetainedSource } from "../inventory/source";
const handoffSchema = z.object({ appId: id, incarnationId: id, sourceIds: z.array(id).min(1) }).strict();
export function retainAppTranscript(db: SqliteDatabase, row: Row, deviceId: string, operationId: string, sourceIds: string[], now: number) {
  const scope = row.cloud_state === "local-only" ? undefined : { environment: String(row.cloud_environment), userId: String(row.cloud_user_id) };
  retainSource(db, { scope, deviceId, chatId: String(row.id), rootId: `app-transcript:${operationId}`, kind: "app-transcript-handoff", revision: Number(row.core_revision),
    payload: { appId: row.portable_app_id, incarnationId: row.incarnation_id, sourceIds }, now });
}
export function restoreRetainedAppMirror(db: SqliteDatabase, scope: SyncScope, head: CloudChatHead, restore: () => void) {
  if (db.prepare("SELECT 1 FROM chats WHERE id=?").get(head.chat.id)) return;
  if (head.chat.classification.conversationKind === "ordinary") throw new Error("CHAT_SOURCE_REMOVED");
  const source = db.prepare(`SELECT s.source_id,s.digest FROM chat_retained_sources s JOIN chat_retention_roots r ON r.source_id=s.source_id
    WHERE s.chat_id=? AND s.environment=? AND s.user_id=? AND s.kind='app-transcript-handoff'
      AND json_extract(s.payload_json,'$.incarnationId')=? LIMIT 1`).get(head.chat.id, scope.environment, scope.userId, head.chat.incarnationId) as Row | undefined;
  if (!source) throw new Error("APP_TRANSCRIPT_HANDOFF_REQUIRED");
  const handoff = handoffSchema.parse(readRetainedSource(db, { sourceId: String(source.source_id), digest: String(source.digest) }));
  if (handoff.appId !== head.chat.classification.appId || handoff.incarnationId !== head.chat.incarnationId) throw new Error("APP_TRANSCRIPT_HANDOFF_CHANGED");
  restore();
}
