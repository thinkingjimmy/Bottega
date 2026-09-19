/**
 * [INPUT]: Depends on canonical portable Chat/message schemas and Node SHA-256.
 * [OUTPUT]: Provides forward-tolerant Chat metadata, a shared incremental JSONL decoder and portable native session hints.
 * [POS]: Human-readable backup contract; installation paths, grants and synchronization state are excluded explicitly.
 */
import { sessionBoundary, nativeSessionHintSchema } from "../sessions/boundary";
export { sessionBoundary, nativeSessionHintSchema, sessionBoundarySchema } from "../sessions/boundary";
import { createHash } from "node:crypto";
import { z } from "zod";
import { portableChatSchema } from "@ai-chat/cloud-protocol/chats/model";
import { messageSchema, subagentsSchema } from "@ai-chat/cloud-protocol/chats/content/messages";
import { projectPortableMessage } from "@ai-chat/cloud-protocol/chats/content/projection";
import { canonicalJson, projectChatClassification } from "../../../../shared/local-storage/contracts";
import type { ChatMessage, ChatRecord } from "../../../../shared/chats-ipc";
import { chatExecutionWindow as libraryExecutionWindow, referencedSubagents } from "../../chats/chat-schema";
export { chatExecutionWindow as libraryExecutionWindow } from "../../chats/chat-schema";

export const mirrorHash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
export const transcriptHash = (text: string) => createHash("sha256").update(text).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const { cloudRevision: _cloudRevision, ...portableShape } = portableChatSchema.shape;
export const mirrorChatSchema = z.object({
  version: z.literal(1), ...portableShape,
  kind: z.enum(["native", "external-readonly", "external-managed"]), archivedAt: z.number().int().nonnegative().nullable(),
  parentChatId: id.nullable().optional(), parentIncarnationId: id.nullable().optional(), parentMessageId: id.nullable().optional(),
  inheritedThroughSeq: z.number().int().positive().nullable().optional(),
  headSeq: z.number().int().nonnegative(), transcriptHash: hash,
  nativeSessions: z.array(nativeSessionHintSchema).max(4).default([]),
}).superRefine((value, context) => {
  const portable = Object.fromEntries(Object.keys(portableShape).map(key => [key, value[key as keyof typeof value]]));
  const result = portableChatSchema.safeParse({ ...portable, cloudRevision: 0 });
  if (!result.success) for (const issue of result.error.issues) context.addIssue({ code: "custom", path: issue.path, message: issue.message });
});
export type MirrorChat = z.infer<typeof mirrorChatSchema>;
export type MirrorTranscript = { messages: ChatMessage[]; subagents: NonNullable<ChatRecord["subagents"]>; incompleteTail?: true };
const headerSchema = z.object({ format: z.literal("bottega-transcript"), version: z.literal(1) });
export function encodeTranscript(record: MirrorTranscript) {
  const lines = [JSON.stringify({ format: "bottega-transcript", version: 1 })];
  for (const original of record.messages) {
    const { segment: _segment, ...input } = original;
    const message = projectPortableMessage(input);
    const agents = message.role === "assistant" ? Object.fromEntries(Object.entries(referencedSubagents(message.parts ?? [], record.subagents))
      .map(([id, agent]) => [id, { ...agent, parts: agent.parts.map(part => {
        if (part.type !== "tool") return part;
        const { mediaSource: _local, ...portable } = part; return portable;
      }) }])) : {};
    const subagents = Object.keys(agents).length ? subagentsSchema.parse(agents) : undefined;
    lines.push(JSON.stringify({ ...message, ...(subagents ? { subagents } : {}) }));
  }
  return lines.join("\n") + "\n";
}

export class TranscriptDecoder {
  readonly value: MirrorTranscript = { messages: [], subagents: {} };
  private header = false;
  private seq = 0;
  private readonly ids = new Set<string>();
  accept(line: string, terminated = true) {
    if (!this.header) { headerSchema.parse(JSON.parse(line)); this.header = true; return; }
    if (!line.trim()) return;
    let parsed;
    try { parsed = JSON.parse(line); }
    catch (error) {
      if (!terminated && this.value.messages.length) { this.value.incompleteTail = true; return; }
      throw error;
    }
    const { subagents: agents, ...raw } = parsed;
    if (raw.segment === "imported" && raw.importedSource) return;
    const role = messageSchema.options.find(option => option.shape.role.value === raw.role);
    if (!role) throw new Error("LIBRARY_MESSAGE_ROLE_INVALID");
    const message = messageSchema.parse(Object.fromEntries(Object.entries(raw).filter(([key]) => key in role.shape)));
    if (message.seq <= this.seq || this.ids.has(message.id)) throw new Error("LIBRARY_TRANSCRIPT_ORDER_INVALID");
    this.seq = message.seq; this.ids.add(message.id); this.value.messages.push(message as ChatMessage);
    if (agents) Object.assign(this.value.subagents, subagentsSchema.parse(agents));
  }
  finish() { if (!this.header) throw new Error("LIBRARY_FORMAT_UNSUPPORTED"); return this.value; }
}
export function decodeTranscript(text: string): MirrorTranscript {
  const decoder = new TranscriptDecoder(), lines = text.split("\n");
  lines.forEach((line, index) => decoder.accept(line, index < lines.length - 1));
  return decoder.finish();
}

export function encodeChat(record: ChatRecord, transcript: string): MirrorChat {
  const tail = record.messages.at(-1), cwd = record.executionDir ?? record.homeDir;
  return mirrorChatSchema.parse({
    version: 1, id: record.id, incarnationId: record.incarnationId, title: record.title, agent: record.agent,
    options: record.options, agentRevision: record.agentRevision, classification: projectChatClassification(record),
    createdAt: record.createdAt, updatedAt: record.updatedAt, sortKey: record.sortKey,
    kind: record.readOnlyReason === "external-readonly" ? "external-readonly" : record.importOrigin ? "external-managed" : "native",
    archivedAt: record.archivedAt ?? null, parentChatId: record.parentChatId, parentIncarnationId: record.parentIncarnationId,
    parentMessageId: record.parentMessageId, inheritedThroughSeq: record.inheritedThroughSeq,
    headSeq: tail?.seq ?? 0, transcriptHash: transcriptHash(transcript),
    nativeSessions: record.session && cwd ? [{ backend: record.session.backend, sessionId: record.session.id,
      cwdDigest: mirrorHash(cwd), headSeq: tail?.seq ?? 0, messageId: tail?.id ?? null, boundary: sessionBoundary(record.messages) }] : [],
  });
}

export function materializeMirror(head: MirrorChat, transcript: MirrorTranscript, homeDir: string): ChatRecord {
  const firstUser = transcript.messages.find(message => message.role === "user");
  const { classification, kind: _kind, version: _version, transcriptHash: _hash, headSeq, nativeSessions: _sessions, archivedAt, ...facts } = head;
  const context = classification.conversationKind === "ordinary" ? { kind: "ordinary" as const } : classification.conversationKind === "app-edit"
    ? { kind: "app-edit" as const, appId: classification.appId!, projectId: classification.projectId! }
    : { kind: "app-use" as const, appId: classification.appId! };
  const record = { ...facts, messages: transcript.messages, subagents: transcript.subagents, homeDir, projectId: classification.projectId,
    context, appRole: classification.conversationKind === "ordinary" ? null : classification.conversationKind === "app-edit" ? "edit" : "use",
    session: null, importOrigin: null, snapshotDigest: null, forkAgent: null, grants: [], grantRevision: 0,
    ...(archivedAt === null ? {} : { archivedAt }),
    titleSource: head.title ? "user" : "local-fallback", titleJob: { state: "none" },
    startState: firstUser ? { kind: "started-exact", firstUserMessageAt: firstUser.createdAt, firstUserMessageSeq: firstUser.seq } : { kind: "unstarted" },
    chatRecordRevision: 1, chatMessageRevision: 1, nextSeq: Math.max(headSeq, transcript.messages.at(-1)?.seq ?? 0) + 1,
  } as ChatRecord;
  return { ...libraryExecutionWindow(record), messages: transcript.messages, subagents: transcript.subagents };
}
