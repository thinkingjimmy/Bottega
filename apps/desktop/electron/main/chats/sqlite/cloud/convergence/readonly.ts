/**
 * [INPUT]: Depends on complete authenticated import generations and original initialization custody.
 * [OUTPUT]: Adopts the canonical readonly generation without manufacturing native execution bindings.
 * [POS]: Readonly branch of canonical convergence; source CLI routes remain private and unavailable until refreshed.
 */
import type { z } from "zod";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { ChatRecordWriter } from "../../repository/writer";
import type { Row } from "../../repository/codec";
import { readMetadataState, acceptMetadataHead } from "../delivery/metadata-confirm";
import { requireOutbox } from "../delivery/checkpoints";
import { readImportDownload } from "../imported/state";
import { activateCloudImport } from "../imported/downloads";
import { readMirrorDownload } from "../mirror/downloads";
import { readChatOutbox, turnOutboxDigest } from "../settlement/outbox";
import { completeInitialEvidence } from "../initialization/complete";
import { releaseRoot } from "../retention";
import type { prepareConvergenceSchema, commitConvergenceSchema } from "./contracts";
export function convergeReadonly(db: SqliteDatabase, writer: ChatRecordWriter, scope: SyncScope, deviceId: string,
  action: z.infer<typeof prepareConvergenceSchema> | z.infer<typeof commitConvergenceSchema>, now: number) {
  const { head } = action, chatId = head.chat.id, current = readMetadataState(db, scope, chatId).head;
  const row = db.prepare("SELECT incarnation_id,native_message_revision FROM chats WHERE id=? AND cloud_environment=? AND cloud_user_id=?")
    .get(chatId, scope.environment, scope.userId) as Row | undefined;
  if (!row || row.incarnation_id !== head.chat.incarnationId || !current || current.bodyRevision !== head.bodyRevision ||
    current.chat.cloudRevision !== head.chat.cloudRevision || head.kind !== "external-readonly") throw new Error("CHAT_CONVERGENCE_IDENTITY_CHANGED");
  if (row.native_message_revision !== action.expectedMessageRevision || turnOutboxDigest(db, scope, chatId) !== action.expectedOutboxDigest) throw new Error("CHAT_CONVERGENCE_CONTENT_CHANGED");
  const imported = readImportDownload(db, scope, chatId), native = readMirrorDownload(db, scope, chatId);
  if (!imported?.complete || imported.bodyRevision !== head.bodyRevision || !native?.complete || native.bodyRevision !== head.bodyRevision) throw new Error("IMPORT_GENERATION_INCOMPLETE");
  if (action.type === "prepare-chat-convergence") return { chatId, archiveId: null, startSeq: null, committed: false };
  if (action.archiveId || action.childId) throw new Error("CHAT_CONVERGENCE_CHILD_UNEXPECTED");
  const initial = action.initial && requireOutbox(db, scope, action.initial.id, action.initial.payloadDigest);
  if (initial && (initial.kind !== "initialize" || JSON.parse(String(initial.payload_json)).chatId !== chatId)) throw new Error("INITIAL_OUTBOX_REQUIRED");
  activateCloudImport(db, scope, chatId, now);
  if (initial) {
    const source = JSON.parse(String(initial.payload_json)).sources[0];
    completeInitialEvidence(db, scope, chatId, source.sourceId, hashChatContent(["adopted-import", source.digest, imported.status]), now);
    for (const row of readChatOutbox(db, scope, chatId)) {
      if (row.kind === "delete-chat" || row.kind === "classification") continue;
      db.prepare("DELETE FROM cloud_outbox WHERE id=?").run(String(row.id)); releaseRoot(db, `outbox:${row.id}`);
    }
    db.prepare("UPDATE cloud_chat_metadata_state SET conflicted=0,deleted=0,tail_operation_id=NULL WHERE chat_id=?").run(chatId);
  }
  acceptMetadataHead(db, writer, scope, deviceId, head, now);
  return { chatId, archiveId: null, startSeq: null, committed: true };
}
