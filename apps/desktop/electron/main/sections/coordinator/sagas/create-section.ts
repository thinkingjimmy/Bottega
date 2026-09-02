/**
 * [INPUT]: Depends on RelayLedger CreateIntent, unkeyed universal Workspace lifecycle/external qualification ports, ChatsService canonical ensure, notice outbox and scheduler kick
 * [OUTPUT]: Provides resumeCreateSectionSaga, validates caller/external qualification within the same Project gate and performs chat→relay→result in the persistent phase
 * [POS]: CreateIntent side effects coder for coordinator/sagas; Retrieval perIOd qualification drift receives the receiver as rejected, temporary IO error remains replaceable
 */

import { createHash } from "node:crypto";
import type { UnsequencedUserMessage } from "../../../../../shared/chats-ipc";
import type { ChatsService } from "../../../chats/chats-service";
import type { SectionNoticeOutbox } from "../notice-outbox";
import type {
  CreateIntent,
  RelayLedger,
  RelayRecord,
} from "../relay-ledger";

type CreateSagaDependencies = {
  ledger: RelayLedger;
  chats: ChatsService;
  notices: SectionNoticeOutbox;
  isExternalProject?(projectId: string): boolean;
  withWorkspaceLifecycle?<T>(task: () => Promise<T>): Promise<T>;
  kick(conversationId: string): void;
};

export async function resumeCreateSectionSaga(
  intentId: string,
  dependencies: CreateSagaDependencies,
  projectAdmissionHeld = false
): Promise<NonNullable<CreateIntent["sagaResult"]>> {
  let intent = dependencies.ledger.snapshot().createIntents[intentId];
  if (!intent) throw new Error("CreateIntent 不存在");
  if (intent.projectId && !projectAdmissionHeld) {
    if (!dependencies.withWorkspaceLifecycle) {
      throw new Error("Project lifecycle gate 不可用，拒绝恢复 Project Section");
    }
    return dependencies.withWorkspaceLifecycle(() =>
      resumeCreateSectionSaga(intentId, dependencies, true)
    );
  }
  const relay = intent.mode === "run"
    ? dependencies.ledger.snapshot().relays[intent.relayId]
    : undefined;
  if (intent.mode === "run" && !relay) {
    throw new Error("CreateIntent 的原子 relay 缺失，拒绝伪造补偿");
  }
  if (intent.sagaResult) {
    await projectCreateResult(intent, relay, dependencies);
    return intent.sagaResult;
  }
  if (intent.projectId) {
    const source = dependencies.chats.store.getMetadata(intent.source.chatId);
    if (
      source?.incarnationId !== intent.source.incarnationId ||
      source.projectId !== intent.projectId ||
      !dependencies.isExternalProject?.(intent.projectId)
    ) {
      if (intent.sagaPhase !== "validated") {
        throw new Error("CreateIntent 已产生副作用后 Project 资格漂移，拒绝继续");
      }
      const failed = await dependencies.ledger.transitionCreateIntent(
        intent.id,
        "validated",
        {
          sagaPhase: "failed",
          sagaResult: { sectionId: intent.sectionId, firstTurn: "rejected" },
        }
      );
      if (!failed?.sagaResult) throw new Error("CreateIntent 资格失败未能落盘");
      return failed.sagaResult;
    }
  }
  const firstMessages: UnsequencedUserMessage[] = intent.mode === "run"
    ? [{
        id: intent.firstMessageId,
        role: "user",
        content: intent.firstMessage,
        createdAt: intent.createdAt,
        relay: {
          sourceSectionId: intent.source.chatId,
          chainId: intent.rootChainId,
        },
      }]
    : intent.messages.map((content, index) => ({
        id: stableSeedMessageId(intent.id, index),
        role: "user" as const,
        content,
        createdAt: intent.createdAt + index,
      }));
  await dependencies.chats.createSection({
    intentId: intent.id,
    id: intent.sectionId,
    incarnationId: intent.incarnationId,
    agent: intent.agent,
    ...(intent.title ? { title: intent.title } : {}),
    ...(intent.projectId ? { projectId: intent.projectId } : {}),
    projectAdmissionHeld,
    firstMessages,
  });
  if (intent.sagaPhase === "validated") {
    await dependencies.ledger.transitionCreateIntent(
      intent.id,
      "validated",
      { sagaPhase: "chatCreated" }
    );
  }
  intent = dependencies.ledger.snapshot().createIntents[intentId]!;
  if (intent.sagaPhase === "chatCreated") {
    if (intent.mode === "seed") {
      await dependencies.ledger.transitionCreateIntent(
        intent.id,
        "chatCreated",
        {
          sagaPhase: "done",
          sagaResult: { sectionId: intent.sectionId, firstTurn: "idle" },
        }
      );
    } else {
      if (
        relay!.target.chatId !== intent.sectionId ||
        relay!.target.incarnationId !== intent.incarnationId
      ) {
        throw new Error("CreateIntent 与原子 relay target 冲突");
      }
      await dependencies.ledger.transitionCreateIntent(
        intent.id,
        "chatCreated",
        { sagaPhase: "relayAdmitted" }
      );
    }
  }
  intent = dependencies.ledger.snapshot().createIntents[intentId]!;
  if (intent.sagaPhase === "relayAdmitted") {
    const firstTurn =
      relay!.reservationState === "waiting" ? "paused" : "started";
    await dependencies.ledger.transitionCreateIntent(
      intent.id,
      "relayAdmitted",
      {
        sagaPhase: "done",
        sagaResult: { sectionId: intent.sectionId, firstTurn },
      }
    );
  }
  intent = dependencies.ledger.snapshot().createIntents[intentId]!;
  const result = intent.sagaResult;
  if (!result) throw new Error("CreateIntent 未能收敛到 durable result");
  await projectCreateResult(intent, relay, dependencies);
  return result;
}

async function projectCreateResult(
  intent: CreateIntent,
  relay: RelayRecord | undefined,
  dependencies: CreateSagaDependencies
) {
  const result = intent.sagaResult;
  if (!result) throw new Error("CreateIntent 缺少 durable result");
  /* idle 是 seed 的终态，run 分支只会收敛到 started/paused/rejected——
     判别式已经问完了这件事，再析取一次 firstTurn 就是同一个问题问两遍。 */
  if (intent.mode === "seed") return;
  if (!relay) throw new Error("run CreateIntent 缺少 relay");
  if (result.firstTurn === "paused") {
    await dependencies.notices.appendPause(relay);
  } else if (result.firstTurn === "started") {
    dependencies.kick(intent.sectionId);
  }
}

function stableSeedMessageId(intentId: string, index: number) {
  return `seed_${createHash("sha256")
    .update(`seed-message\0${intentId}:${index}`)
    .digest("hex")
    .slice(0, 32)}`;
}
