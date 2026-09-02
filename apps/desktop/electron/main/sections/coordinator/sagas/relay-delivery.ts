/**
 * [INPUT]: Depends on RelayLedger, ChatService, SettingsStore, notice outbox and the Agent turn to start playback with support for TurnOrigin
 * [OUTPUT]: Provides deliverRelaySaga, queued→appended→claimed→started
 * [POS]: coordinator/sagas relay side effects organizer; The chain mutex is held by the caller, and the file only shows the durable head
 */

import type {
  AgentSendPayload,
  AgentUserInput,
} from "../../../../../shared/agent-ipc";
import type { UnsequencedUserMessage } from "../../../../../shared/chats-ipc";
import type { ChatsService } from "../../../chats/chats-service";
import type { SettingsStore } from "../../../settings-store";
import {
  recoveryInput,
  relayExpectation,
  relayInputText,
} from "../coordinator-values";
import type { SectionNoticeOutbox } from "../notice-outbox";
import type { RelayLedger } from "../relay-ledger";
import type { TurnOrigin } from "../../../agent/bridge-types";

type RelayDeliveryDependencies = {
  ledger: RelayLedger;
  chats: ChatsService;
  settings: SettingsStore;
  notices: SectionNoticeOutbox;
  startTurn(
    payload: AgentSendPayload,
    assistantMessageId: string,
    origin: TurnOrigin,
    assistantSeq: number
  ): Promise<void>;
};

export async function deliverRelaySaga(
  relayId: string,
  dependencies: RelayDeliveryDependencies
) {
  let relay = dependencies.ledger.snapshot().relays[relayId];
  if (!relay || !["queued", "appended"].includes(relay.deliveryPhase)) return;
  const [source, target] = await Promise.all([
    Promise.resolve(dependencies.chats.store.getMetadata(relay.source.chatId)),
    Promise.resolve(dependencies.chats.store.getMetadata(relay.target.chatId)),
  ]);
  if (
    !source ||
    !target ||
    source.incarnationId !== relay.source.incarnationId ||
    target.incarnationId !== relay.target.incarnationId
  ) {
    await dependencies.ledger.releaseRelay(
      relay.id,
      relayExpectation(relay),
      "cancelled"
    );
    return;
  }
  if (relay.userSeq === undefined || relay.assistantSeq === undefined) {
    const [userSeq, assistantSeq] =
      await dependencies.chats.store.reserveSequences(target.id, 2);
    const sequenced = await dependencies.ledger.bindRelaySequences(
      relay.id,
      userSeq!,
      assistantSeq!
    );
    if (!sequenced) return;
    relay = sequenced;
  }
  if (relay.deliveryPhase === "queued") {
    if (!await dependencies.chats.store.getNativeMessage(target.id, {
      kind: "id",
      messageId: relay.userMessageId,
    })) {
      const message: UnsequencedUserMessage = {
        id: relay.userMessageId,
        role: "user",
        content: relayInputText(relay, source.title ?? "未命名"),
        createdAt: Date.now(),
        relay: {
          sourceSectionId: source.id,
          chainId: relay.rootChainId,
        },
      };
      await dependencies.chats.appendCanonical(
        target.id,
        message,
        relay.userSeq
      );
    }
    const appended = await dependencies.ledger.transition(
      relay.id,
      relayExpectation(relay, "queued"),
      { deliveryPhase: "appended" }
    );
    if (!appended) return;
    relay = appended;
  }
  const attempts = structuredClone(relay.attempts);
  attempts.at(-1)!.reservationState = "charged";
  const claimed = await dependencies.ledger.transition(
    relay.id,
    relayExpectation(relay, "appended"),
    {
      deliveryPhase: "claimed",
      reservationState: "charged",
      attempts,
    }
  );
  if (!claimed) return;
  try {
    const latestTarget = dependencies.chats.store.getMetadata(target.id);
    if (!latestTarget) throw new Error("目标 Section 在 claim 后被删除");
    const turnOptions = await dependencies.settings.resolveChatOptions(
      { conversationId: target.id },
      target.agent
    );
    const currentInput: AgentUserInput[] = [{
      type: "text",
      text: relayInputText(claimed, source.title ?? "未命名"),
    }];
    const intent = Object.values(
      dependencies.ledger.snapshot().createIntents
    ).find(
      (candidate) => candidate.mode === "run" && candidate.relayId === claimed.id
    );
    for (const context of intent?.contextSections ?? []) {
      const record = dependencies.chats.store.getMetadata(context.chatId);
      if (record?.incarnationId === context.incarnationId) {
        currentInput.push({
          type: "section",
          chatId: record.id,
          name: record.title ?? "未命名",
        });
      }
    }
    const messages = latestTarget.session
      ? null
      : await dependencies.chats.store.getNativeMessages(target.id);
    if (!latestTarget.session && !messages) {
      throw new Error("目标 Section 的 canonical context 缺失");
    }
    const payload: AgentSendPayload = {
      requestId: claimed.requestId,
      ...(latestTarget.session ? { session: latestTarget.session } : {}),
      scope: { conversationId: target.id },
      turnOptions,
      input: latestTarget.session
        ? currentInput
        : recoveryInput(
            messages!,
            currentInput,
            claimed.userMessageId
          ),
    };
    await dependencies.startTurn(
      payload,
      claimed.assistantMessageId,
      { kind: "relay" },
      claimed.assistantSeq!
    );
  } catch (cause) {
    const settled = await dependencies.ledger.transition(
      claimed.id,
      relayExpectation(claimed, "claimed"),
      {
        deliveryPhase: "settled",
        terminalOutcome: "failed",
        replyDisposition: "suppressed",
      }
    );
    if (settled) await dependencies.notices.failure(settled);
    throw cause;
  }
}
