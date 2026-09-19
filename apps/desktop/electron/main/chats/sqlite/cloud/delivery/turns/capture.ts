/**
 * [INPUT]: Depends on scoped original outbox sources, canonical hashes and immutable turn admissions.
 * [OUTPUT]: Transfers a frozen original user/notice prefix into the sole durable Chat outbox.
 * [POS]: Worker transaction leaf; later executor changes cannot rewrite the captured execution epoch.
 */
import { canonicalJson, type SyncScope } from "../../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../../connection";
import { enqueueSource } from "../../retention";
import { requireOutbox } from "../checkpoints";
import { readRetainedSource } from "../../inventory/source";
import { localTurnAdmissionSchema, type LocalTurnAdmission } from "./model";
import { retainedSourceRefSchema } from "../contracts";
export function captureTurn(db: SqliteDatabase, scope: SyncScope, deviceId: string, operationId: string,
  sourceId: string, payloadDigest: string, raw: LocalTurnAdmission, now: number) {
  const admission = localTurnAdmissionSchema.parse(raw), item = requireOutbox(db, scope, sourceId, payloadDigest);
  const manifest = JSON.parse(String(item.payload_json));
  if (manifest.chatId !== admission.chat.id || deviceId !== admission.executorDeviceId ||
    admission.executionEpoch !== (item.execution_epoch ?? 1)) throw new Error("TURN_SOURCE_IDENTITY_CONFLICT");
  const source = readRetainedSource(db, retainedSourceRefSchema.parse(manifest.sources[0])) as {
    chat: unknown; message?: unknown; messages?: unknown[]; notices?: unknown[];
  };
  if (canonicalJson(source.chat) !== canonicalJson(admission.chat)) throw new Error("TURN_SOURCE_FACTS_CONFLICT");
  const messages = [source.message, ...(source.messages ?? []), ...(source.notices ?? [])].filter(Boolean);
  for (const message of [admission.user, ...admission.notices]) {
    if (!messages.some(candidate => canonicalJson(candidate) === canonicalJson(message))) throw new Error("TURN_SOURCE_MESSAGE_CONFLICT");
  }
  return enqueueSource(db, { id: operationId, scope, chatId: admission.chat.id, entityKind: "turn", entityId: admission.turnId,
    kind: "live-turn", revision: admission.sequences.userSeq, executionEpoch: admission.executionEpoch, payload: admission, now });
}
