/**
 * [INPUT]: Depends on shared Agent limits/contracts, strict RichValue/SubmissionContentV1, chat user envelopes, and backend descriptors
 * [OUTPUT]: Provides strict payload reconstruction and cross-field validation for Agent/manual/steer/adopt paths, including message-or-attachments adoption semantics
 * [POS]: The first main-process trust boundary for Agent and coordinator IPC
 */

import {
  AGENT_BACKEND_ORDER,
  AGENT_INPUT_LIMIT,
  ATTACHMENT_BYTE_LIMIT,
  ATTACHMENT_FILENAME_BYTE_LIMIT,
  ATTACHMENT_LIMIT,
  OPAQUE_REF_BYTE_LIMIT,
  SECTION_INPUT_LIMIT,
  SESSION_ID_BYTE_LIMIT,
  dataUrlByteSize,
  isValidImageDataUrl,
} from "../../shared/agent-ipc";
import {
  MESSAGE_BYTE_LIMIT,
  type ChatAttachmentPayload,
} from "../../shared/chats-ipc";
import {
  incarnationPreconditionSchema,
  submissionContentV1Schema,
  workspacePreconditionSchema,
  type SubmissionContentV1,
} from "../../shared/submission";
import {
  projectRichInput,
  richInputDisplayText,
  type RichInputAgentInput,
} from "../../shared/rich-input-projection";
import type {
  ManualTurnPersistence,
  ManualTurnSubmission,
} from "../../shared/sections-ipc";
import { CHAT_ID_PATTERN } from "./chats/chat-schema";
import {
  appendInputSchema,
  createAppInputSchema,
  createInputSchema,
  userMessageEnvelopeSchema,
} from "./chats/chat-input";
import type {
  AgentBackendId,
  AgentPermissionMode,
  AgentSendPayload,
  AgentTurnOptions,
  AgentUserInput,
  SteerAdmission,
  AgentUserInputResponse,
} from "../../shared/agent-ipc";
import type { HistoryAdoptionSubmission } from "../../shared/history-import-ipc";
import { backendRegistry } from "./backends";

const CONVERSATION_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const ATTACHMENT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const BACKENDS = new Set<string>(AGENT_BACKEND_ORDER);
const SESSION_PATTERN = /^[A-Za-z0-9._:/-]+$/;
const USER_INPUT_TEXT_LIMIT = 8 * 1024;
const USER_INPUT_ANSWER_LIMIT = 8;

function assertExactKeys(
  value: object,
  allowed: readonly string[],
  label: string
) {
  const expected = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  if (unknown.length) {
    throw new Error(`${label} 含未知字段：${unknown.join(", ")}`);
  }
}

export function assertConversationId(value: unknown) {
  if (typeof value !== "string" || !CONVERSATION_PATTERN.test(value)) {
    throw new Error("conversationId 格式无效");
  }
  return value;
}

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

/* ── 外源续聊首轮：与 steer 同一套一致性断言 ────────────────────────
 * adopt 的身份部分（chatId/session/importOrigin/persistence）由 main 独占
 * 构造，renderer 递来的只有「这一句要发什么」。那部分与产品首轮逐字段同形，
 * 因此校验也必须逐字段同严——三条断言缺一条，adopt 就成了绕开 manual route
 * 的一扇偏门：input 与 content 可以各说各话，附件可以只在一侧存在。
 * ────────────────────────────────────────────────────────── */
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

/** renderer manual route 的完整 fail-closed 边界；返回去除顶层未知键的 canonical envelope。 */
export function validateManualTurnSubmission(
  value: unknown
): ManualTurnSubmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("人工 turn submission 无效");
  }
  assertExactKeys(
    value,
    [
      "intentId",
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
      intentId: raw.intentId,
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

export function validateAgentPayload(
  value: unknown
): asserts value is AgentSendPayload {
  parseAgentPayload(value);
}

function parseAgentPayload(value: unknown): AgentSendPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("请求格式无效");
  }
  assertExactKeys(
    value,
    ["requestId", "session", "scope", "turnOptions", "planMode", "input"],
    "Agent payload"
  );
  const payload = value as Partial<AgentSendPayload>;
  if (
    typeof payload.requestId !== "string" ||
    !ATTACHMENT_PATTERN.test(payload.requestId)
  ) {
    throw new Error("requestId 格式无效");
  }
  if (!payload.scope || typeof payload.scope !== "object") {
    throw new Error("Conversation scope 格式无效");
  }
  assertExactKeys(payload.scope, ["conversationId"], "Conversation scope");
  if (!CONVERSATION_PATTERN.test(payload.scope.conversationId ?? "")) {
    throw new Error("Conversation scope 格式无效");
  }
  const conversationId = payload.scope.conversationId!;
  const input = parseUserInput(payload.input, conversationId);
  if (payload.planMode !== undefined && typeof payload.planMode !== "boolean") {
    throw new Error("Plan 模式格式无效");
  }
  const turnOptions = validateAgentTurnOptions(payload.turnOptions);
  let session: AgentSendPayload["session"];
  if (payload.session !== undefined) {
    if (
      !payload.session ||
      typeof payload.session !== "object" ||
      Array.isArray(payload.session)
    ) {
      throw new Error("session 格式无效");
    }
    assertExactKeys(payload.session, ["backend", "id", "toolPlan"], "session");
    if (
      !BACKENDS.has(payload.session.backend ?? "") ||
      typeof payload.session.id !== "string" ||
      !SESSION_PATTERN.test(payload.session.id) ||
      Buffer.byteLength(payload.session.id, "utf8") > SESSION_ID_BYTE_LIMIT ||
      payload.session.backend !== turnOptions.backend
    ) {
      throw new Error("session 格式无效");
    }
    const toolPlan = payload.session.toolPlan;
    if (
      toolPlan !== undefined &&
      (!toolPlan ||
        typeof toolPlan !== "object" ||
        Array.isArray(toolPlan) ||
        Object.keys(toolPlan).some((key) => !["planDigest", "projectId"].includes(key)) ||
        typeof toolPlan.planDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(toolPlan.planDigest) ||
        (toolPlan.projectId !== null &&
          (typeof toolPlan.projectId !== "string" ||
            !CONVERSATION_PATTERN.test(toolPlan.projectId))))
    ) {
      throw new Error("session tool plan binding 无效");
    }
    session = {
      backend: payload.session.backend,
      id: payload.session.id,
      ...(toolPlan
        ? { toolPlan: { planDigest: toolPlan.planDigest, projectId: toolPlan.projectId } }
        : {}),
    };
  }
  return {
    requestId: payload.requestId,
    scope: { conversationId },
    turnOptions,
    input,
    ...(session ? { session } : {}),
    ...(payload.planMode !== undefined ? { planMode: payload.planMode } : {}),
  };
}

export function validateAgentTurnOptions(value: unknown): AgentTurnOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("未知的 Agent 后端");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.backend !== "string" || !BACKENDS.has(raw.backend)) {
    throw new Error("未知的 Agent 后端");
  }
  const backend = raw.backend as AgentBackendId;
  const descriptor = backendRegistry.get(backend)!;
  assertExactKeys(
    value,
    [
      "backend",
      "model",
      "reasoningEffort",
      ...(descriptor.serviceTier ? ["serviceTier"] : []),
      "permissionMode",
    ],
    "Agent turnOptions"
  );
  descriptor.validateTurnOptions(value);
  const permissionMode = raw.permissionMode as AgentPermissionMode;
  /* 必填与可选的差别已由 descriptor.validateTurnOptions 全部说完：codex 缺
     三者任一在上一行就抛掉了，所以这里只剩一条「在场即透传」的投影。多写一
     条按后端字面量分流的返回，第四家来的时候还要再改一次。 */
  return {
    backend,
    ...(typeof raw.model === "string" ? { model: raw.model } : {}),
    ...(typeof raw.reasoningEffort === "string"
      ? { reasoningEffort: raw.reasoningEffort }
      : {}),
    ...(descriptor.serviceTier && typeof raw.serviceTier === "string"
      ? { serviceTier: raw.serviceTier }
      : {}),
    permissionMode,
  } as AgentTurnOptions;
}

function parseUserInput(
  value: unknown,
  conversationId?: string
): AgentUserInput[] {
  if (!Array.isArray(value) || !value.length || value.length > AGENT_INPUT_LIMIT) {
    throw new Error(`结构化输入数量必须为 1-${AGENT_INPUT_LIMIT}`);
  }
  const parsed: AgentUserInput[] = [];
  let textBytes = 0;
  let attachmentCount = 0;
  let meaningful = false;
  let sectionCount = 0;
  for (const item of value as AgentSendPayload["input"]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("结构化输入格式无效");
    }
    if (item.type === "text") {
      assertExactKeys(item, ["type", "text"], "文本输入");
      if (typeof item.text !== "string") throw new Error("文本输入格式无效");
      textBytes += Buffer.byteLength(item.text, "utf8");
      meaningful ||= Boolean(item.text.trim());
      parsed.push({ type: "text", text: item.text });
      continue;
    }
    if (item.type === "image") {
      assertExactKeys(item, ["type", "dataUrl", "filename"], "图片输入");
      attachmentCount += 1;
      if (
        typeof item.filename !== "string" ||
        !item.filename.trim() ||
        Buffer.byteLength(item.filename, "utf8") > ATTACHMENT_FILENAME_BYTE_LIMIT
      ) {
        throw new Error("图片文件名无效");
      }
      if (typeof item.dataUrl !== "string" || !isValidImageDataUrl(item.dataUrl)) {
        throw new Error("图片输入必须是合法的 base64 data URL");
      }
      if (dataUrlByteSize(item.dataUrl) > ATTACHMENT_BYTE_LIMIT) {
        throw new Error("图片附件不能超过 8 MB");
      }
      meaningful = true;
      parsed.push({
        type: "image",
        dataUrl: item.dataUrl,
        filename: item.filename,
      });
      continue;
    }
    if (item.type === "skill") {
      assertExactKeys(item, ["type", "skillRef"], "Skill 输入");
      if (
        typeof item.skillRef !== "string" ||
        !item.skillRef.trim() ||
        Buffer.byteLength(item.skillRef, "utf8") > OPAQUE_REF_BYTE_LIMIT
      ) {
        throw new Error("Skill 引用无效");
      }
      meaningful = true;
      parsed.push({ type: "skill", skillRef: item.skillRef });
      continue;
    }
    if (item.type === "mention") {
      assertExactKeys(item, ["type", "fileRef", "name"], "文件输入");
      attachmentCount += 1;
      if (
        typeof item.fileRef !== "string" ||
        !item.fileRef.trim() ||
        Buffer.byteLength(item.fileRef, "utf8") > OPAQUE_REF_BYTE_LIMIT ||
        typeof item.name !== "string" ||
        !item.name.trim() ||
        Buffer.byteLength(item.name, "utf8") > ATTACHMENT_FILENAME_BYTE_LIMIT
      ) {
        throw new Error("文件引用无效");
      }
      meaningful = true;
      parsed.push({
        type: "mention",
        fileRef: item.fileRef,
        name: item.name,
      });
      continue;
    }
    if (item.type === "section") {
      assertExactKeys(item, ["type", "chatId", "name"], "Section 输入");
      sectionCount += 1;
      if (
        typeof item.chatId !== "string" ||
        !CHAT_ID_PATTERN.test(item.chatId) ||
        item.chatId === conversationId ||
        typeof item.name !== "string" ||
        !item.name.trim() ||
        Buffer.byteLength(item.name, "utf8") >
          ATTACHMENT_FILENAME_BYTE_LIMIT
      ) {
        throw new Error(
          item.chatId === conversationId
            ? "Section 不能引用当前聊天"
            : "Section 引用无效"
        );
      }
      meaningful = true;
      parsed.push({
        type: "section",
        chatId: item.chatId,
        name: item.name,
      });
      continue;
    }
    if (item.type === "history") {
      assertExactKeys(item, ["type", "opaqueId", "name"], "外源历史输入");
      /* 与 section 共享同一引用限额：都是「整段转录注入」级别的重负载 */
      sectionCount += 1;
      if (
        typeof item.opaqueId !== "string" ||
        !/^[a-f0-9]{40}$/.test(item.opaqueId) ||
        typeof item.name !== "string" ||
        !item.name.trim() ||
        Buffer.byteLength(item.name, "utf8") >
          ATTACHMENT_FILENAME_BYTE_LIMIT
      ) {
        throw new Error("外源历史引用无效");
      }
      meaningful = true;
      parsed.push({
        type: "history",
        opaqueId: item.opaqueId,
        name: item.name,
      });
      continue;
    }
    throw new Error("结构化输入格式无效");
  }
  if (textBytes > MESSAGE_BYTE_LIMIT) throw new Error("文本输入不能超过 32 KB");
  if (attachmentCount > ATTACHMENT_LIMIT) {
    throw new Error(`附件数量不能超过 ${ATTACHMENT_LIMIT} 个`);
  }
  if (sectionCount > SECTION_INPUT_LIMIT) {
    throw new Error(`Section 引用不能超过 ${SECTION_INPUT_LIMIT} 个`);
  }
  if (!meaningful) throw new Error("消息不能为空");
  return parsed;
}

function assertDisplayTextConsistency(
  messageContent: string,
  ...displayTexts: string[]
) {
  const canonical = messageContent.trim();
  if (displayTexts.some((value) => value.trim() !== canonical)) {
    throw new Error("用户消息正文与展示正文不一致");
  }
}

function sameRichInputItem(
  expected: RichInputAgentInput,
  delivered: RichInputAgentInput | undefined
) {
  if (expected.type !== delivered?.type) return false;
  if (expected.type === "text") {
    return delivered.type === "text" && delivered.text === expected.text;
  }
  if (expected.type === "skill") {
    return (
      delivered.type === "skill" && delivered.skillRef === expected.skillRef
    );
  }
  if (expected.type === "section") {
    return (
      delivered.type === "section" &&
      delivered.chatId === expected.chatId &&
      delivered.name === expected.name
    );
  }
  if (expected.type === "history") {
    return (
      delivered.type === "history" &&
      delivered.opaqueId === expected.opaqueId &&
      delivered.name === expected.name
    );
  }
  return (
    delivered.type === "mention" &&
    delivered.fileRef === expected.fileRef &&
    delivered.name === expected.name
  );
}

function assertRichInputConsistency(
  content: SubmissionContentV1,
  input: readonly AgentUserInput[]
) {
  const richValue = content.content.richValue;
  if (
    richInputDisplayText(richValue).trim() !==
    content.content.displayText.trim()
  ) {
    throw new Error("富文本展示正文与 content.displayText 不一致");
  }
  const expected = projectRichInput(richValue);
  const delivered = input.filter(
    (item): item is RichInputAgentInput => item.type !== "image"
  );
  if (
    expected.length !== delivered.length ||
    expected.some((item, index) => !sameRichInputItem(item, delivered[index]))
  ) {
    throw new Error("富文本结构化输入与 Agent input 不一致");
  }
}

function assertAttachmentParity(
  payloads: readonly ChatAttachmentPayload[],
  files: SubmissionContentV1["content"]["files"],
  input: readonly AgentUserInput[]
) {
  const images = input.filter(
    (item): item is Extract<AgentUserInput, { type: "image" }> =>
      item.type === "image"
  );
  if (
    files.length !== payloads.length ||
    files.some((file, index) => {
      const payload = payloads[index];
      return (
        !payload ||
        (file.filename ?? "attachment") !== payload.filename ||
        file.mediaType?.toLowerCase() !== payload.mediaType.toLowerCase() ||
        (file.url !== undefined && file.url !== payload.dataUrl)
      );
    })
  ) {
    throw new Error("Submission content 文件与持久化附件不一致");
  }
  if (
    payloads.length !== images.length ||
    payloads.some(
      (payload, index) =>
        payload.filename !== images[index]?.filename ||
        payload.dataUrl !== images[index]?.dataUrl
    )
  ) {
    throw new Error("持久化附件与 Agent 图片输入不一致");
  }
}

export function validateUserInputResponse(
  value: unknown,
  expectedQuestionIds: readonly string[]
): asserts value is AgentUserInputResponse {
  if (!value || typeof value !== "object") throw new Error("用户输入响应格式无效");
  const response = value as Partial<AgentUserInputResponse>;
  if (
    typeof response.requestId !== "string" ||
    !response.requestId.trim() ||
    Buffer.byteLength(response.requestId, "utf8") > OPAQUE_REF_BYTE_LIMIT
  ) {
    throw new Error("用户输入 requestId 无效");
  }
  if (
    typeof response.userInputId !== "string" ||
    !response.userInputId.trim() ||
    Buffer.byteLength(response.userInputId, "utf8") > OPAQUE_REF_BYTE_LIMIT
  ) {
    throw new Error("用户输入 userInputId 无效");
  }
  if (!response.answers || typeof response.answers !== "object" || Array.isArray(response.answers)) {
    throw new Error("用户输入响应格式无效");
  }
  const actual = Object.keys(response.answers).sort();
  const expected = [...expectedQuestionIds].sort();
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    throw new Error("用户输入问题集合不匹配");
  }
  for (const id of expected) {
    const answer = response.answers[id];
    if (
      !answer ||
      !Array.isArray(answer.answers) ||
      !answer.answers.length ||
      answer.answers.length > USER_INPUT_ANSWER_LIMIT ||
      answer.answers.some(
        (item) =>
          typeof item !== "string" ||
          !item.trim() ||
          Buffer.byteLength(item, "utf8") > USER_INPUT_TEXT_LIMIT
      )
    ) {
      throw new Error("用户输入答案无效");
    }
  }
}
