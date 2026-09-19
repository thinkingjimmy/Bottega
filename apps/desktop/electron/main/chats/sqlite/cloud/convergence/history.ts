/**
 * [INPUT]: Depends on authenticated mirror pages, the sole native writer and immutable subagent retention.
 * [OUTPUT]: Installs complete canonical history while preserving bounded execution context.
 * [POS]: Shared content publication for reconciliation and execution handoff transactions.
 */
import type { ChatRecord } from "../../../../../../shared/chats-ipc";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { ChatRecordWriter } from "../../repository/writer";
import { mirrorReferences, readMirrorBody } from "../mirror/references";
import { saveLibrarySubagent } from "../../../../library/mirrors/native-source";

export function writeCanonicalHistory(db: SqliteDatabase, writer: ChatRecordWriter, scope: SyncScope, window: ChatRecord, now: number) {
  const messages: ChatRecord["messages"] = [], subagents: NonNullable<ChatRecord["subagents"]> = {};
  let afterSeq = 0;
  for (;;) {
    const references = mirrorReferences(db, scope, window.id, afterSeq, 50, "after");
    for (const ref of references) {
      const body = readMirrorBody(db, ref);
      messages.push(body.message); Object.assign(subagents, body.subagents);
    }
    if (references.length < 50) break;
    afterSeq = references.at(-1)!.seq;
  }
  const complete = { ...window, messages };
  writer.writeMessages(complete, false); writer.writeSubagents(window);
  for (const [id, value] of Object.entries(subagents)) if (!window.subagents?.[id]) saveLibrarySubagent(db, window.id, id, value, now);
  writer.writeBranches(window); writer.writeSearchDocuments(complete);
}
