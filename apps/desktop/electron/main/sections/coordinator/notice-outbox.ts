/**
 * [INPUT]: Depends on RelayLedger notice outbox, ChatsService canonical append with typed notice schema
 * [OUTPUT]: Provides pending notice Restore/open flush, atomic suspension action flush, relay Failure to start and restore notice
 * [POS]: the sections/coordinator's notification side effects executor; Consume only the freeze-in ledger canonical outbox, and then add/ack
 */

import {
  isActionableNotice,
  noticeMessageContent,
  type ChatMessage,
  type NoticeChatMessage,
  type UnsequencedChatMessage,
} from "../../../../shared/chats-ipc";
import type { ChatsService } from "../../chats/chats-service";
import { stableId } from "./coordinator-values";
import type { RelayLedger, RelayRecord } from "./relay-ledger";

export class SectionNoticeOutbox {
  constructor(
    private readonly ledger: RelayLedger,
    private readonly chats: ChatsService
  ) {}

  async reconcile() {
    const outboxes = this.ledger.read((state) =>
      structuredClone(Object.values(state.noticeOutbox))
    );
    for (const outbox of outboxes) {
      if (outbox.state !== "pending") continue;
      await this.flushPending(outbox.id);
    }
  }

  async appendPause(relay: RelayRecord) {
    const actionId = stableId(
      "action",
      `${relay.rootChainId}:${relay.pauseEpoch}`
    );
    await this.flushAction(actionId);
  }

  failure(relay: RelayRecord) {
    const notice = {
      kind: "relay-failed" as const,
      rootChainId: relay.rootChainId,
      relayId: relay.id,
    };
    return this.append(relay.source.chatId, {
      id: stableId("notice", `failed:${relay.source.chatId}:${relay.id}`),
      role: "notice",
      content: noticeMessageContent(notice),
      notice,
      createdAt: Date.now(),
    });
  }

  startup(relay: RelayRecord) {
    return this.flushAction(
      stableId("action", `${relay.rootChainId}:${relay.pauseEpoch}`)
    );
  }

  private async flushAction(actionId: string) {
    const outboxes = this.ledger.read((state) =>
      structuredClone(Object.values(state.noticeOutbox).filter((outbox) => {
        const message = outbox.message as Partial<NoticeChatMessage>;
        return (
          message.role === "notice" &&
          isActionableNotice(message.notice) &&
          message.notice.actionId === actionId
        );
      }))
    );
    if (outboxes.length === 0) {
      throw new Error("暂停 action 缺少 canonical notice outbox");
    }
    await Promise.all(
      outboxes.map((outbox) => this.flushPending(outbox.id))
    );
  }

  async flushPending(outboxId: string) {
    const outbox = this.ledger.read((state) =>
      state.noticeOutbox[outboxId]
        ? structuredClone(state.noticeOutbox[outboxId])
        : undefined
    );
    if (!outbox || outbox.state === "appended") return;
    await this.chats.appendCanonical(
      outbox.chatId,
      outbox.message as ChatMessage | UnsequencedChatMessage
    );
    await this.ledger.acknowledgeNotice(outbox.id);
  }

  private async append(chatId: string, message: UnsequencedChatMessage) {
    const outbox = await this.ledger.putNoticeOutbox({
      id: message.id,
      chatId,
      message,
      state: "pending",
    });
    const canonical = outbox.message as UnsequencedChatMessage;
    await this.chats.appendCanonical(chatId, canonical);
    await this.ledger.acknowledgeNotice(outbox.id);
    return canonical;
  }
}
