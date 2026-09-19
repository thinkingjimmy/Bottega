/**
 * [INPUT]: Depends on rooted recovery content, the existing Fork factory, Chat Home journal and scoped Store receipts.
 * [OUTPUT]: Saves ordinary divergent content into one independent native Chat with stable retry identity, forward-only tail growth and a copy name no other device has taken.
 * [POS]: Explicit local recovery action; source canonical content, App authority and original custody remain unchanged.
 */
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { saveReadonlyCopy } from "./readonly";
import { realpath } from "node:fs/promises";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { RecoveryIdentity } from "../../../../../shared/cloud/recovery";
import type { ChatRecord } from "../../../../../shared/chats-ipc";
import type { ChatStore } from "../../../chats/chat-store";
import type { ChatHomeService } from "../../../chat-home/chat-home-service";
import type { AdmissionGate } from "../../../lifecycle/admission-gate";
import { createRecoveredChatRecord, allocateForkTitle, forkOperationId } from "../../../chats/chat-fork";
import { chatExecutionWindow } from "../../../chats/chat-schema";
import { sameMirrorMessage } from "../../../library/mirrors/store";
import { recoveredForkKey, type ChatDivergence } from "../../../chats/sqlite/cloud/convergence/contracts";
import type { RecoveryContent } from "./content";
import { copyLibraryAssets, copyLibraryHome } from "../../../library/assets/copy";
import { artifactRuntime } from "../../../artifacts/runtime";
import { libraryDirectory } from "../../../library/paths";
import { encodeTranscript } from "../../../library/mirrors/codec";
import { durableReplaceFile } from "../../../persistence/durable-json";
import { join } from "node:path";
type SaveOptions = { currentHome?: boolean; divergence?: Omit<ChatDivergence, "chatId"> };
export class RecoverySave {
  private flights = new Map<string, Promise<string>>();
  constructor(private readonly ports: { content: RecoveryContent; chats: ChatStore; homes: ChatHomeService; gate: AdmissionGate;
    current(scope: SyncScope): void; own(activity: { close(): Promise<void> }): () => void; changed(): void }) {}
  /* A divergence-keyed save owns the same child across retries even when the archived tail grew; the
     deletion path has no divergence and keeps naming its child after the archive it rescues. */
  save(scope: SyncScope, identity: RecoveryIdentity, options: SaveOptions = {}) {
    this.ports.current(scope);
    const key = options.divergence ? recoveredForkKey(scope, { chatId: identity.chatId, ...options.divergence }) : hashChatContent([scope, identity]);
    const prior = this.flights.get(key); if (prior) return prior;
    const controller = new AbortController();
    const release = this.ports.own({ close: async () => { controller.abort(); await flight.catch(() => {}); } });
    const flight = Promise.resolve().then(() => this.ports.gate.runExclusiveAll([`chat:${identity.chatId}`, `chat:recovered_${key.slice(0, 32)}`],
      () => this.perform(scope, identity, key, controller.signal, options)));
    this.flights.set(key, flight); void flight.finally(() => { this.flights.delete(key); release(); }).catch(() => {}); return flight;
  }
  /* Fork copy naming must see the names every device has already used: counting only
     local titles would let two computers each hand out the same "X (2)". The lookup
     directory is the same mirror manifest local SQLite has, matching the sidebar's
     merge view. */
  private async occupiedTitles(scope: SyncScope) {
    const titles: Array<string | null> = this.ports.chats.list().map(chat => chat.title);
    let afterId: string | null = null;
    for (;;) {
      const page = await this.ports.chats.sync.read(scope, { type: "confirmed-chat-page", afterId, limit: 50 });
      if (page.type !== "confirmed-chat-page") throw new Error("CHAT_CATALOG_UNAVAILABLE");
      for (const head of page.value.items) titles.push(head.chat.title);
      if (page.value.complete || page.value.cursor === null || page.value.cursor === afterId) return titles;
      afterId = page.value.cursor;
    }
  }
  private async perform(scope: SyncScope, identity: RecoveryIdentity, key: string, signal: AbortSignal, options: SaveOptions) {
    const current = () => { signal.throwIfAborted(); this.ports.current(scope); }, { chats, homes } = this.ports;
    const childChatId = `recovered_${key.slice(0, 32)}`, operationId = forkOperationId(key);
    if (identity.archiveId.startsWith("readonly_") && chats.getMetadata(identity.chatId)?.readOnlyReason === "external-readonly") {
      const child = await saveReadonlyCopy(chats, identity.chatId, key, current); this.ports.changed(); return child;
    }
    const value = await this.ports.content.native(scope, identity); current();
    if (homes.libraryRoot) {
      const branches = await libraryDirectory(homes.libraryRoot, "chats", identity.chatId, "branches");
      await durableReplaceFile(join(branches, `${identity.archiveId}.jsonl`), encodeTranscript(value.content)); current();
    }
    if (value.content.classification.conversationKind !== "ordinary") throw new Error("CHAT_RECOVERY_SOURCE_INELIGIBLE");
    const metadata = chats.getMetadata(identity.chatId);
    if (!metadata || metadata.context.kind !== "ordinary") throw new Error("CHAT_RECOVERY_SOURCE_UNAVAILABLE");
    const existing = chats.getMetadata(childChatId);
    if (existing) {
      const home = homes.identityForCreation(childChatId);
      if (!home || home.intentId !== operationId || home.incarnationId !== existing.incarnationId || existing.parentChatId !== identity.chatId) throw new Error("CHAT_RECOVERY_CHILD_CHANGED");
    }
    if (!value.content.messages.some(message => message.role === "user")) throw new Error("CHAT_RECOVERY_SOURCE_INELIGIBLE");
    // Verify every retained file before creating references in the independent child.
    let before: number | null = null;
    do { const page = await this.ports.content.page(scope, { ...identity, before }, signal); current(); before = page.cursor; } while (before !== null);
    // The Home submission identifies the same thing the child id does, so a retry keeps its ownership.
    const submission = options.divergence ? { scope, chatId: identity.chatId, ...options.divergence } : { scope, ...identity };
    const home = await homes.beginCreation({ intentId: operationId, chatId: childChatId, submission,
      workspaceScope: { kind: "conversation", conversationId: childChatId }, stagingOwner: "chat-fork" }); current();
    const root = await realpath(home.homeDir);
    const restoreHome = async () => {
      if (options.currentHome && homes.libraryRoot) { await copyLibraryHome(homes.libraryRoot, identity.chatId, childChatId); return; }
      await this.ports.content.restoreHome(scope, identity, { root, verify: async () => {
        current(); const owned = await homes.verifyOwnership(childChatId), durable = homes.identityForCreation(childChatId);
        if (!owned || durable?.intentId !== operationId || durable.incarnationId !== home.incarnationId || await realpath(home.homeDir) !== root) throw new Error("CHAT_RECOVERY_HOME_CHANGED");
      } }, signal);
    };
    if (home.phase !== "committed") await restoreHome(); current();
    const { preview: _preview, ...facts } = metadata;
    const source = { ...facts, ...value.snapshot.chat, projectId: null, messages: value.content.messages, subagents: value.content.subagents } as ChatRecord;
    let ordinal = 0;
    const title = existing?.title ?? allocateForkTitle(metadata.title, await this.occupiedTitles(scope)); current();
    const record = createRecoveredChatRecord({ source, childChatId, childIncarnationId: home.incarnationId, homeDir: home.homeDir,
      title, now: existing?.createdAt ?? Date.now(),
      generateId: () => hashChatContent([key, ordinal++]).slice(0, 32) });
    if (homes.libraryRoot) {
      const missing = await copyLibraryAssets(homes.libraryRoot, identity.chatId, record);
      if (missing.length) throw new Error("CHAT_RECOVERY_FILES_UNAVAILABLE");
    }
    if (home.phase !== "committed") await homes.markPrepared(childChatId); current();
    await chats.sync.recovery.commit(scope, identity, chatExecutionWindow({ ...record, messages: record.messages.slice(0, 20) }), operationId); current();
    const saved = await chats.library.transcript(childChatId), overlap = Math.min(saved.messages.length, record.messages.length);
    /* The child only ever grows forward. While it still holds a prefix of this archive a retry appends
       whatever the archive gained and refreshes the Home that tail was produced in; once the user has
       continued the child, the longer archived tail is kept beside it as a superseded branch instead of
       becoming a second copy of the same divergence. */
    if (record.messages.slice(0, overlap).some((message, index) => !sameMirrorMessage(message, saved.messages[index]!))) await this.supersede(childChatId, identity.archiveId, record);
    else if (saved.messages.length < record.messages.length) { await chats.library.install(record); current(); await restoreHome(); }
    current();
    await homes.commitCreation(childChatId); current(); await artifactRuntime()?.fork(identity.chatId, record);
    this.ports.changed(); return childChatId;
  }
  /** Keeps a tail the child can no longer adopt as one readable branch file of that child. */
  private async supersede(childChatId: string, archiveId: string, record: ChatRecord) {
    const root = this.ports.homes.libraryRoot; if (!root) return;
    const branches = await libraryDirectory(root, "chats", childChatId, "branches");
    await durableReplaceFile(join(branches, `${archiveId}.jsonl`), encodeTranscript({ messages: record.messages, subagents: record.subagents ?? {} }));
  }
}
