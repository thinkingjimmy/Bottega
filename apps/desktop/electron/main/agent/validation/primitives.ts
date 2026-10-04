/**
 * [INPUT]: Agent submission contracts and explicit validation dependencies.
 * [OUTPUT]: CONVERSATION_PATTERN, ATTACHMENT_PATTERN, assertExactKeys, assertConversationId.
 * [POS]: Agent validation primitives boundary; admission and authority checks stay mandatory.
 */


export const CONVERSATION_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const ATTACHMENT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function assertExactKeys(
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
