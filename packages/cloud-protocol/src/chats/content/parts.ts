/**
 * [INPUT]: Depends on Zod, portable terminal evidence, failures and content budgets.
 * [OUTPUT]: Provides pure native/imported part validators and exact UTF-8 accounting.
 * [POS]: Canonical part grammar; desktop adds its local Gallery provenance at its storage boundary.
 */
import { z } from "zod";
import { completionFields } from "./completion";
import { agentBackendIdSchema } from "../options";
import { productFailureSchema } from "./failure";
import { MESSAGE_BYTE_LIMIT, TOOL_DETAIL_BYTE_LIMIT, IMPORTED_TOOL_DETAIL_BYTE_LIMIT,
  PART_TITLE_CHAR_LIMIT } from "./budgets";
export const utf8Length = (value: string) => new TextEncoder().encode(value).byteLength;
const TOOL_KINDS = [
  "command",
  "file-change",
  "file-read",
  "web-search",
  "image",
  "reasoning",
  "agent-failure",
  "user-input",
  "other",
] as const;

export function createToolPartSchema(detailLimit: number, titleLimit: number) {
  return z
    .object({
      ...completionFields,
      type: z.literal("tool"),
      itemId: z.string().min(1).max(256),
      tool: z.enum(TOOL_KINDS),
      title: z.string().min(1).max(titleLimit),
      detail: z
        .string()
        .min(1)
        .refine((value) => utf8Length(value) <= detailLimit, {
          message: "工具输出超出限制",
        })
        .optional(),
      status: z.enum(["completed", "failed"]),
      failure: productFailureSchema.optional(),
      severity: z.enum(["warning", "error"]).optional(),
    })
    .strict();
}
export const textPartSchema = z
    .object({
      ...completionFields,
      type: z.literal("text"),
      itemId: z.string().min(1).max(256),
      text: z
        .string()
        .min(1)
        .refine((value) => utf8Length(value) <= MESSAGE_BYTE_LIMIT, {
          message: "过程文本超出消息预算",
        }),
      kind: z.literal("plan").optional(),
    })
    .strict();
export const subagentPartSchema = z
    .object({
      ...completionFields,
      type: z.literal("subagent"),
      itemId: z.string().min(1).max(256),
      agentThreadId: z.string().min(1).max(256),
      name: z.string().min(1).max(256),
      status: z.enum(["completed", "failed"]),
      origin: z.enum(["native", "spawn"]).optional(),
      agent: agentBackendIdSchema.optional(),
    })
    .strict();

function partsWithLimit(detailLimit: number, titleLimit: number) {
  return z.discriminatedUnion("type", [createToolPartSchema(detailLimit, titleLimit), textPartSchema, subagentPartSchema]);
}
export const chatPartSchema = partsWithLimit(TOOL_DETAIL_BYTE_LIMIT, PART_TITLE_CHAR_LIMIT);
export const importedPartSchema = partsWithLimit(IMPORTED_TOOL_DETAIL_BYTE_LIMIT, PART_TITLE_CHAR_LIMIT);
export const chatPartInputSchema = partsWithLimit(MESSAGE_BYTE_LIMIT, 100_000);
export type ChatPart = z.infer<typeof chatPartSchema>;
export type ChatToolPart = Extract<ChatPart, { type: "tool" }>;
export const overNativeDetail = (message: { segment?: "imported"; parts?: Array<ChatPart & { mediaSource?: unknown }> }) =>
  message.segment !== "imported" &&
  (message.parts ?? []).some((part) =>
    part.type === "tool" && part.detail && utf8Length(part.detail) > TOOL_DETAIL_BYTE_LIMIT);
export function messageBytes(message: {
  content: string;
  parts?: Array<ChatPart & { mediaSource?: unknown }>;
  attachments?: Array<{ filename: string; mediaType: string }>;
}) {
  let total = utf8Length(message.content);
  for (const part of message.parts ?? []) {
    total +=
      part.type === "text"
        ? utf8Length(part.text)
        : part.type === "subagent"
          ? utf8Length(part.name) + utf8Length(part.agentThreadId)
          : utf8Length(part.title) +
            (part.detail ? utf8Length(part.detail) : 0) +
            (part.failure ? utf8Length(JSON.stringify(part.failure)) : 0) +
            (part.mediaSource ? utf8Length(JSON.stringify(part.mediaSource)) : 0);
  }
  for (const attachment of message.attachments ?? []) {
    total += utf8Length(attachment.filename) + utf8Length(attachment.mediaType);
  }
  return total;
}
