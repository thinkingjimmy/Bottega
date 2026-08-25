/**
 * [INPUT]: Depends on RelayLedger, Chat Service, raw submission resume/failed outcome, notice outbox, CreateIntent saga and answered relay
 * [OUTPUT]: Provides reconcileCoordinator, first upgrades prepared/replaces raw reservation, and returns the determined failed column to recoverable terminal mode, then restores the other saga
 * [POS]: The restore unit of sections/coordinator starts; To reduce the collapse point to a durable state that can be reset or operated
 */

import type { ChatMessage } from "../../../../shared/chats-ipc";
import type { TrustedManualTurnSubmission as ManualTurnSubmission } from "../../../../shared/sections-ipc";
import type { ChatsService } from "../../chats/chats-service";
import {
  relayExpectation,
  stableId,
} from "./coordinator-values";
import type { SectionNoticeOutbox } from "./notice-outbox";
import type { RelayLedger, RelayRecord } from "./relay-ledger";

type ReconcileInput = {
  ledger: RelayLedger;
  chats: ChatsService;
  notices: SectionNoticeOutbox;
  finishAnswered(relay: RelayRecord, content: string): Promise<void>;
  resumeCreate(intentId: string): Promise<unknown>;
  resumeSubmission(submission: ManualTurnSubmission): Promise<unknown>;
};

export async function reconcileCoordinator(input: ReconcileInput) {
  await input.ledger.recoverSubmissionReservations();
  for (const submission of await input.ledger.pendingSubmissionReservations()) {
    await input.resumeSubmission(submission).catch(async (cause) => {
      const reason =
        cause instanceof Error ? cause.message : String(cause);
      await input.ledger.failRawSubmissionRecovery({
        intentId: submission.intentId,
        content: submission.content,
        message:
          `启动恢复已停止：${reason}。原提交仍由 main custody 保留，` +
          "可编辑后以新身份重发。",
      });
      input.chats.store.pushWarning(
        `Submission ${submission.intentId} 启动恢复已转 recoverable：${reason}`
      );
    });
  }
  await input.ledger.ensurePausedActions();
  await input.notices.reconcile();
  await reconcileManual(input.ledger, input.chats);
  await reconcileRelays(input);
  await reconcileCreateIntents(input);
}

async function reconcileManual(
  ledger: RelayLedger,
  chats: ChatsService
) {
  for (const intent of Object.values(ledger.snapshot().manualIntents)) {
    if (intent.phase !== "claimed") continue;
    const attempt = intent.attempts.at(-1);
    if (!attempt || attempt.phase === "claimed") {
      await ledger.recoverManualBeforeDispatch(intent.id);
      continue;
    }
    if (attempt.phase === "dispatching" || attempt.phase === "dispatched") {
      // 重启后结果通道已死：dispatched 的 receipt 不等于 result，
      // 与 dispatching 一样归 unknown 对账，禁止原地卡死。
      await ledger.markManualDispatchUnknown(intent.id);
      continue;
    }
    if (attempt.phase !== "result-prepared") continue;
    const outbox = ledger.read(
      (state) => state.manualResultOutbox[intent.id]
    );
    if (!outbox) continue;
    // 前向恢复必须逐 intent 隔离：单个 chat 损坏转 capsule 终态，
    // 不允许拖死整个启动。
    try {
      const message = assistantMessage(outbox.assistantMessage);
      if (message) {
        await chats.appendCanonical(intent.conversationId, message);
      }
      await ledger.persistManualResult(intent.id, true);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      chats.store.pushWarning(
        `Manual result ${intent.id} 前向恢复失败，转重试终态：${reason}`
      );
      await ledger
        .transitionManual(intent.id, "claimed", "failed")
        .catch(() => undefined);
    }
  }
}

async function reconcileRelays(input: ReconcileInput) {
  for (const relay of Object.values(input.ledger.snapshot().relays)) {
    if (relay.deliveryPhase === "answered") {
      await finishPersistedAnswer(input, relay);
      continue;
    }
    if (relay.deliveryPhase === "replyEnqueued") {
      await input.ledger.transition(
        relay.id,
        relayExpectation(relay, "replyEnqueued"),
        { deliveryPhase: "settled", terminalOutcome: "done" }
      );
      continue;
    }
    if (relay.deliveryPhase === "claimed") {
      await reconcileClaimed(input, relay);
    }
  }
}

async function finishPersistedAnswer(
  input: ReconcileInput,
  relay: RelayRecord
) {
  const message = assistantMessage(relay.assistantOutbox?.message);
  if (message) await input.finishAnswered(relay, message.content);
}

async function reconcileClaimed(
  input: ReconcileInput,
  relay: RelayRecord
) {
  const outbox = relay.assistantOutbox;
  const message = assistantMessage(outbox?.message);
  if (outbox?.terminal === "done" && message) {
    await input.chats.appendCanonical(relay.target.chatId, message);
    const answered = await input.ledger.transition(
      relay.id,
      relayExpectation(relay, "claimed"),
      {
        deliveryPhase: "answered",
        terminalOutcome: "done",
        assistantOutbox: { ...outbox, state: "appended" },
      }
    );
    if (answered) await input.finishAnswered(answered, message.content);
    return;
  }
  if (outbox) {
    const settled = await input.ledger.transition(
      relay.id,
      relayExpectation(relay, "claimed"),
      {
        deliveryPhase: "settled",
        terminalOutcome:
          outbox.terminal === "cancelled" ? "cancelled" : "failed",
        replyDisposition: "suppressed",
      }
    );
    if (settled) await input.notices.failure(settled);
    return;
  }
  const attemptNo = relay.attempts.at(-1)!.attemptNo + 1;
  const recovered = await input.ledger.recoverClaimedRelay(
    relay.id,
    relayExpectation(relay, "claimed"),
    {
      requestId: stableId("request", `${relay.id}:attempt:${attemptNo}`),
      assistantMessageId: stableId(
        "assistant",
        `${relay.id}:attempt:${attemptNo}`
      ),
    }
  );
  if (recovered) await input.notices.startup(recovered);
}

async function reconcileCreateIntents(input: ReconcileInput) {
  for (const intent of Object.values(input.ledger.snapshot().createIntents)) {
    if (["done", "failed"].includes(intent.sagaPhase)) continue;
    await input.resumeCreate(intent.id);
  }
}

function assistantMessage(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "role" in value &&
    value.role === "assistant"
  ) {
    return value as ChatMessage;
  }
  return undefined;
}
