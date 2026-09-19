/**
 * [INPUT]: Depends on confirmed execution state, frozen admission identity and canonical notice validation.
 * [OUTPUT]: Fences incomplete Home capture and commits validated device transitions inside the user transaction.
 * [POS]: Shared executor fence for ordinary and Agent-switch user commits; late replies retain their original custody.
 */
import { z } from "zod";
import { canonicalJson } from "../../../../../../shared/local-storage/contracts";
import type { NoticeChatMessage } from "../../../../../../shared/chats-ipc";
import { messageSchema } from "../../../chat-schema";
import type { SqliteDatabase } from "../../connection";
import { assertLocalExecutor } from "./state";
import { assertHomeCaptured } from "../home/jobs";

export type ExecutionReservation = { deviceId: string; executionEpoch: number; lastCommittedDeviceId: string | null; staleSnapshot?: boolean };
export type ExecutorCommit = ExecutionReservation & { notice?: NoticeChatMessage };
const reservationSchema = z.object({ deviceId: z.string().min(1), executionEpoch: z.number().int().positive(),
  lastCommittedDeviceId: z.string().min(1).nullable(), staleSnapshot: z.boolean().optional() });
export function commitExecutor(database: SqliteDatabase, chatId: string, deviceId: string,
  userSeq: number, input?: ExecutorCommit) {
  const frozen = input && reservationSchema.parse(input);
  assertHomeCaptured(database, chatId);
  const state = assertLocalExecutor(database, chatId, deviceId, frozen?.executionEpoch);
  if (!state) { if (input) throw new Error("CLOUD_EXECUTOR_CHANGED"); return; }
  if (frozen && (frozen.deviceId !== deviceId || frozen.lastCommittedDeviceId !== state.lastCommittedDeviceId)) {
    throw new Error("CLOUD_EXECUTOR_CHANGED");
  }
  const changed = state.lastCommittedDeviceId !== null && state.lastCommittedDeviceId !== deviceId;
  if (changed !== Boolean(input?.notice)) throw new Error("CLOUD_EXECUTOR_NOTICE_REQUIRED");
  if (input?.notice) {
    const message = messageSchema.parse(input.notice);
    if (message.role !== "notice" || message.notice.kind !== "executor-switched" ||
      message.notice.executionEpoch !== state.head.executionEpoch || message.notice.toDeviceId !== deviceId ||
      message.notice.fromDeviceId !== state.lastCommittedDeviceId || Boolean(message.notice.staleSnapshot) !== Boolean(state.head.lastExecutorTransition?.executionEpoch === state.head.executionEpoch && state.head.lastExecutorTransition.staleSnapshot) || message.seq >= userSeq || userSeq - message.seq > 2) {
      throw new Error("CLOUD_EXECUTOR_NOTICE_CONFLICT");
    }
  }
  database.prepare("UPDATE chats SET cloud_last_committed_executor_device_id=? WHERE id=?").run(deviceId, chatId);
}

export function guardRecordUsers(database: SqliteDatabase, reader: import("../../repository/reader").ChatRepositoryReader,
  deviceId: string, record: import("../../../../../../shared/chats-ipc").ChatRecord, input?: ExecutorCommit) {
  const previous = reader.getRecord(record.id, deviceId);
  const users = new Map(previous?.messages.filter(message => message.role === "user").map(message => [message.id, canonicalJson(message)]));
  const changed = record.messages.filter(message => message.role === "user" && users.get(message.id) !== canonicalJson(message));
  if (changed.length) commitExecutor(database, record.id, deviceId, changed[0]!.seq, input);
  else if (input) assertLocalExecutor(database, record.id, deviceId, input.executionEpoch);
}
