/**
 * [INPUT]: Depends on the shared chatSyncExclusion predicate and the worker's SQLite connection.
 * [OUTPUT]: Provides enrollChat: the only step that turns a local Chat into a synced one, refusing a Chat chatSyncExclusion names (a
 *           stable fact, not a failure: logged once per Chat, never retried).
 * [POS]: The single enrollment boundary of cloud sync (TASK-11 S3-b): the business-commit enrollment and the initial snapshot both go
 *        through it, so a package Provider's Chat stays local-only with no throw, no retry and no sync error, and never reaches remote.
 */
import { chatSyncExclusion } from "../../../../../../shared/chat-agent/options";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";

const reported = new Set<string>();

/** The one local→synced step; false when the Chat is excluded (it stays local-only, and the caller skips it). */
export function enrollChat(db: SqliteDatabase, scope: SyncScope, chat: Readonly<{ id: string; agent: string }>): boolean {
  const exclusion = chatSyncExclusion(chat);
  if (exclusion) {
    if (!reported.has(chat.id)) { reported.add(chat.id); console.info(`[chat-sync] ${chat.id} stays local-only: ${exclusion}`); }
    return false;
  }
  db.prepare("UPDATE chats SET cloud_state='synced',cloud_environment=?,cloud_user_id=?,cloud_revision=0 WHERE id=?")
    .run(scope.environment, scope.userId, chat.id);
  return true;
}
