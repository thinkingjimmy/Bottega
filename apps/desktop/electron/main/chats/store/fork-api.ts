/**
 * [INPUT]: Depends on ChatStoreState, strict fork contracts, generation-fenced timeline paging, pure fork construction policy, SQLite operation receipts, and explicit unknown-outcome errors
 * [OUTPUT]: Provides exact native/imported source-prefix reads, receipt-first replay, and durable creation for independent forked Chat records
 * [POS]: Focused fork mutation collaborator behind the ChatStore facade; it owns no queue or state outside the shared ChatStoreState cell
 */

import { createHash } from "node:crypto";
import type {
  ChatForkMode,
  ChatMessage,
  ChatRecord,
  ChatTimelineCursor,
} from "../../../../shared/chats-ipc";
import { metadataOf } from "../chat-summary";
import { assertChatId } from "../chat-guards";
import { CHAT_MESSAGE_LIMIT } from "../chat-schema";
import {
  allocateForkTitle,
  createForkedChatRecord,
  forkOperationId,
  requireForkAnchor,
} from "../chat-fork";
import { ChatMutationOutcomeUnknownError } from "./mutation-outcome";
import type { ChatStoreState } from "./state";

type ForkIdentity = Readonly<{
  requestId: string;
  childChatId: string;
  sourceChatId: string;
  sourceIncarnationId: string;
  anchorMessageId: string;
  anchorSeq: number;
  mode: ChatForkMode;
}>;

type ForkSourceIdentity = Pick<
  ForkIdentity,
  "sourceChatId" | "sourceIncarnationId" | "anchorMessageId" | "anchorSeq"
>;

export type ChatForkCreateInput = ForkIdentity & Readonly<{
  childIncarnationId: string;
  homeDir: string;
  executionDir?: string | null;
}>;

const requestHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class ChatForkStoreApi {
  constructor(private readonly state: ChatStoreState) {}

  source(input: ForkSourceIdentity) {
    return this.state.queue.enqueue(() => this.readSource(input));
  }

  replay(input: ForkIdentity) {
    return this.state.queue.enqueue(async () => {
      const receipt = await this.state.requireDatabase().execute({
        kind: "get-operation-receipt",
        operationId: forkOperationId(input.requestId),
      });
      if (!receipt) return null;
      return this.replayReceipt(input, receipt.kind, receipt.targetId);
    });
  }

  create(input: ChatForkCreateInput) {
    return this.state.queue.enqueue(async () => {
      assertChatId(input.childChatId);
      assertChatId(input.sourceChatId);
      const database = this.state.requireDatabase();
      const operationId = forkOperationId(input.requestId);
      const receipt = await database.execute({
        kind: "get-operation-receipt",
        operationId,
      });
      if (receipt) return this.replayReceipt(input, receipt.kind, receipt.targetId);
      if (this.state.metadata.has(input.childChatId)) {
        throw Object.assign(new Error("CHAT_FORK_CHILD_EXISTS"), { status: 409 });
      }
      const source = await this.readSource(input);
      const title = allocateForkTitle(source.title, [...this.state.metadata.values()]
        .filter((chat) => chat.projectId === source.projectId)
        .map((chat) => chat.title));
      const record = createForkedChatRecord({
        source,
        childChatId: input.childChatId,
        childIncarnationId: input.childIncarnationId,
        title,
        homeDir: input.homeDir,
        executionDir: input.executionDir,
        mode: input.mode,
        anchorMessageId: input.anchorMessageId,
        anchorSeq: input.anchorSeq,
        now: this.state.now(),
      });
      const command = {
        kind: "upsert-record" as const,
        operationId,
        record,
        deviceId: this.state.requireDeviceId(),
        lifecycleKind: "native" as const,
        expectedAggregateRevision: null,
      };
      const outcome = await database.execute({ ...command, requestHash: requestHash(command) });
      if (outcome.status === "outcome_unknown") {
        throw new ChatMutationOutcomeUnknownError(outcome.operationId, outcome.reason);
      }
      if (outcome.status === "rejected") throw new Error(outcome.failure.message);
      this.state.metadata.set(record.id, metadataOf(record));
      this.state.messageRevisions.set(record.id, record.chatMessageRevision);
      this.state.remember(record, record.chatMessageRevision);
      this.state.touch();
      return structuredClone(record);
    });
  }

  private async readSource(input: ForkSourceIdentity): Promise<ChatRecord> {
    assertChatId(input.sourceChatId);
    const metadata = this.state.metadata.get(input.sourceChatId);
    if (!metadata) throw Object.assign(new Error("CHAT_FORK_SOURCE_MISSING"), { status: 404 });
    const database = this.state.requireDatabase();
    const around = await database.execute({
      kind: "get-timeline-around",
      input: {
        chatId: input.sourceChatId,
        messageId: input.anchorMessageId,
        radius: 1,
      },
      deviceId: this.state.requireDeviceId(),
    });
    if (!around || around.incarnationId !== input.sourceIncarnationId) {
      throw Object.assign(new Error("CHAT_FORK_ANCHOR_INELIGIBLE"), { status: 409 });
    }
    const anchorIndex = around.messages.findIndex(
      (message) => message.id === input.anchorMessageId && message.seq === input.anchorSeq
    );
    if (anchorIndex < 0) {
      throw Object.assign(new Error("CHAT_FORK_ANCHOR_INELIGIBLE"), { status: 409 });
    }
    let messages = around.messages.slice(0, anchorIndex + 1);
    let cursor = this.olderCursor(around, messages[0]);
    while (cursor) {
      const page = await database.execute({
        kind: "get-timeline-page",
        input: { chatId: input.sourceChatId, cursor, limit: 200 },
        deviceId: this.state.requireDeviceId(),
      });
      if (!page) {
        throw Object.assign(new Error("CHAT_FORK_SOURCE_MISSING"), { status: 404 });
      }
      messages = [...page.messages, ...messages];
      if (messages.length > CHAT_MESSAGE_LIMIT) {
        throw Object.assign(new Error("CHAT_FORK_PREFIX_TOO_LARGE"), { status: 409 });
      }
      cursor = page.olderCursor;
    }
    const { preview: _preview, ...facts } = structuredClone(metadata);
    const source = { ...facts, messages } as ChatRecord;
    requireForkAnchor(source, input);
    return source;
  }

  private olderCursor(
    page: Readonly<{
      olderCursor: ChatTimelineCursor | null;
      activeGenerationId: string | null;
      incarnationId: string;
      nativeMessageRevision: number;
    }>,
    first: ChatMessage | undefined
  ): ChatTimelineCursor | null {
    if (page.olderCursor) return page.olderCursor;
    if (first?.segment === "imported" || !page.activeGenerationId) return null;
    return {
      segment: "imported",
      beforeSeq: Number.MAX_SAFE_INTEGER,
      incarnationId: page.incarnationId,
      nativeMessageRevision: page.nativeMessageRevision,
      activeGenerationId: page.activeGenerationId,
    };
  }

  /* receipt 命中后只核对 lineage 与执行类型：child 之后会继续长消息，
     用 messages.length 反推 inheritedThroughSeq 会把合法重放误判为冲突。 */
  private async replayReceipt(
    input: ForkIdentity,
    kind: string,
    targetId: string | null
  ) {
    const existing = await this.state.readRecord(input.childChatId);
    const exact = kind === "upsert-record" && targetId === input.childChatId &&
      existing.parentChatId === input.sourceChatId &&
      existing.parentIncarnationId === input.sourceIncarnationId &&
      existing.parentMessageId === input.anchorMessageId &&
      (existing.executionKind === "managed-worktree") ===
        (input.mode === "new-worktree");
    if (!exact) throw Object.assign(new Error("CHAT_FORK_REQUEST_CONFLICT"), { status: 409 });
    return structuredClone(existing);
  }
}
