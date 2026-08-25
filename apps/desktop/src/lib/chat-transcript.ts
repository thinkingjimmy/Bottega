/**
 * [INPUT]: Depends on shared ChatMessage/AgentUserInput with MESSAGE_BYTE_LIMIT
 * [OUTPUT]: Provides buildRecoveryInput, adding the latest user/assistant transcript on a budget before the current structured input, excluding notice
 * [POS]: lib's chat restores pure functions, historical text is always separated from current skill/mention/image
 */

import {
  MESSAGE_BYTE_LIMIT,
  type ChatMessage,
} from "../../shared/chats-ipc";
import { isTranscriptEligible } from "../../shared/chat-failure";
import type { AgentUserInput } from "../../shared/agent-ipc";

const encoder = new TextEncoder();
const byteLength = (value: string) => encoder.encode(value).byteLength;

export function buildRecoveryInput(
  messages: ChatMessage[],
  input: AgentUserInput[]
) {
  const eligible = messages.filter(isTranscriptEligible);
  if (eligible.length === 0) return input;
  const prefix = "以下是此前的对话记录：\n<transcript>\n";
  const suffix = "\n</transcript>\n\n用户的新消息如下：";
  const currentTextBytes = input.reduce(
    (total, item) => total + (item.type === "text" ? byteLength(item.text) : 0),
    0
  );
  let remaining =
    MESSAGE_BYTE_LIMIT - byteLength(prefix) - byteLength(suffix) - currentTextBytes;
  if (remaining < 0) return input;

  const selected: string[] = [];
  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    const message = eligible[index];
    const line = `${message.role}: ${message.content}`;
    const separatorBytes = selected.length ? byteLength("\n\n") : 0;
    const cost = byteLength(line) + separatorBytes;
    if (cost > remaining) break;
    selected.unshift(line);
    remaining -= cost;
  }
  if (selected.length === 0) return input;
  return [
    { type: "text" as const, text: `${prefix}${selected.join("\n\n")}${suffix}` },
    ...input,
  ];
}
