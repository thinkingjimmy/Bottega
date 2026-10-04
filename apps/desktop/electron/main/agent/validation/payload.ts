/**
 * [INPUT]: Agent submission contracts and explicit validation dependencies.
 * [OUTPUT]: validateAgentPayload, parseAgentPayloadForStart, parseAgentPayload.
 * [POS]: Agent validation payload boundary; admission and authority checks stay mandatory.
 */
import { z } from "zod";
import { handoffSchema } from "../../../../shared/chat-agent/history-schema";
import { HANDOFF_PROMPT_HASH } from "../history/receiver";
import { SESSION_ID_BYTE_LIMIT } from "../../../../shared/ipc/agent/agent-ipc";
import type { AgentSendPayload } from "../../../../shared/ipc/agent/agent-ipc";
import type { TurnProjectContext } from "../../../../shared/product/product-resource-scope";
import { chatAgentIdSchema } from "../../../../shared/chat-agent/options";
import { parsePreparedSkillSelection } from "../admission/prepared-skill-selection-validation";
import { skillsTurnOwnerId } from "../../skills-management/custody/turn-custody";
import type { TurnOrigin } from "../turns/turn/turn-registry-model";
import { CONVERSATION_PATTERN, ATTACHMENT_PATTERN, assertExactKeys } from "./primitives";
import { parseUserInput } from "./input";
import { validateAgentTurnOptions } from "./options";

const SESSION_PATTERN = /^[A-Za-z0-9._:/-]+$/;

export function validateAgentPayload(
  value: unknown
): asserts value is AgentSendPayload {
  parseAgentPayload(value);
}

export function parseAgentPayloadForStart(
  value: unknown,
  origin: TurnOrigin | undefined,
  projectContext: TurnProjectContext | undefined
): AgentSendPayload {
  return parseAgentPayload(value, { origin, projectContext });
}

type StartAuthority = Readonly<{
  origin?: TurnOrigin;
  projectContext?: TurnProjectContext;
}>;

export function parseAgentPayload(
  value: unknown,
  authority?: StartAuthority
): AgentSendPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("请求格式无效");
  }
  const acceptsPreparedSelection =
    (authority?.origin?.kind === "manual" || authority?.origin?.kind === "workflow") && authority.projectContext !== undefined;
  assertExactKeys(
    value,
    [
      "requestId",
      "session",
      "scope",
      "turnOptions",
      "planMode",
      "input",
      ...(acceptsPreparedSelection ? ["preparedSkillSelection"] : []),
      ...(authority ? ["handoff", "agentRevision"] : []),
    ],
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
  const handoff = payload.handoff === undefined ? undefined : handoffSchema.parse(payload.handoff);
  if (handoff && (handoff.binding.chatId !== payload.scope?.conversationId || handoff.promptHash !== HANDOFF_PROMPT_HASH)) throw new Error("CHAT_HANDOFF_CONFLICT");
  const agentRevision = payload.agentRevision === undefined ? undefined : z.number().int().nonnegative().parse(payload.agentRevision);
  const preparedSkillSelection = payload.preparedSkillSelection === undefined
    ? undefined
    : parsePreparedSkillSelection(payload.preparedSkillSelection);
  if (
    preparedSkillSelection &&
    (preparedSkillSelection.refOwnerId !== skillsTurnOwnerId(payload.requestId) ||
      preparedSkillSelection.backend !== turnOptions.backend ||
      preparedSkillSelection.planMode !== Boolean(payload.planMode) ||
      preparedSkillSelection.projectContext.projectId !==
        authority?.projectContext?.projectId ||
      preparedSkillSelection.projectContext.projectLifecycleRevision !==
        authority?.projectContext?.projectLifecycleRevision)
  ) {
    throw new Error("preparedSkillSelection 与 Agent turn authority 不一致");
  }
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
      !chatAgentIdSchema.safeParse(payload.session.backend).success ||
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
    ...(preparedSkillSelection ? { preparedSkillSelection } : {}),
    ...(handoff ? { handoff } : {}), ...(agentRevision !== undefined ? { agentRevision } : {}),
  };
}
