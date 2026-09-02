/**
 * [INPUT]: Depends on the shared ChatStoreState cell (metadata map, projection, published aggregate slot, database client, device id) and bounded SQLite query commands
 * [OUTPUT]: Provides ChatReadModel: cloned metadata, message-free renderer context, exact/bounded native-message and Subagent facts, execution-context projection, Memory segments, generation-fenced timeline/outline/find, keyset search queries, and attachment reachability
 * [POS]: Read-model collaborator of ChatStore; it holds no state of its own, so bounded projections can never enlarge the mutation coordinator
 */

import type {
  ChatFindInput,
  ChatFindPage,
  ChatOutlineInput,
  ChatOutlinePage,
  ChatRecord,
  ChatRuntimeContext,
  ChatSummary,
  ChatTimelineAroundInput,
  ChatTimelinePage,
  ChatTimelinePageInput,
} from "../../../../shared/chats-ipc";
import { tokenizeSearchQuery } from "../../../../shared/search-text";
import { assertChatId } from "../chat-guards";
import type { ChatMetadata } from "../chat-summary";
import { queryGramTokens } from "../sqlite/chat-repository";
import type { SearchDocumentCursor } from "../sqlite/database-protocol";
import type { ChatStoreState } from "./state";

const clone = <T>(value: T): T => structuredClone(value);

export class ChatReadModel {
  constructor(private readonly state: ChatStoreState) {}

  list(): ChatSummary[] {
    return this.state.projection.list();
  }

  getMetadata(chatId: string): ChatMetadata | null {
    assertChatId(chatId);
    const record = this.state.metadata.get(chatId);
    return record ? clone(record) : null;
  }

  async getNativeMessage(
    chatId: string,
    selector:
      | { kind: "id"; messageId: string }
      | { kind: "seq"; seq: number }
      | { kind: "first-user" }
  ) {
    assertChatId(chatId);
    if (!this.state.metadata.has(chatId)) return null;
    return this.state.requireDatabase().execute({
      kind: "get-native-message",
      chatId,
      deviceId: this.state.requireDeviceId(),
      selector,
    });
  }

  getNativeMessages(chatId: string) {
    assertChatId(chatId);
    if (!this.state.metadata.has(chatId)) return Promise.resolve(null);
    return this.state.requireDatabase().execute({
      kind: "get-native-messages",
      chatId,
      deviceId: this.state.requireDeviceId(),
    });
  }

  getNativeSubagents(chatId: string) {
    assertChatId(chatId);
    if (!this.state.metadata.has(chatId)) return Promise.resolve(null);
    return this.state.requireDatabase().execute({
      kind: "get-native-subagents",
      chatId,
      deviceId: this.state.requireDeviceId(),
    });
  }

  async getConversation(chatId: string): Promise<ChatRecord | null> {
    const metadata = this.getMetadata(chatId);
    if (!metadata) return null;
    const messages = await this.getNativeMessages(chatId);
    if (!messages) return null;
    const { preview: _preview, ...record } = metadata;
    return { ...record, messages };
  }

  async getRuntimeContext(chatId: string): Promise<ChatRuntimeContext | null> {
    const metadata = this.getMetadata(chatId);
    if (!metadata) return null;
    const subagents = await this.getNativeSubagents(chatId);
    if (!subagents) return null;
    const { preview: _preview, ...context } = metadata;
    return {
      ...context,
      ...(Object.keys(subagents).length ? { subagents } : {}),
    };
  }

  async get(chatId: string): Promise<ChatRecord | null> {
    assertChatId(chatId);
    if (!this.state.metadata.has(chatId)) return null;
    if (this.state.activeRecord?.record.id === chatId) {
      return clone(this.state.activeRecord.record);
    }
    return clone(await this.state.readRecord(chatId));
  }

  timelinePage(input: ChatTimelinePageInput): Promise<ChatTimelinePage | null> {
    assertChatId(input.chatId);
    if (!this.state.metadata.has(input.chatId)) return Promise.resolve(null);
    return this.state.requireDatabase().execute({
      kind: "get-timeline-page",
      input,
      deviceId: this.state.requireDeviceId(),
    });
  }

  timelineAround(input: ChatTimelineAroundInput): Promise<ChatTimelinePage | null> {
    assertChatId(input.chatId);
    if (!this.state.metadata.has(input.chatId)) return Promise.resolve(null);
    return this.state.requireDatabase().execute({
      kind: "get-timeline-around",
      input,
      deviceId: this.state.requireDeviceId(),
    });
  }

  outlinePage(input: ChatOutlineInput): Promise<ChatOutlinePage | null> {
    assertChatId(input.chatId);
    const chatId = input.chatId;
    if (!this.state.metadata.has(chatId)) return Promise.resolve(null);
    return this.state.requireDatabase().execute({
      kind: "get-outline-page",
      chatId,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      limit: Math.max(1, Math.min(200, input.limit ?? 100)),
      deviceId: this.state.requireDeviceId(),
    });
  }

  findMessages(input: ChatFindInput): Promise<ChatFindPage | null> {
    assertChatId(input.chatId);
    if (!this.state.metadata.has(input.chatId)) return Promise.resolve(null);
    const tokens = tokenizeSearchQuery(input.query);
    return this.state.requireDatabase().execute({
      kind: "find-messages",
      chatId: input.chatId,
      grams: queryGramTokens(tokens),
      tokens,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      limit: Math.max(1, Math.min(200, input.limit ?? 100)),
      deviceId: this.state.requireDeviceId(),
    });
  }

  getWarning() { return this.state.warnings.join("\n") || undefined; }
  getStorageFailures() { return clone(this.state.storageFailures); }
  pushWarning(message: string) { this.state.warnings.push(message); }
  getProjectId(chatId: string) { return this.state.projection.projectId(chatId); }
  getChatRef(chatId: string) { return this.state.projection.chatRef(chatId); }
  getIncarnationId(chatId: string) { return this.state.projection.incarnationId(chatId); }
  getHomeDir(chatId: string) { return this.state.projection.homeDir(chatId); }
  getImportOrigin(chatId: string) { return this.state.projection.importOrigin(chatId); }
  getExecutionDir(chatId: string) { return this.state.projection.executionDir(chatId); }
  listAdoptionSnapshotIds() { return this.state.projection.adoptionSnapshotIds(); }

  adoptionReferenceProjection() {
    return Promise.resolve({
      complete: true,
      refs: this.state.projection.adoptionSnapshotIds(),
    });
  }

  listChatSummaries() {
    return this.state.requireDatabase().execute({
      kind: "list-memory-summaries",
      deviceId: this.state.requireDeviceId(),
    });
  }

  memoryNativeSegment(chatId: string, afterSeq = 0, limit = 128) {
    assertChatId(chatId);
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
      throw new Error("Memory native segment cursor is invalid");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
      throw new Error("Memory native segment limit is invalid");
    }
    return this.state.requireDatabase().execute({
      kind: "get-memory-native-segment",
      chatId,
      deviceId: this.state.requireDeviceId(),
      afterSeq,
      limit,
    });
  }

  listBaseIdentities() { return this.state.projection.baseIdentities(); }
  listBindings() { return this.state.projection.bindings(); }
  listHistoryBindings() { return this.state.projection.historyBindings(); }
  listByProject(projectId: string) { return this.state.projection.byProject(projectId); }
  getAppRole(chatId: string) { return this.state.projection.appRole(chatId); }
  listProjectRefs() { return this.state.projection.projectReferences(); }
  getStoreRevision() { return this.state.storeRevision; }

  async listReferencedAttachmentIds() {
    return new Set(
      await this.state.requireDatabase().execute({ kind: "list-attachment-ids" })
    );
  }

  hasAttachmentReference(chatId: string, attachmentId: string) {
    assertChatId(chatId);
    return this.state.requireDatabase().execute({
      kind: "has-attachment-reference",
      chatId,
      attachmentId,
      deviceId: this.state.requireDeviceId(),
    });
  }

  getAttachmentReference(chatId: string, attachmentId: string) {
    assertChatId(chatId);
    if (!this.state.metadata.has(chatId)) return Promise.resolve(null);
    return this.state.requireDatabase().execute({
      kind: "get-attachment-reference",
      chatId,
      attachmentId,
      deviceId: this.state.requireDeviceId(),
    });
  }

  /* 游标是上一条命中的排序键本身，不是偏移量：扫描期间某个 Chat 被改动
     只会让它自己换位置，不会把整扇窗口推着走（既不重发也不漏发邻居）。 */
  searchTimelineDocuments(
    tokens: readonly string[],
    cursor: SearchDocumentCursor | null,
    limit: number
  ) {
    return this.state.requireDatabase().execute({
      kind: "search-documents",
      grams: queryGramTokens(tokens),
      cursor,
      limit: Math.max(1, Math.min(500, limit)),
      deviceId: this.state.requireDeviceId(),
    });
  }
}
