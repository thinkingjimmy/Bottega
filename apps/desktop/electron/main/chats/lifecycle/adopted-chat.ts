/**
 * [INPUT]: Depends on validated adoption input, Chat Home ownership/evidence, attachment commit custody, ChatStore SQLite saga APIs, and publication callbacks
 * [OUTPUT]: Provides readonly-to-managed continuation finalization and startup replay/fail/isolate reconciliation from committed-Home evidence
 * [POS]: Adoption lifecycle and recovery transaction beneath ChatsService; committed Home ownership is never compensated here
 */

import type { SessionRef } from "../../../../shared/agent-ipc";
import type { TrustedManualTurnSubmission } from "../../../../shared/sections-ipc";
import type {
  AdoptChatInput,
  ChatAttachmentMeta,
  UnsequencedUserMessage,
} from "../../../../shared/chats-ipc";
import type { ContinuationSagaSnapshot } from "../sqlite/database-protocol";
import type { ChatHomeService } from "../../chat-home/chat-home-service";
import type { ChatStore } from "../chat-store";
import type { ChatMessageMutation } from "../store/mutation-outcome";
import { adoptInputSchema } from "../chat-input";

type HomePort = Pick<ChatHomeService,
  "identityForCreation" | "assertCanCreateChat" | "commitCreation" |
  "committedCreationEvidence" | "isolateCommittedCreation">;

type Dependencies = Readonly<{
  store: ChatStore;
  homes?: HomePort;
  isAppProject?(projectId: string): boolean;
  assertAgentReady?(agent: AdoptChatInput["agent"]): Promise<void>;
  withProject<T>(projectId: string, task: () => Promise<T>): Promise<T>;
  commitWithAttachments<T>(
    payloads: AdoptChatInput["attachmentPayloads"],
    commit: (metas: ChatAttachmentMeta[]) => Promise<T>
  ): Promise<T>;
  publish(mutation: ChatMessageMutation): void;
  onSessionBound?(session: SessionRef, chatId: string): void;
}>;

const attachMetas = (
  message: UnsequencedUserMessage,
  metas: ChatAttachmentMeta[]
): UnsequencedUserMessage => metas.length ? { ...message, attachments: metas } : message;

export async function createAdoptedChat(
  dependencies: Dependencies,
  input: AdoptChatInput,
  sequence?: { userSeq: number; assistantSeq: number },
  projectLifecycle?: "held"
) {
  dependencies.homes?.assertCanCreateChat();
  const value = adoptInputSchema.parse(input);
  const home = dependencies.homes?.identityForCreation(value.id);
  if (!home) throw new Error("Chat Home creation intent 尚未物化");
  if (home.incarnationId !== value.incarnationId) {
    throw new Error("Chat Home incarnationId 与创建请求不一致");
  }
  if (dependencies.isAppProject?.(value.projectId)) {
    throw new Error("App Project 不接受外源历史收养");
  }
  await dependencies.assertAgentReady?.(value.agent);
  const create = () => finalizeSqlite(dependencies, value, home, sequence?.userSeq ?? 1);
  const record = projectLifecycle === "held"
    ? await create()
    : await dependencies.withProject(value.projectId, create);
  dependencies.onSessionBound?.(value.session, value.id);
  return record;
}

export async function beginAdoptedContinuation(
  store: ChatStore,
  submission: TrustedManualTurnSubmission
) {
  if (submission.persistence.kind !== "adopt") return;
  const page = await store.timelinePage({
    chatId: submission.persistence.input.id,
    limit: 1,
  });
  if (!page?.activeGenerationId) {
    throw new Error("Readonly continuation has no active imported generation");
  }
  const saga = await store.beginExternalContinuation({
    chatId: submission.persistence.input.id,
    generationId: page.activeGenerationId,
    homeIntentId: submission.intentId,
    continuationInput: submission.persistence.input,
    operationId: `${submission.intentId}_sqlite_begin`,
    finalizeOperationId: `${submission.intentId}_sqlite_finalize`,
    now: Date.now(),
  });
  await store.markContinuationHomePreparing(
    saga.sagaId,
    `${submission.intentId}_home_preparing`,
    Date.now()
  );
}

async function finalizeSqlite(
  dependencies: Dependencies,
  value: ReturnType<typeof adoptInputSchema.parse>,
  home: { incarnationId: string; homeDir: string; intentId: string },
  userSeq: number
) {
  const saga = (await dependencies.store.listReconcilableContinuations()).find(
    (candidate) => candidate.chatId === value.id && candidate.homeIntentId === home.intentId
  );
  if (!saga) throw new Error("Readonly continuation saga is missing");
  await dependencies.homes!.commitCreation(value.id);
  const evidence = await dependencies.homes!.committedCreationEvidence(
    value.id,
    home.intentId
  );
  await dependencies.store.recordContinuationHomeCommitted(
    saga.sagaId,
    `${home.intentId}_home_committed`,
    evidence,
    Date.now()
  );
  return completeSqliteContinuation(dependencies, value, home, saga, userSeq);
}

async function completeSqliteContinuation(
  dependencies: Dependencies,
  value: ReturnType<typeof adoptInputSchema.parse>,
  home: { incarnationId: string; homeDir: string },
  saga: ContinuationSagaSnapshot,
  userSeq: number
) {
  return dependencies.commitWithAttachments(value.attachmentPayloads, async (metas) => {
    const firstMessage = { ...attachMetas(value.firstMessage, metas), seq: userSeq };
    const result = await dependencies.store.finalizeExternalContinuation({
      sagaId: saga.sagaId,
      operationId: saga.finalizeOperationId,
      expectedGenerationId: saga.generationId,
      incarnationId: home.incarnationId,
      homeDir: home.homeDir,
      session: value.session,
      firstMessage,
      adoptionSnapshotId: value.importOrigin.adoptionSnapshotId!,
      snapshotDigest: value.snapshotDigest,
      startState: {
        kind: "started-exact",
        firstUserMessageAt: firstMessage.createdAt,
        firstUserMessageSeq: firstMessage.seq,
      },
      context: { kind: "ordinary" },
      appRole: null,
      grants: [],
      grantRevision: 0,
      now: Date.now(),
    });
    const record = await dependencies.store.getConversation(value.id);
    if (!record) throw new Error("Managed Chat is missing after continuation finalize");
    dependencies.publish({
      record,
      revision: result.nativeMessageRevision,
      appended: [firstMessage],
      storedMessage: firstMessage,
    });
    return record;
  });
}

export async function reconcileAdoptedContinuations(
  dependencies: Dependencies,
  liveIntentIds: ReadonlySet<string>
) {
  if (!dependencies.homes) return;
  for (const pending of await dependencies.store.listReconcilableContinuations()) {
    const value = pending.continuationInput
      ? adoptInputSchema.parse(pending.continuationInput)
      : null;
    let evidence;
    try {
      evidence = await dependencies.homes.committedCreationEvidence(
        pending.chatId,
        pending.homeIntentId
      );
    } catch (cause) {
      if (liveIntentIds.has(pending.homeIntentId)) continue;
      const reason = cause instanceof Error ? cause.message : String(cause);
      if (["home-committed", "finalizing"].includes(pending.state)) {
        await dependencies.homes.isolateCommittedCreation(
          pending.chatId,
          pending.homeIntentId,
          reason
        ).catch(() => undefined);
        await dependencies.store.isolateContinuationOrphan(
          pending.sagaId,
          `${pending.sagaId}_startup_isolate`,
          reason,
          Date.now()
        );
      } else {
        await dependencies.store.failContinuationPrecommit(
          pending.sagaId,
          `${pending.sagaId}_startup_fail`,
          reason,
          Date.now()
        );
      }
      continue;
    }
    if (!value) {
      const reason = "Continuation finalize input is unavailable";
      await dependencies.homes.isolateCommittedCreation(
        pending.chatId,
        pending.homeIntentId,
        reason
      );
      await dependencies.store.isolateContinuationOrphan(
        pending.sagaId,
        `${pending.sagaId}_startup_isolate`,
        reason,
        Date.now()
      );
      continue;
    }
    let saga = pending;
    if (saga.state === "intent-written") {
      saga = await dependencies.store.markContinuationHomePreparing(
        saga.sagaId,
        `${saga.sagaId}_startup_preparing`,
        Date.now()
      );
    }
    if (saga.state === "home-preparing") {
      saga = await dependencies.store.recordContinuationHomeCommitted(
        saga.sagaId,
        `${saga.sagaId}_startup_committed`,
        evidence,
        Date.now()
      );
    }
    try {
      await completeSqliteContinuation(
        dependencies,
        value,
        evidence.receipt,
        saga,
        1
      );
      dependencies.onSessionBound?.(value.session, value.id);
    } catch (cause) {
      if ((cause as { status?: unknown })?.status === "outcome_unknown") continue;
      const reason = cause instanceof Error ? cause.message : String(cause);
      await dependencies.homes.isolateCommittedCreation(
        pending.chatId,
        pending.homeIntentId,
        reason
      );
      await dependencies.store.isolateContinuationOrphan(
        pending.sagaId,
        `${pending.sagaId}_startup_isolate`,
        reason,
        Date.now()
      );
    }
  }
}
