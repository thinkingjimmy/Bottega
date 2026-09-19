/**
 * [INPUT]: Depends on ordered confirmed body references and the native message/Subagent budgets.
 * [OUTPUT]: Builds a bounded execution window, exact excluded watermark and true first canonical user facts.
 * [POS]: Mirror-to-native projection; pruning never removes retained cloud bodies or their private file references.
 */
import type { ChatMessage, ChatRecord, PersistedSubagent } from "../../../../../../shared/chats-ipc";
import { prunePersistedSubagents } from "../../../../../../shared/subagent-registry";
import { CHAT_BYTE_LIMIT, CHAT_MESSAGE_LIMIT, messageBytes } from "../../../chat-schema";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import { mirrorReferences, readMirrorBody } from "./references";
export function mirrorExecutionWindow(db: SqliteDatabase, scope: SyncScope, chatId: string) {
  const messages: ChatMessage[] = [];
  let subagents: Record<string, PersistedSubagent> = {}, bytes = 0, trimmedThroughSeq = 0, beforeSeq: number | null = null;
  outer: for (;;) {
    const references = mirrorReferences(db, scope, chatId, beforeSeq, 50);
    for (const reference of references) {
      const body = readMirrorBody(db, reference), size = messageBytes(body.message);
      if (messages.length === CHAT_MESSAGE_LIMIT || bytes + size > CHAT_BYTE_LIMIT) {
        trimmedThroughSeq = reference.seq; break outer;
      }
      messages.push(body.message); bytes += size;
      subagents = prunePersistedSubagents({ ...body.subagents, ...subagents }).subagents;
    }
    if (references.length < 50) break;
    beforeSeq = references.at(-1)!.seq;
  }
  return { messages: messages.reverse(), subagents, trimmedThroughSeq };
}
export function mirrorStartState(db: SqliteDatabase, scope: SyncScope, chatId: string): ChatRecord["startState"] {
  let afterSeq: number | null = null;
  for (;;) {
    const references = mirrorReferences(db, scope, chatId, afterSeq, 50, "after");
    for (const reference of references) {
      const { message } = readMirrorBody(db, reference);
      if (message.role === "user") return { kind: "started-exact", firstUserMessageAt: message.createdAt, firstUserMessageSeq: message.seq };
    }
    if (references.length < 50) return { kind: "unstarted" };
    afterSeq = references.at(-1)!.seq;
  }
}
