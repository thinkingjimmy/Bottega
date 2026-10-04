/**
 * [INPUT]: Agent submission contracts and explicit validation dependencies.
 * [OUTPUT]: validateUserInputResponse.
 * [POS]: Agent validation responses boundary; admission and authority checks stay mandatory.
 */
import { OPAQUE_REF_BYTE_LIMIT } from "../../../../shared/ipc/agent/agent-ipc";
import type { AgentUserInputResponse } from "../../../../shared/ipc/agent/agent-ipc";

const USER_INPUT_TEXT_LIMIT = 8 * 1024;

const USER_INPUT_ANSWER_LIMIT = 8;

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
