/**
 * [INPUT]: Depends on Node crypto plus Agent/Chat IPC, shared submission error codes, built-in MCP context, and coordinator ledger records
 * [OUTPUT]: Provides canonical hashes, deterministic IDs, coded submission errors, raw/admitted submission residence, chain/ref values, and relay inputs
 * [POS]: Pure value layer for sections/coordinator, keeping testable formatting and lookup rules outside ConversationCoordinator scheduling
 */

import { createHash } from "node:crypto";
import type { SubmissionErrorCode } from "../../../../shared/submission";
import type { BuiltinToolContext } from "../../tools/registry";
import type {
  RelayExpectation,
  RelayRecord,
  SectionRef,
} from "./relay-ledger";
import type { LedgerState } from "./state/ledger-schema";

export function coordinatorResidenceIndex(state: LedgerState) {
  return {
    manualRequest: (requestId: string) =>
      Object.values(state.manualIntents).find(
        (candidate) => candidate.requestId === requestId
      )?.conversationId,
    intent: (intentId: string) =>
      state.manualIntents[intentId]?.conversationId ??
      state.submissionOutcomes[intentId]?.conversationId ??
      state.submissionReservations[intentId]?.conversationId,
    relayRequest: (requestId: string) =>
      Object.values(state.relays).find(
        (candidate) => candidate.requestId === requestId
      )?.target.chatId,
    action: (actionId: string) => {
      const rootChainId = state.actions[actionId]?.rootChainId;
      if (!rootChainId) return [];
      return [...new Set(
        Object.values(state.relays)
          .filter((relay) => relay.rootChainId === rootChainId)
          .flatMap((relay) => [relay.source.chatId, relay.target.chatId])
      )];
    },
    steerOutbox: (outboxRef: string) =>
      state.steerIntents[outboxRef]?.conversationId,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)])
  );
}

export function canonicalHash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function stableId(prefix: string, value: string) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

export function codedError(code: SubmissionErrorCode) {
  return Object.assign(new Error(code), { code });
}

export function rootChainId(context: BuiltinToolContext) {
  return stableId(
    "chain",
    `${context.lease.requestId}:${context.lease.generation}`
  );
}

export function sectionRef(record: {
  id: string;
  incarnationId: string;
}): SectionRef {
  return { chatId: record.id, incarnationId: record.incarnationId };
}

export function relayExpectation(
  relay: RelayRecord,
  deliveryPhase: RelayExpectation["deliveryPhase"] = relay.deliveryPhase
): RelayExpectation {
  return {
    deliveryPhase,
    pauseEpoch: relay.pauseEpoch,
    attemptNo: relay.attempts.at(-1)!.attemptNo,
    source: relay.source,
    target: relay.target,
  };
}

export function relayInputText(relay: RelayRecord, sourceTitle: string) {
  const escaped = sourceTitle.replaceAll(/[\r\n<>]/g, " ");
  const instruction = relay.expectReply
    ? "正常回答即可；你的最终回答会自动送回来源，请勿手动回信。"
    : `如需回信，请用 send_to_section 指向 ${relay.source.chatId}。`;
  return `【来自 Section @${escaped}（source_section_id=${relay.source.chatId}）】\n${instruction}\n\n${relay.message}`;
}
