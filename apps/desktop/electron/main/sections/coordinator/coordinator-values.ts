/**
 * [INPUT]: Depends on Node crypto plus Agent/Chat IPC, built-in MCP context, and coordinator ledger records
 * [OUTPUT]: Provides canonical hashes, deterministic IDs, chain/ref values, relay inputs, and byte-exact structured session recovery
 * [POS]: Pure value layer for sections/coordinator, keeping testable formatting and lookup rules outside ConversationCoordinator scheduling
 */

import { createHash } from "node:crypto";
import type { AgentUserInput } from "../../../../shared/agent-ipc";
import { MESSAGE_BYTE_LIMIT, type ChatMessage } from "../../../../shared/chats-ipc";
import { CHAT_MESSAGE_LIMIT } from "../../chats/chat-schema";
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
      state.submissionOutcomes[intentId]?.conversationId,
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

export type RecoveryPolicy = Readonly<{
  maxMessages: number;
  maxHistoryBytes: number;
  maxFinalTextBytes: number;
}>;

export const DEFAULT_RECOVERY_POLICY: RecoveryPolicy = {
  maxMessages: 24,
  maxHistoryBytes: 24 * 1024,
  maxFinalTextBytes: MESSAGE_BYTE_LIMIT,
};

export const FORK_RECOVERY_POLICY: RecoveryPolicy = {
  maxMessages: CHAT_MESSAGE_LIMIT,
  maxHistoryBytes: MESSAGE_BYTE_LIMIT,
  maxFinalTextBytes: MESSAGE_BYTE_LIMIT,
};

const utf8Bytes = (value: string) => Buffer.byteLength(value, "utf8");
const RECOVERY_PREFIX = "以下是此前已落盘对话：\n<transcript>\n";
const RECOVERY_SUFFIX = "\n</transcript>\n\n新消息如下：";
const RECOVERY_TRUNCATED = "…[已截断]";

function utf8Prefix(value: string, byteLimit: number) {
  if (byteLimit <= 0) return "";
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= byteLimit) return value;
  let end = byteLimit;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

export function recoveryInput(
  messages: ChatMessage[],
  current: AgentUserInput[],
  excludeMessageId?: string,
  policy: RecoveryPolicy = DEFAULT_RECOVERY_POLICY
) {
  const eligible = messages
    .filter(
      (message) =>
        message.role !== "notice" && message.id !== excludeMessageId
    );
  const candidates = eligible.slice(-policy.maxMessages);
  const currentBytes = current.reduce(
    (total, item) => total + (item.type === "text" ? utf8Bytes(item.text) : 0),
    0
  );
  const wrapperBytes = utf8Bytes(RECOVERY_PREFIX) + utf8Bytes(RECOVERY_SUFFIX);
  const transcriptBudget = Math.max(
    0,
    Math.min(
      policy.maxHistoryBytes,
      policy.maxFinalTextBytes - currentBytes - wrapperBytes
    )
  );
  const selected: Array<{ message: ChatMessage; line: string }> = [];
  let used = 0;
  let shortened = false;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const message = candidates[index]!;
    const line = `${message.role}: ${message.content}`;
    const separator = selected.length ? 2 : 0;
    const bytes = utf8Bytes(line);
    if (used + separator + bytes <= transcriptBudget) {
      selected.unshift({ message, line });
      used += separator + bytes;
      continue;
    }
    if (selected.length === 0) {
      const markerBytes = utf8Bytes(RECOVERY_TRUNCATED);
      const prefix = utf8Prefix(line, transcriptBudget - markerBytes);
      if (prefix && utf8Bytes(prefix) + markerBytes <= transcriptBudget) {
        selected.unshift({ message, line: `${prefix}${RECOVERY_TRUNCATED}` });
        shortened = true;
      }
    }
    break;
  }
  const transcript = selected.map((entry) => entry.line).join("\n\n");
  const input = transcript
    ? [
        {
          type: "text" as const,
          text: `${RECOVERY_PREFIX}${transcript}${RECOVERY_SUFFIX}`,
        },
        ...current,
      ]
    : current;
  return { input, truncated: eligible.length > selected.length || shortened };
}
