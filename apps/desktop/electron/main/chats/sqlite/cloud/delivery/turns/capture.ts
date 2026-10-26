/**
 * [INPUT]: Depends on scoped original outbox sources, canonical local messages, exact completed-result identity and immutable turn admissions.
 * [OUTPUT]: Transfers a frozen user/notice prefix into the sole durable outbox; recovery from a completed result revalidates each missing prefix against canonical local custody.
 * [POS]: Worker transaction leaf; a later confirmed head cannot rewrite the captured admission identity.
 */
import { canonicalJson, type SyncScope } from "../../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../../connection";
import { enqueueSource } from "../../retention";
import { requireOutbox } from "../checkpoints";
import { readRetainedSource } from "../../inventory/source";
import { localTurnAdmissionSchema, type LocalTurnAdmission } from "./model";
import { retainedSourceRefSchema } from "../contracts";
import { messageSchema } from "../../../../schema/chat-schema";
import type { Row } from "../../../repository/codec";
export function captureTurn(db: SqliteDatabase, scope: SyncScope, deviceId: string, operationId: string,
  sourceId: string, payloadDigest: string, raw: LocalTurnAdmission, now: number) {
  const admission = localTurnAdmissionSchema.parse(raw), item = requireOutbox(db, scope, sourceId, payloadDigest);
  const manifest = JSON.parse(String(item.payload_json));
  if (manifest.chatId !== admission.chat.id || deviceId !== admission.ownerDeviceId) throw new Error("TURN_SOURCE_IDENTITY_CONFLICT");
  const source = readRetainedSource(db, retainedSourceRefSchema.parse(manifest.sources[0])) as {
    chat: unknown; message?: unknown; messages?: unknown[]; notices?: unknown[];
  };
  if (canonicalJson(source.chat) !== canonicalJson(admission.chat)) throw new Error("TURN_SOURCE_FACTS_CONFLICT");
  const messages = [source.message, ...(source.messages ?? []), ...(source.notices ?? [])].filter(Boolean);
  const result = messages.map(raw => messageSchema.parse(raw)).find(message => message.role === "assistant" &&
    message.id === admission.assistantMessageId && message.seq === admission.sequences.assistantSeq &&
    message.turnId === admission.turnId && message.backend === admission.options.backend && message.completion && message.resultHash);
  for (const message of [admission.user, ...admission.notices]) {
    if (messages.some(candidate => canonicalJson(candidate) === canonicalJson(message))) continue;
    // A completed initialization may have retired the original user row before admission was captured. Only this
    // exact original result can anchor recovery; current canonical prefix bytes must still match the frozen ledger.
    const chat = result ? db.prepare("SELECT incarnation_id,cloud_environment,cloud_user_id,cloud_owner_device_id FROM chats WHERE id=?")
      .get(admission.chat.id) as Row | undefined : null;
    const original = chat ? db.prepare("SELECT payload_json FROM chat_messages WHERE chat_id=? AND message_id=? AND seq=?")
      .get(admission.chat.id, message.id, message.seq) as Row | undefined : null;
    if (!chat || chat.incarnation_id !== admission.chat.incarnationId || chat.cloud_environment !== scope.environment ||
      chat.cloud_user_id !== scope.userId || chat.cloud_owner_device_id !== deviceId || !original ||
      canonicalJson(messageSchema.parse(JSON.parse(String(original.payload_json)))) !== canonicalJson(message)) throw new Error("TURN_SOURCE_MESSAGE_CONFLICT");
  }
  return enqueueSource(db, { id: operationId, scope, chatId: admission.chat.id, entityKind: "turn", entityId: admission.turnId,
    kind: "live-turn", revision: admission.sequences.userSeq, payload: admission, now });
}
