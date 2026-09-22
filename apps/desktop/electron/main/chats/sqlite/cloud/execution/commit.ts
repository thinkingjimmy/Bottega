/**
 * [INPUT]: Depends on confirmed execution state and frozen admission identity.
 * [OUTPUT]: Fences incomplete Home capture and unowned Chats inside the user transaction.
 * [POS]: Shared ownership fence for ordinary and Agent-switch user commits; late replies retain their original custody.
 */
import { z } from "zod";
import { canonicalJson } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import { assertLocalOwner } from "./state";
import { assertHomeCaptured } from "../home/jobs";

export type ExecutionReservation = { deviceId: string; };
export type OwnerCommit = ExecutionReservation;
const reservationSchema = z.object({ deviceId: z.string().min(1) });
export function commitAsOwner(database: SqliteDatabase, chatId: string, deviceId: string, input?: OwnerCommit) {
  const frozen = input && reservationSchema.parse(input);
  assertHomeCaptured(database, chatId);
  const state = assertLocalOwner(database, chatId, deviceId);
  if (!state) { if (input) throw new Error("CLOUD_NOT_OWNER"); return; }
  if (frozen && frozen.deviceId !== deviceId) throw new Error("CLOUD_NOT_OWNER");
}

export function guardRecordUsers(database: SqliteDatabase, reader: import("../../repository/reader").ChatRepositoryReader,
  deviceId: string, record: import("../../../../../../shared/chats-ipc").ChatRecord, input?: OwnerCommit) {
  const previous = reader.getRecord(record.id, deviceId);
  const users = new Map(previous?.messages.filter(message => message.role === "user").map(message => [message.id, canonicalJson(message)]));
  const changed = record.messages.filter(message => message.role === "user" && users.get(message.id) !== canonicalJson(message));
  if (changed.length) commitAsOwner(database, record.id, deviceId, input);
  else if (input) assertLocalOwner(database, record.id, deviceId);
}
