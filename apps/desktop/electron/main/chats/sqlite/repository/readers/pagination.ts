/**
 * [INPUT]: SQLite chat rows and transcript page byte limits.
 * [OUTPUT]: TIMELINE_PAGE_BYTE_LIMIT, messageBytes, sortKeyOf, incompleteTailOf, readonlyStartState, boundedNewest, boundedAround.
 * [POS]: Pure timeline page budgets and row metadata projections; SQLite access remains in reader.ts.
 */
import type { ChatMessage, ChatRecord } from "../../../../../../shared/ipc/content/chats-ipc";
import { type Row } from "../codec";

export const TIMELINE_PAGE_BYTE_LIMIT = 512 * 1024;

export const messageBytes = (message: ChatMessage) =>
  Buffer.byteLength(JSON.stringify(message), "utf8");

export const sortKeyOf = (value: unknown) =>
  value === null || value === undefined ? {} : { sortKey: Number(value) };

export const incompleteTailOf = (row: Row) =>
  row.active_generation_incomplete_tail === "true";

export function readonlyStartState(row: Row): ChatRecord["startState"] {
  if (row.first_imported_seq === null || row.first_imported_seq === undefined) {
    return { kind: "unstarted" };
  }
  return {
    kind: "started-exact",
    firstUserMessageAt: Number(row.first_imported_created_at ?? row.created_at),
    firstUserMessageSeq: Number(row.first_imported_seq),
  };
}

export function boundedNewest(
  rows: Row[],
  limit: number,
  project: (row: Row) => ChatMessage
) {
  const messages: ChatMessage[] = [];
  let bytes = 0;
  for (const row of rows.slice(0, limit)) {
    const message = project(row);
    const next = messageBytes(message);
    if (messages.length && bytes + next > TIMELINE_PAGE_BYTE_LIMIT) break;
    messages.push(message);
    bytes += next;
  }
  return messages;
}

export function boundedAround(messages: ChatMessage[], targetSeq: number) {
  const bounded = [...messages];
  let bytes = bounded.reduce((total, message) => total + messageBytes(message), 0);
  while (bounded.length > 1 && bytes > TIMELINE_PAGE_BYTE_LIMIT) {
    const target = bounded.findIndex((message) => message.seq === targetSeq);
    const removeFromStart = target > bounded.length - target - 1;
    const [removed] = removeFromStart ? bounded.splice(0, 1) : bounded.splice(-1, 1);
    bytes -= messageBytes(removed!);
  }
  return bounded;
}
