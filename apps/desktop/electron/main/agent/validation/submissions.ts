/**
 * [INPUT]: Agent submission contracts and explicit validation dependencies.
 * [OUTPUT]: validateSteerInput, validateHistoryAdoptionSubmission, validateManualTurnSubmission.
 * [POS]: Agent validation submissions boundary; admission and authority checks stay mandatory.
 */
import { z } from "zod";
import { parseAgentSwitchIntent } from "../../../../shared/chat-agent/schema";
import { MESSAGE_BYTE_LIMIT } from "../../../../shared/ipc/content/chats-ipc";
import { incarnationPreconditionSchema, submissionContentV1Schema, workspacePreconditionSchema } from "../../../../shared/content/submission/submission";
import type { ManualTurnPersistence, ManualTurnSubmission } from "../../../../shared/ipc/content/sections-ipc";
import { appendInputSchema, createAppInputSchema, createInputSchema, userMessageEnvelopeSchema } from "../../chats/schema/chat-input";
import type { SteerAdmission } from "../../../../shared/ipc/agent/agent-ipc";
import type { HistoryAdoptionSubmission } from "../../../../shared/ipc/content/history-import-ipc";
import { ATTACHMENT_PATTERN, assertExactKeys } from "./primitives";
import { parseUserInput, assertDisplayTextConsistency, assertRichInputConsistency, assertAttachmentParity } from "./input";
import { parseAgentPayload } from "./payload";

export function validateSteerInput(
  value: unknown
): asserts value is SteerAdmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("steer 请求格式无效");
  }
  assertExactKeys(
    value,
    [
      "requestId",
      "outboxRef",
      "createdAt",
      "input",
      "displayText",
      "attachmentPayloads",
      "content",
      "workspacePrecondition",
      "userMessage",
    ],
    "SteerAdmission"
  );
  const input = value as Partial<SteerAdmission>;
  if (
    typeof input.requestId !== "string" ||
    !ATTACHMENT_PATTERN.test(input.requestId) ||
    typeof input.outboxRef !== "string" ||
    !ATTACHMENT_PATTERN.test(input.outboxRef) ||
    !input.userMessage ||
    input.userMessage.id !== input.outboxRef ||
    input.userMessage.role !== "user" ||
    input.userMessage.createdAt !== input.createdAt ||
    typeof input.createdAt !== "number" ||
    !Number.isInteger(input.createdAt) ||
    input.createdAt < 0 ||
    typeof input.displayText !== "string" ||
    Buffer.byteLength(input.displayText, "utf8") > MESSAGE_BYTE_LIMIT
  ) {
    throw new Error("SteerAdmission 身份或正文无效");
  }
  const userInput = parseUserInput(input.input);
  const envelope = userMessageEnvelopeSchema.parse({
    message: input.userMessage,
    attachmentPayloads: input.attachmentPayloads,
  });
  const content = submissionContentV1Schema.parse(input.content);
  workspacePreconditionSchema.parse(input.workspacePrecondition);
  assertDisplayTextConsistency(
    envelope.message.content,
    input.displayText,
    content.content.displayText
  );
  assertRichInputConsistency(content, userInput);
  assertAttachmentParity(
    envelope.attachmentPayloads ?? [],
    content.content.files,
    userInput
  );
}

export function validateHistoryAdoptionSubmission(
  value: unknown
): HistoryAdoptionSubmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("续聊首轮载荷无效");
  }
  assertExactKeys(
    value,
    ["input", "displayText", "attachmentPayloads", "content", "planMode"],
    "续聊首轮载荷"
  );
  const raw = value as Partial<HistoryAdoptionSubmission>;
  if (
    typeof raw.displayText !== "string" ||
    Buffer.byteLength(raw.displayText, "utf8") > MESSAGE_BYTE_LIMIT ||
    (raw.planMode !== undefined && typeof raw.planMode !== "boolean")
  ) {
    throw new Error("续聊首轮正文或 Plan 标记无效");
  }
  const input = parseUserInput(raw.input);
  const envelope = userMessageEnvelopeSchema.parse({
    message: {
      id: `user_${"0".repeat(32)}`,
      role: "user",
      content: raw.displayText,
      createdAt: 0,
    },
    attachmentPayloads: raw.attachmentPayloads,
  });
  if (!raw.displayText.trim() && !envelope.attachmentPayloads?.length) {
    throw new Error("续聊首轮必须包含正文或附件");
  }
  const content = submissionContentV1Schema.parse(raw.content);
  assertDisplayTextConsistency(raw.displayText, content.content.displayText);
  assertRichInputConsistency(content, input);
  assertAttachmentParity(
    envelope.attachmentPayloads ?? [],
    content.content.files,
    input
  );
  return {
    input,
    displayText: raw.displayText,
    ...(envelope.attachmentPayloads?.length
      ? { attachmentPayloads: envelope.attachmentPayloads }
      : {}),
    content,
    ...(raw.planMode ? { planMode: true } : {}),
  };
}

export function validateManualTurnSubmission(
  value: unknown
): ManualTurnSubmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("人工 turn submission 无效");
  }
  assertExactKeys(
    value,
    [
      "agentSwitch",
      "expectedAgentRevision",
      "intentId",
      "authenticationRetry",
      "persistence",
      "turn",
      "content",
      "precondition",
      "workspacePrecondition",
    ],
    "人工 turn submission"
  );
  const raw = value as Partial<ManualTurnSubmission>;
  if (
    typeof raw.intentId !== "string" ||
    !ATTACHMENT_PATTERN.test(raw.intentId)
  ) {
    throw new Error("人工 turn intent 格式无效");
  }
  if (raw.authenticationRetry !== undefined && (
    !raw.authenticationRetry || typeof raw.authenticationRetry !== "object" ||
    Object.keys(raw.authenticationRetry).length !== 1 || raw.authenticationRetry.kind !== "retry-authentication"
  )) throw new Error("Invalid authentication retry intent");
  const turn = parseAgentPayload(raw.turn);
  const content = submissionContentV1Schema.parse(raw.content);
  const precondition = incarnationPreconditionSchema.parse(raw.precondition);
  const workspacePrecondition = workspacePreconditionSchema.parse(
    raw.workspacePrecondition
  );
  const persistence = parseManualPersistence(raw.persistence);
  const conversationId =
    persistence.kind === "append"
      ? persistence.input.chatId
      : persistence.input.id;
  if (turn.scope.conversationId !== conversationId) {
    throw new Error("人工 turn scope 与持久化目标不一致");
  }
  if (
    persistence.kind !== "append" &&
    persistence.input.agent !== turn.turnOptions.backend
  ) {
    throw new Error("人工 turn backend 与持久化 Agent 不一致");
  }
  const message =
    persistence.kind === "append"
      ? persistence.input.message
      : persistence.input.firstMessage;
  assertDisplayTextConsistency(message.content, content.content.displayText);
  assertRichInputConsistency(content, turn.input);
  assertAttachmentParity(
    persistence.input.attachmentPayloads ?? [],
    content.content.files,
    turn.input
  );
  if (persistence.kind === "append") {
    if (precondition.kind !== "existing") {
      throw new Error("append 必须携带 existing incarnation precondition");
    }
    return {
      agentSwitch: raw.agentSwitch ? parseAgentSwitchIntent(raw.agentSwitch) : undefined,
      expectedAgentRevision: z.number().int().nonnegative().parse(raw.expectedAgentRevision),
      intentId: raw.intentId,
      ...(raw.authenticationRetry ? { authenticationRetry: { kind: "retry-authentication" as const } } : {}),
      persistence: {
        kind: "append",
        input: { ...persistence.input, precondition },
      },
      turn,
      content,
      precondition,
      workspacePrecondition,
    };
  }
  if (
    precondition.kind !== "absent" ||
    persistence.input.incarnationId !== precondition.proposedIncarnationId
  ) {
    throw new Error("create incarnation precondition 与持久化身份不一致");
  }
  return {
    intentId: raw.intentId,
      ...(raw.authenticationRetry ? { authenticationRetry: { kind: "retry-authentication" as const } } : {}),
    persistence,
    turn,
    content,
    precondition,
    workspacePrecondition,
  };
}

function parseManualPersistence(value: unknown): ManualTurnPersistence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("人工 turn persistence 无效");
  }
  assertExactKeys(value, ["kind", "input"], "人工 turn persistence");
  const raw = value as { kind?: unknown; input?: unknown };
  if (raw.kind === "create") {
    return { kind: "create", input: createInputSchema.parse(raw.input) };
  }
  if (raw.kind === "create-app") {
    return {
      kind: "create-app",
      input: createAppInputSchema.parse(raw.input),
    };
  }
  if (raw.kind === "append") {
    return { kind: "append", input: appendInputSchema.parse(raw.input) };
  }
  throw new Error("人工 turn persistence kind 无效");
}
