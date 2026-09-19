/**
 * [INPUT]: Depends on native records, immutable outbox sources and authenticated mirror bodies.
 * [OUTPUT]: Finds the first divergent complete user turn from one paged body scan, without mistaking a matching old prefix for a conflict, and refuses divergence that no Fork could hold.
 * [POS]: Shared canonical comparison beneath convergence and explicit execution preparation.
 */
import { projectPortableMessage } from "@ai-chat/cloud-protocol/chats/content/projection";
import type { ChatBody } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { canonicalJson, type SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { ChatRecord } from "../../../../../../shared/chats-ipc";
import type { SqliteDatabase } from "../../connection";
import { mirrorReferences, readMirrorBody } from "../mirror/references";
const PAGE = 100;
/* One ordered scan up to the local tail instead of a reference query plus a body parse per local
   message: the same bodies, read once. Canonical messages beyond the local tail cannot change the
   comparison, so paging stops there. */
function canonicalBodies(db: SqliteDatabase, scope: SyncScope, record: ChatRecord) {
  const bodies = new Map<number, ChatBody>(), last = record.messages.at(-1)?.seq ?? 0;
  for (let afterSeq = Math.max(0, (record.messages[0]?.seq ?? 1) - 1); last > afterSeq; ) {
    const page = mirrorReferences(db, scope, record.id, afterSeq, PAGE, "after");
    for (const reference of page) { if (reference.seq > last) return bodies; bodies.set(reference.seq, readMirrorBody(db, reference)); }
    if (page.length < PAGE) return bodies;
    afterSeq = page.at(-1)!.seq;
  }
  return bodies;
}
export function divergentUserTurn(db: SqliteDatabase, scope: SyncScope, record: ChatRecord) {
  const canonicalAgents = new Map<string, unknown>(), bodies = canonicalBodies(db, scope, record);
  let first = Infinity;
  for (const message of record.messages) {
    const body = bodies.get(message.seq);
    if (!body) { first = Math.min(first, message.seq); continue; }
    for (const [key, value] of Object.entries(body.subagents ?? {})) canonicalAgents.set(key, value);
    if (canonicalJson(projectPortableMessage(message)) !== canonicalJson(body.message)) first = Math.min(first, message.seq);
  }
  for (const [key, value] of Object.entries(record.subagents ?? {})) {
    const portable = { ...value, parts: value.parts.map(part => { const { mediaSource: _local, ...rest } = part as unknown as Record<string, unknown>; return rest; }) };
    if (canonicalJson(portable) !== canonicalJson(canonicalAgents.get(key) ?? null)) {
      const parent = record.messages.find(message => message.role === "assistant" && message.parts?.some(part => "agentThreadId" in part && part.agentThreadId === key));
      first = Math.min(first, parent?.seq ?? record.messages.at(-1)?.seq ?? Infinity);
    }
  }
  if (first === Infinity) return null;
  const start = record.messages.filter(message => message.role === "user" && message.seq <= first).at(-1)?.seq
    ?? record.messages.find(message => message.role === "user")?.seq;
  /* A divergent record without any user message cannot be saved as a Fork (save.ts rejects it), so
     returning "not divergent" would replace the local tail with no custody at all. Fail and retry. */
  if (start === undefined) throw new Error("CHAT_CONVERGENCE_USER_TURN_REQUIRED");
  return start;
}
