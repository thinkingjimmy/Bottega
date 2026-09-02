/**
 * [INPUT]: Depends on ChatBoundary upperSeq/upperTime Grant, bound sharing mode/generation Consent, native-only Chat segment pages, Policy/tombstone, Delivery, and capture controller
 * [OUTPUT]: Provides paged grant-bound backfill that advances at most one historical assistant turn per tick while preserving the current Consent sharing generation
 * [POS]: The main/memory/orchestration canonical Chat history delivery compiler; ForeignSnapshotBoundary is consumed by a parallel foreign-history-controller
 */

import type {
  AssistantChatMessage,
  ChatMessage,
  ChatRecord,
  UserChatMessage,
} from "../../../../shared/chats-ipc";
import type { MemoryNativeSegmentPage } from "../../chats/sqlite/database-protocol";
import {
  expectedPeerId,
  freezeMemoryValue,
  memorySpaceId,
  sourceSessionKey,
} from "../core/domain";
import { resolveMemoryScopeSubject } from "../core/memory-scope";
import type { MemoryDeliveryStore } from "../delivery/store";
import { isMemorableAssistant } from "../core/domain";
import type { MemoryCaptureController } from "./capture-controller";
import type { MemoryPolicyStore } from "../policy/store";
import type { ChatBackfillGrant } from "../policy/store";

type ChatSummary = Readonly<{ id: string; incarnationId: string }>;

type Dependencies = {
  policy: MemoryPolicyStore;
  delivery: MemoryDeliveryStore;
  capture: MemoryCaptureController;
  listChatSummaries(): Promise<ChatSummary[]>;
  readChat(chatId: string): Promise<ChatRecord | null>;
  readNativeChatSegment?(
    chatId: string,
    afterSeq: number,
    limit: number
  ): Promise<MemoryNativeSegmentPage | null>;
  runtime(): Readonly<{
    providerDataInstanceId: string;
    runtimeGeneration: number;
  }> | null;
};

export type MemoryBackfillTickResult =
  | Readonly<{ kind: "advanced" }>
  | Readonly<{
      kind: "idle";
      grantedTurns: number;
      settledTurns: number;
    }>
  | Readonly<{
      kind: "aborted";
      reason: "paused" | "stale-capability";
    }>;

export class MemoryBackfillController {
  constructor(private readonly dependencies: Dependencies) {}

  async tick(
    options: { rebuildEpochId?: string } = {}
  ): Promise<MemoryBackfillTickResult> {
    const snapshot = this.dependencies.policy.snapshot();
    const rebuild = options.rebuildEpochId !== undefined;
    if (snapshot.state.pausedAt !== null && !rebuild) {
      return { kind: "aborted", reason: "paused" };
    }
    /* rebuild 模式按 job 自己的 Epoch 直查——grants 的本轮隔离靠这个
       显式 id，而不是「碰巧占着全局槽位」；live 槽位随暂停/恢复轮换
       不影响 job。live 模式维持 activeConsent 槽位语义。 */
    const consent = rebuild
      ? this.rebuildConsent(snapshot, options.rebuildEpochId!)
      : this.dependencies.policy.activeConsent(snapshot);
    if (!consent) return { kind: "aborted", reason: "stale-capability" };
    const grants = Object.values(snapshot.state.backfillGrants)
      .filter(
        (grant): grant is ChatBackfillGrant =>
          grant.boundary === "chat" &&
          grant.revokedAt === null &&
          grant.consentEpochId === consent.id &&
          grant.providerDataInstanceId === consent.providerDataInstanceId
      )
      .sort((left, right) => left.createdAt - right.createdAt);
    let grantedTurns = 0;
    let settledTurns = 0;
    for (const grant of grants) {
      for (const [source, upperSeq] of Object.entries(grant.upperSeqBySession)) {
        if (snapshot.state.tombstones[source]) continue;
        const summary = await this.findChat(source);
        if (!summary || !grant.chatIncarnations.includes(summary.incarnationId)) continue;
        const stream = this.dependencies.delivery.stream({
          grantId: grant.id,
          providerDataInstanceId: grant.providerDataInstanceId,
          memorySpaceId: grant.memorySpaceId,
          sourceSessionKey: source,
        });
        const selected = await this.inspectNativeChat(
          summary,
          stream?.cursor ?? 0,
          upperSeq,
          grant.lowerTime,
          grant.upperTime
        );
        if (!selected) continue;
        const { chat } = selected;
        const grantedForSource = selected.granted;
        grantedTurns += grantedForSource;
        settledTurns += Math.min(
          grantedForSource,
          (stream?.delivered ?? 0) + (stream?.gap ?? 0)
        );
        await this.dependencies.delivery.ensureBackfillStream({
          grantId: grant.id,
          providerDataInstanceId: grant.providerDataInstanceId,
          providerId: consent.providerId,
          memorySpaceId: grant.memorySpaceId,
          sourceSessionKey: source,
          pending: selected.pending,
        });
        const assistant = selected.assistant;
        if (!assistant) continue;
        const user = selected.user;
        if (!user) {
          await this.dependencies.delivery.recordBackfillGap({
            grantId: grant.id,
            providerDataInstanceId: grant.providerDataInstanceId,
            memorySpaceId: grant.memorySpaceId,
            sourceSessionKey: source,
            assistantSeq: assistant.seq,
          });
          return { kind: "advanced" };
        }
        const requestId = `backfill:${grant.id}:${assistant.seq}`;
        const context = this.contextFor({
          chat,
          requestId,
          memorySpaceId: grant.memorySpaceId,
          consentEpochId: grant.consentEpochId,
          providerDataInstanceId: grant.providerDataInstanceId,
          rebuild,
        });
        if (!context) return { kind: "aborted", reason: "stale-capability" };
        const captured = await this.dependencies.capture.captureCanonical({
          context,
          requestId,
          user,
          assistant,
          grantId: grant.id,
          ...(rebuild ? { mode: "rebuild" as const } : {}),
        });
        if (!captured) {
          return { kind: "aborted", reason: "stale-capability" };
        }
        return { kind: "advanced" };
      }
    }
    return { kind: "idle", grantedTurns, settledTurns };
  }

  private async findChat(source: string) {
    for (const summary of await this.dependencies.listChatSummaries()) {
      if (sourceSessionKey({ chatId: summary.id, incarnationId: summary.incarnationId }) === source) {
        return summary;
      }
    }
    return null;
  }

  private async inspectNativeChat(
    summary: ChatSummary,
    cursor: number,
    upperSeq: number,
    lowerTime: number | null,
    upperTime: number
  ) {
    if (!this.dependencies.readNativeChatSegment) {
      const chat = await this.dependencies.readChat(summary.id);
      if (!chat || chat.readOnlyReason) return null;
      return inspectBackfillPages(
        chat,
        oneBackfillPage(chat.messages),
        cursor,
        upperSeq,
        lowerTime,
        upperTime
      );
    }
    const first = await this.dependencies.readNativeChatSegment(summary.id, 0, 128);
    if (!first || first.incarnationId !== summary.incarnationId) return null;
    return inspectBackfillPages(
      first,
      backfillPages(first, this.dependencies.readNativeChatSegment),
      cursor,
      upperSeq,
      lowerTime,
      upperTime
    );
  }

  private rebuildConsent(
    snapshot: ReturnType<MemoryPolicyStore["snapshot"]>,
    epochId: string
  ) {
    const epoch = snapshot.state.consentEpochs[epochId];
    return epoch && epoch.revokedAt === null && epoch.purpose === "rebuild"
      ? epoch
      : null;
  }

  private contextFor(input: {
    chat: Pick<ChatRecord, "id" | "incarnationId" | "projectId" | "homeDir">;
    requestId: string;
    memorySpaceId: string;
    consentEpochId: string;
    providerDataInstanceId: string;
    rebuild: boolean;
  }) {
    const runtime = this.dependencies.runtime();
    const policy = this.dependencies.policy.snapshot();
    const consent = input.rebuild
      ? this.rebuildConsent(policy, input.consentEpochId)
      : this.dependencies.policy.activeConsent(policy);
    const source = sourceSessionKey({
      chatId: input.chat.id,
      incarnationId: input.chat.incarnationId,
    });
    const space = this.dependencies.policy.spaceFor(
      resolveMemoryScopeSubject(
        {
          chatId: input.chat.id,
          incarnationId: input.chat.incarnationId,
          projectId: input.chat.projectId,
        },
        consent?.sharingMode ?? "chat",
        policy.state.scopeOwnerId
      )
    );
    if (
      !runtime ||
      runtime.providerDataInstanceId !== input.providerDataInstanceId ||
      consent?.id !== input.consentEpochId ||
      consent.sharingGeneration !== policy.state.sharingGeneration ||
      Boolean(policy.state.tombstones[source]) ||
      memorySpaceId(space) !== input.memorySpaceId
    ) return null;
    return freezeMemoryValue({
      requestId: input.requestId,
      sharingMode: consent.sharingMode,
      sharingGeneration: consent.sharingGeneration,
      memorySpace: space,
      memorySpaceId: input.memorySpaceId,
      sourceSessionKey: source,
      workspaceRealpath: input.chat.homeDir ?? "",
      policyRevision: policy.state.revision,
      consentEpochId: input.consentEpochId,
      providerDataInstanceId: input.providerDataInstanceId,
      expectedPeerId: expectedPeerId(input.memorySpaceId),
      revocationRevision: policy.state.revocationRevision,
      runtimeGeneration: runtime.runtimeGeneration,
    });
  }
}

async function inspectBackfillPages(
  chat: Pick<ChatRecord, "id" | "incarnationId" | "projectId" | "homeDir">,
  pages: AsyncIterable<Readonly<{
    precedingUser: ChatMessage | null;
    messages: readonly ChatMessage[];
  }>>,
  cursor: number,
  upperSeq: number,
  lowerTime: number | null,
  upperTime: number
) {
  let granted = 0;
  let pending = 0;
  let lastUser: UserChatMessage | null = null;
  let assistant: AssistantChatMessage | null = null;
  let user: UserChatMessage | null = null;
  for await (const page of pages) {
    if (page.precedingUser?.role === "user") lastUser = page.precedingUser;
    for (const message of page.messages) {
      if (message.role === "user") lastUser = message;
      if (
        message.role !== "assistant" || message.seq > upperSeq ||
        !isMemorableAssistant(message)
      ) continue;
      const admissionAt = lastUser?.createdAt;
      if (
        admissionAt === undefined || admissionAt > upperTime ||
        (lowerTime !== null && admissionAt < lowerTime)
      ) continue;
      granted += 1;
      if (message.seq <= cursor) continue;
      pending += 1;
      if (!assistant) {
        assistant = message;
        user = lastUser;
      }
    }
  }
  return { chat, granted, pending, assistant, user };
}

async function* oneBackfillPage(messages: readonly ChatMessage[]) {
  yield { precedingUser: null, messages };
}

async function* backfillPages(
  first: MemoryNativeSegmentPage,
  read: NonNullable<Dependencies["readNativeChatSegment"]>
) {
  let page: MemoryNativeSegmentPage | null = first;
  while (page) {
    yield page;
    page = page.nextAfterSeq === null
      ? null
      : await read(page.id, page.nextAfterSeq, 128);
  }
}
