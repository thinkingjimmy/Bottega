/**
 * [INPUT]: Depends on confirmed Chat identity and the existing scoped retained-source checkpoint owner.
 * [OUTPUT]: Reads and advances constant-size imported generation checkpoints without creating local source authority.
 * [POS]: Worker-only imported download state; generation content remains in the original history tables.
 */
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { Row } from "../../repository/codec";
import { readRetainedSource } from "../inventory/source";
import { releaseRoot, retainSource } from "../retention";
import { readMetadataState } from "../delivery/metadata-confirm";
import { importDownloadSchema, type ImportDownload } from "./contracts";
export const importRoot = (scope: SyncScope, chatId: string) => `mirror:${hashChatContent([scope, chatId])}:import-download`;
export const localImportId = (scope: SyncScope, chatId: string, generationId: string) => hashChatContent(["cloud-import", scope, chatId, generationId]);
export const localEntryId = (scope: SyncScope, chatId: string, entryVersionId: string, seq: number) => hashChatContent(["cloud-import-entry", scope, chatId, entryVersionId, seq]);
export function requireImportChat(db: SqliteDatabase, scope: SyncScope, chatId: string) {
  const row = db.prepare("SELECT * FROM chats WHERE id=? AND cloud_environment=? AND cloud_user_id=? AND cloud_state IN ('mirror','synced')")
    .get(chatId, scope.environment, scope.userId) as Row | undefined;
  if (!row) throw new Error("IMPORT_IDENTITY_CHANGED");
  const head = readMetadataState(db, scope, chatId).head as CloudChatHead | null;
  if (!head || head.kind === "native" || head.chat.incarnationId !== row.incarnation_id) throw new Error("IMPORT_IDENTITY_CHANGED");
  return { head, row };
}
export function readImportDownload(db: SqliteDatabase, scope: SyncScope, chatId: string): ImportDownload | null {
  const rows = db.prepare(`SELECT s.source_id,s.digest FROM chat_retention_roots r JOIN chat_retained_sources s ON s.source_id=r.source_id
    WHERE r.root_id=? AND s.environment=? AND s.user_id=? AND s.kind='import-download'`).all(importRoot(scope, chatId), scope.environment, scope.userId) as Row[];
  if (rows.length > 1) throw new Error("IMPORT_DOWNLOAD_CONFLICT");
  return rows[0] ? importDownloadSchema.parse(readRetainedSource(db, { sourceId: String(rows[0].source_id), digest: String(rows[0].digest) })) : null;
}
export function saveImportDownload(db: SqliteDatabase, scope: SyncScope, chatId: string, value: ImportDownload, now: number) {
  const payload = importDownloadSchema.parse(value), rootId = importRoot(scope, chatId);
  releaseRoot(db, rootId); retainSource(db, { chatId, scope, kind: "import-download", revision: value.status.revision, payload, rootId, now });
  return payload;
}
export function requireImportDownload(db: SqliteDatabase, scope: SyncScope, chatId: string, generationId: string) {
  const { head } = requireImportChat(db, scope, chatId), state = readImportDownload(db, scope, chatId);
  if (!state || state.status.manifest.generationId !== generationId || state.status.manifest.incarnationId !== head.chat.incarnationId) throw new Error("IMPORT_GENERATION_CHANGED");
  return state;
}
