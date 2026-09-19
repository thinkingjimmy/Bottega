/**
 * [INPUT]: Depends on verified portable body references and the existing scoped retained-source owner.
 * [OUTPUT]: Stores and reads logical attachment/media descriptors alongside canonical mirrored messages.
 * [POS]: Local read-side file index; physical URLs, credentials and filesystem grants are never stored here.
 */
import type { z } from "zod";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { Row } from "../../repository/codec";
import { releaseRoot, retainSource } from "../retention";
import { readRetainedSource } from "../inventory/source";
import { mirrorFilesSchema } from "./contracts";
const root = (chatId: string, messageId: string) => `mirror:${chatId}:files:${messageId}`;
export function writeMirrorFiles(db: SqliteDatabase, scope: SyncScope, chatId: string, messageId: string, files: z.infer<typeof mirrorFilesSchema>, now: number) {
  const value = mirrorFilesSchema.parse(files), rootId = root(chatId, messageId);
  releaseRoot(db, rootId);
  if (value.attachments.length || value.media.length) retainSource(db, { scope, chatId, rootId, kind: "mirror-files", revision: 0, payload: value, now });
}
export function readMirrorFiles(db: SqliteDatabase, scope: SyncScope, chatId: string, messageId: string) {
  const row = db.prepare(`SELECT s.source_id,s.digest FROM chat_retained_sources s JOIN chat_retention_roots r ON r.source_id=s.source_id
    WHERE s.environment=? AND s.user_id=? AND s.chat_id=? AND r.root_id=? AND s.kind='mirror-files'`)
    .get(scope.environment, scope.userId, chatId, root(chatId, messageId)) as Row | undefined;
  return row ? mirrorFilesSchema.parse(readRetainedSource(db, { sourceId: String(row.source_id), digest: String(row.digest) })) : { attachments: [], media: [] };
}
