/**
 * [INPUT]: Depends on shared chats - ChatMessage on ipc
 * [OUTPUT]: Provides isFailedAssistant/isTranscriptEligible Two turns Failed judgement
 * [POS]: The only source of truth shared is "Is this round a failure?"renderer directory/recover context with the same judgment as the e2e turn oracle
 */

import type { AssistantChatMessage, ChatMessage } from "./chats-ipc";

/* ============================================================
 * 失败 turn 的唯一判据。
 *
 * 落盘侧只有 `role === "assistant" && isError === true` 这一条机读接缝
 * （main 侧 commit 时写入，见 agent/commit.ts）。渲染侧的错误卡片只有
 * `role="alert"`，而该 role 在 renderer 里被复用十余处，定位不唯一——
 * 任何「这轮成没成」的判断都必须回到这里，不许各自抄一份。
 * ============================================================ */
/* 写成类型守卫而非布尔函数：调用方判定「失败」之后总要接着读
   failureKind/content 去讲清失败原因，narrowing 让它们零断言可达。 */
export const isFailedAssistant = (
  message: ChatMessage
): message is AssistantChatMessage & { isError: true } =>
  message.role === "assistant" && message.isError === true;

/**
 * 可作为上下文重放的消息：排除系统 notice 与失败 turn。
 * 失败 turn 的正文是错误文案而非模型输出，喂回模型只会污染语境。
 */
export const isTranscriptEligible = (message: ChatMessage) =>
  message.role !== "notice" && !isFailedAssistant(message);
