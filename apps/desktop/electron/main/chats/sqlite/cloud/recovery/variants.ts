/**
 * [INPUT]: Depends on frozen native branches/outbox sources, strict message codecs and existing retained-source roots.
 * [OUTPUT]: Retains original-head edited and unpublished snapshots as independently readable recovery archives.
 * [POS]: Execution-install transaction leaf; source outbox custody remains intact until canonical installation commits.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { ChatMessage, ChatRecord } from "../../../../../../shared/chats-ipc";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import { digest, json, type Row } from "../../repository/codec";
import { chatRecordSchema, messageSchema, subagentsSchema } from "../../../chat-schema";
import { readRetainedSource } from "../inventory/source";
import { retainSource } from "../retention";
import { executionArchiveSchema } from "../execution/contracts";
import { pinRecoveryHome } from "./home";
export function retainRecoveryVariants(db: SqliteDatabase, scope: SyncScope, head: CloudChatHead, record: ChatRecord, outbox: Row[], parentBranchId: string, now: number) {
  const baseAgents = record.subagents ?? {}, seen = new Set([digest(json({ messages: record.messages, subagents: baseAgents }))]);
  const baseline = new Map(record.messages.map(message => [message.id, digest(json(message))]));
  const retain = (origin: "edited" | "unsent", input: unknown[], agents: unknown) => {
    const messages = input.map(message => messageSchema.parse(message)).sort((a, b) => a.seq - b.seq), subagents = subagentsSchema.parse(agents);
    if (!messages.length) return;
    const fingerprint = digest(json({ messages, subagents })); if (seen.has(fingerprint)) return; seen.add(fingerprint);
    const branchId = digest(json([parentBranchId, origin, fingerprint])), rootId = `settlement:${record.id}:execution:${branchId}`;
    const body = retainSource(db, { scope, chatId: record.id, rootId, kind: "superseded-execution-content", revision: head.executionEpoch,
      payload: { head, classification: head.chat.classification, messages, subagents }, now });
    const descriptor = executionArchiveSchema.parse({ branchId, parentBranchId, origin, chatId: record.id, title: head.chat.title, incarnationId: record.incarnationId,
      executionEpoch: head.executionEpoch, bodyRevision: head.bodyRevision, canonicalHeadSeq: head.headSeq, createdAt: now, messageCount: messages.length, body });
    retainSource(db, { scope, chatId: record.id, rootId, kind: "superseded-execution-archive", revision: head.executionEpoch, payload: descriptor, now });
    pinRecoveryHome(db, scope, record.id, record.incarnationId, messages, rootId, now);
  };
  const branches = (input: unknown, agents: unknown) => {
    for (const branch of chatRecordSchema.shape.supersededBranches.parse(input ?? []) ?? []) retain("edited", branch.messages, agents);
  };
  branches(record.supersededBranches, baseAgents);
  for (const row of outbox) {
    const source = readRetainedSource(db, JSON.parse(String(row.payload_json)).sources[0]) as {
      message?: ChatMessage; messages?: ChatMessage[]; user?: ChatMessage; userMessage?: ChatMessage;
      resultMessage?: ChatMessage; notices?: ChatMessage[]; subagents?: ChatRecord["subagents"]; branches?: unknown;
    };
    const agents = { ...baseAgents, ...subagentsSchema.parse(source.subagents ?? {}) };
    branches(source.branches, agents);
    const candidates = [source.user, source.userMessage, source.message, source.resultMessage, ...(source.messages ?? []), ...(source.notices ?? [])]
      .filter((message): message is ChatMessage => Boolean(message)).map(message => messageSchema.parse(message));
    const messages = [...new Map(candidates.map(message => [message.id, message])).values()];
    const changed = messages.some(message => baseline.get(message.id) !== digest(json(message))) ||
      Object.entries(source.subagents ?? {}).some(([id, value]) => digest(json(baseAgents[id] ?? null)) !== digest(json(value)));
    if (!changed) continue;
    if (!messages.length) messages.push(...record.messages);
    const first = Math.min(...messages.map(message => message.seq));
    if (!messages.some(message => message.role === "user")) {
      for (let index = record.messages.length - 1; index >= 0; index--) {
        const user = record.messages[index]!; if (user.role === "user" && user.seq < first) { messages.unshift(user); break; }
      }
    }
    retain("unsent", messages, agents);
  }
}
