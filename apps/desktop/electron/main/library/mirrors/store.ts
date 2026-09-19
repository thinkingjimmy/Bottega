/**
 * [INPUT]: Depends on the canonical Chat state/queue, schema and receipt-bearing aggregate writer.
 * [OUTPUT]: Installs only unknown Chats or a verified forward transcript extension, and reads complete transcripts in bounded 500-message pages.
 * [POS]: Folder materialization collaborator; it cannot replace an existing divergent transcript.
 */
import { projectPortableMessage } from "@ai-chat/cloud-protocol/chats/content/projection";
import type { ChatRecord } from "../../../../shared/chats-ipc";
import type { ChatStoreState } from "../../chats/store/state";
import { metadataOf } from "../../chats/chat-summary";
import { persistRecordToStorage } from "../../chats/store/persistence";
import { RestoredSessionStore } from "../sessions/store";
import { mirrorHash, libraryExecutionWindow, encodeTranscript, type MirrorTranscript } from "./codec";

export const sameMirrorMessage = (left: ChatRecord["messages"][number], right: ChatRecord["messages"][number]) =>
  mirrorHash(projectPortableMessage(left)) === mirrorHash(projectPortableMessage(right));
export const sameMirrorEntry = (left: MirrorTranscript, right: MirrorTranscript, index: number) =>
  Boolean(left.messages[index] && right.messages[index]) &&
  encodeTranscript({ messages: [left.messages[index]!], subagents: left.subagents }) ===
  encodeTranscript({ messages: [right.messages[index]!], subagents: right.subagents });

export class LibraryChatStore {
  readonly sessions: RestoredSessionStore;
  constructor(private state: ChatStoreState) { this.sessions = new RestoredSessionStore(state.userData); }
  get userData() { return this.state.userData; }
  subscribe(changed: () => void) { this.state.listeners.add(changed); return () => { this.state.listeners.delete(changed); }; }
  imported(chatId: string, generationId: string | null, afterSeq: number) {
    return this.state.requireDatabase().execute({ kind: "read-library-import", chatId, generationId, afterSeq, deviceId: this.state.requireDeviceId() });
  }
  mirrors(afterId: string | null, known?: Readonly<Record<string, string>>) {
    return this.state.requireDatabase().execute({ kind: "list-library-mirrors", afterId, ...(known ? { known } : {}) });
  }
  async transcript(chatId: string): Promise<MirrorTranscript> {
    const result: MirrorTranscript = { messages: [], subagents: {} };
    let afterSeq = 0, revision: string | undefined;
    for (;;) {
      const page = await this.state.requireDatabase().execute({ kind: "read-library-native", chatId, afterSeq, limit: 500, deviceId: this.state.requireDeviceId() });
      if (revision && revision !== page.revision) throw new Error("LIBRARY_TRANSCRIPT_CHANGED");
      revision = page.revision;
      result.messages.push(...page.messages); Object.assign(result.subagents, page.subagents);
      if (!page.messages.length) return result;
      afterSeq = page.messages.at(-1)!.seq;
    }
  }
  install(input: ChatRecord) {
    return this.state.queue.enqueue(async () => {
      let current = this.state.metadata.has(input.id) ? await this.state.readRecord(input.id) : null;
      const restoringManaged = current?.readOnlyReason === "external-readonly" && Boolean(input.importOrigin && input.homeDir);
      const saved = current ? await this.transcript(input.id) : { messages: [], subagents: {} };
      if (current && (current.incarnationId !== input.incarnationId || saved.messages.length > input.messages.length ||
        saved.messages.some((_message, index) => !sameMirrorEntry(saved, { messages: input.messages, subagents: input.subagents ?? {} }, index)))) throw new Error("LIBRARY_TRANSCRIPT_DIVERGED");
      if (current && !restoringManaged && saved.messages.length === input.messages.length) return current;
      /* A Fork child extended with more of its parent's archived tail inherits further:
         the divider must move with the appended messages, or they read as the child's own. */
      const lineage = current && !restoringManaged && input.parentChatId && input.parentChatId === current.parentChatId &&
        input.parentIncarnationId === current.parentIncarnationId && (input.inheritedThroughSeq ?? 0) > (current.inheritedThroughSeq ?? 0)
        ? { parentMessageId: input.parentMessageId, inheritedThroughSeq: input.inheritedThroughSeq } : {};
      // Each receipt installs a verified prefix. A crash resumes from that prefix,
      // while the bounded execution record never deletes earlier SQLite facts.
      for (let end = Math.min(saved.messages.length + 20, input.messages.length); ; end = Math.min(end + 20, input.messages.length)) {
        const record = libraryExecutionWindow({ ...(restoringManaged ? input : current ?? input), ...lineage, messages: input.messages.slice(0, end), subagents: input.subagents,
          nextSeq: Math.max(current?.nextSeq ?? 1, (input.messages[end - 1]?.seq ?? 0) + 1), updatedAt: Math.max(current?.updatedAt ?? 0, input.updatedAt),
          chatRecordRevision: (current?.chatRecordRevision ?? 0) + 1, chatMessageRevision: (current?.chatMessageRevision ?? 0) + 1 });
        await persistRecordToStorage({ record, database: this.state.requireDatabase(), deviceId: this.state.requireDeviceId(),
          expectedAggregateRevision: current?.chatRecordRevision ?? null, onCommit: () => this.state.touch() });
        this.state.metadata.set(record.id, metadataOf(record)); this.state.messageRevisions.set(record.id, record.chatMessageRevision);
        this.state.remember(record, record.chatMessageRevision); current = record;
        if (end === input.messages.length) return record;
      }
    });
  }
}
