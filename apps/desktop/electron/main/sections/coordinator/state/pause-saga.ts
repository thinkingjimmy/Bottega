/**
 * [INPUT]: Depends on shared typed notice/action, stableId and relay/outbox structure of the ledger
 * [OUTPUT]: Provides action schema containing settledAt, atom freezePause, end/expired action with canonical notice
 * [POS]: PauseSaga pure state unit of coordinator/state; Suspend facts, button facts and notice outbox in a ledger commit
 */

import { z } from "zod";
import {
  isActionableNotice,
  noticeMessageContent,
  type NoticeChatMessage,
} from "../../../../../shared/chats-ipc";
import type {
  RelayActionSnapshot,
  RelayActionState,
} from "../../../../../shared/sections-ipc";
import { stableId } from "../coordinator-values";

export const relayActionSchema = z
  .object({
    actionId: z.string().min(1).max(128),
    rootChainId: z.string().min(1).max(128),
    pauseEpoch: z.number().int().nonnegative(),
    pendingCount: z.number().int().positive(),
    state: z.enum(["active", "continued", "discarded", "expired"]),
    settledAt: z.number().int().nonnegative().optional(),
  })
  .strict();

export type RelayActionRecord = z.infer<typeof relayActionSchema>;

type PauseRelay = {
  id: string;
  rootChainId: string;
  source: { chatId: string };
  target: { chatId: string };
  createdAt: number;
  pauseEpoch: number;
  reservationState: "waiting" | "held" | "charged" | "released";
  attempts: Array<{ attemptNo: number }>;
};

type PauseState = {
  relays: Record<string, PauseRelay>;
  actions: Record<string, RelayActionRecord>;
  noticeOutbox: Record<
    string,
    {
      id: string;
      chatId: string;
      message: unknown;
      state: "pending" | "appended";
    }
  >;
};

export function freezePause(
  state: PauseState,
  relay: PauseRelay,
  kind: "chain-paused" | "startup-recovered",
  now = Date.now()
) {
  expireActiveActions(state, relay.rootChainId, relay.pauseEpoch, now);
  const actionId = stableId(
    "action",
    `${relay.rootChainId}:${relay.pauseEpoch}`
  );
  const existing = state.actions[actionId];
  if (existing) return existing;
  const priorOutboxes = Object.values(state.noticeOutbox).filter((outbox) => {
    const message = outbox.message as Partial<NoticeChatMessage>;
    return (
      message.role === "notice" &&
      isActionableNotice(message.notice) &&
      message.notice.actionId === actionId
    );
  });
  const priorMessage = priorOutboxes[0]?.message as
    | Partial<NoticeChatMessage>
    | undefined;
  const pendingCount = isActionableNotice(priorMessage?.notice)
    ? priorMessage!.notice!.pendingCount
    : Object.values(state.relays).filter(
    (candidate) =>
      candidate.rootChainId === relay.rootChainId &&
      candidate.reservationState === "waiting"
      ).length;
  if (pendingCount === 0) {
    throw new Error("没有 waiting relay，不能创建暂停 action");
  }
  const action = relayActionSchema.parse({
    actionId,
    rootChainId: relay.rootChainId,
    pauseEpoch: relay.pauseEpoch,
    pendingCount,
    state: "active",
  });
  state.actions[actionId] = action;
  const chatIds =
    kind === "startup-recovered"
      ? [relay.target.chatId]
      : [...new Set([relay.source.chatId, relay.target.chatId])];
  const createdAt =
    typeof priorMessage?.createdAt === "number"
      ? priorMessage.createdAt
      : now;
  for (const chatId of chatIds) {
    const notice = {
      kind,
      rootChainId: relay.rootChainId,
      pauseEpoch: relay.pauseEpoch,
      actionId,
      pendingCount,
    };
    const prior = priorOutboxes.find((outbox) => outbox.chatId === chatId);
    if (prior) continue;
    const message: Omit<NoticeChatMessage, "seq"> = {
      id:
        kind === "startup-recovered"
          ? stableId("notice", `startup:${chatId}:${relay.id}:${actionId}`)
          : stableId("notice", `${chatId}:${actionId}`),
      role: "notice",
      content: noticeMessageContent(notice),
      notice,
      createdAt,
    };
    state.noticeOutbox[message.id] = {
      id: message.id,
      chatId,
      message,
      state: "pending",
    };
  }
  return action;
}

export function settleAction(
  state: Pick<PauseState, "actions">,
  rootChainId: string,
  pauseEpoch: number,
  result: Extract<RelayActionState, "continued" | "discarded">,
  now = Date.now()
) {
  const actionId = stableId("action", `${rootChainId}:${pauseEpoch}`);
  const action = state.actions[actionId];
  if (action?.state === "active") {
    action.state = result;
    action.settledAt = now;
  }
}

export function actionSnapshot(
  actions: Record<string, RelayActionRecord>
): Record<string, RelayActionSnapshot> {
  return structuredClone(actions);
}

function expireActiveActions(
  state: Pick<PauseState, "actions">,
  rootChainId: string,
  currentEpoch: number,
  now: number
) {
  for (const action of Object.values(state.actions)) {
    if (
      action.rootChainId === rootChainId &&
      action.pauseEpoch !== currentEpoch &&
      action.state === "active"
  ) {
      action.state = "expired";
      action.settledAt = now;
    }
  }
}
