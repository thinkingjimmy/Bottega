/**
 * [INPUT]: Depends on zod, the canonical ChatPart/ChatToolPart/attachment types, and the native/imported tool-detail plus message byte budgets
 * [OUTPUT]: Provides utf8Length, PART_TITLE_CHAR_LIMIT, transcript-provenance-aware storage/imported/IPC part schemas, overNativeDetail, and messageBytes accounting
 * [POS]: The part-level half of the chat fact schema, split out so chat-schema.ts stays a record-level document; every part limit lives here and nowhere else
 */

import { z } from "zod";
import {
  IMPORTED_TOOL_DETAIL_BYTE_LIMIT,
  TOOL_DETAIL_BYTE_LIMIT,
} from "../../../shared/agent-ipc";
import {
  MESSAGE_BYTE_LIMIT,
  type ChatAttachmentMeta,
  type ChatPart,
  type ChatToolPart,
} from "../../../shared/chats-ipc";
import { agentBackendIdSchema } from "../../../shared/agent-schema";
import { productFailureSchema } from "../../../shared/product-failure";
import { transcriptGallerySourceRefSchema } from "../../../shared/gallery-media-ipc";

export const PART_TITLE_CHAR_LIMIT = 1000;

export const utf8Length = (value: string) => Buffer.byteLength(value, "utf8");

// ─── 工具词表：zod 是运行时值，无法从类型自动生成，只能人工列举 ───
// 但漏项会让整轮结果写不进账本（实测：新增 kind 未同步此处 → "无法安全写入本地账本"）。
// 下方穷尽守卫把这个运行时事故前移成编译错误：少一项即 typecheck 失败。
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

type MissingToolKind = Exclude<ChatToolPart["tool"], (typeof TOOL_KINDS)[number]>;
const _toolKindsExhaustive: MissingToolKind extends never ? true : never = true;
void _toolKindsExhaustive;

// 双层限额同构生成（Review 修复）：IPC 入口用宽限额只验形状，normalizeMessage
// 在入口与存储之间做截断/收敛，入口不拒真实数据。决策 7 的 4KB 只限工具 detail；
// 中间文本（ChatTextPart）只受 32KB 消息预算约束，不做单独截断。
const partSchemasWithLimit = (detailLimit: number, titleLimit: number) => {
  const tool = z
    .object({
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
      mediaSource: transcriptGallerySourceRefSchema.optional(),
    })
    .strict()
    .superRefine((part, context) => {
      if (part.mediaSource && (part.tool !== "image" || part.status !== "completed")) {
        context.addIssue({
          code: "custom",
          path: ["mediaSource"],
          message: "mediaSource is valid only for a completed image part",
        });
      }
    });
  const text = z
    .object({
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
  const subagent = z
    .object({
      type: z.literal("subagent"),
      itemId: z.string().min(1).max(256),
      agentThreadId: z.string().min(1).max(256),
      name: z.string().min(1).max(256),
      status: z.enum(["completed", "failed"]),
      origin: z.enum(["native", "spawn"]).optional(),
      agent: agentBackendIdSchema.optional(),
    })
    .strict();
  return z.discriminatedUnion("type", [tool, text, subagent]);
};

/** 存储层严格 schema：detail ≤ 4KB（决策 7）、title ≤ 1000 字符 */
export const chatPartSchema = partSchemasWithLimit(
  TOOL_DETAIL_BYTE_LIMIT,
  PART_TITLE_CHAR_LIMIT
);
/** 只读导入段：详情放宽到 16 KiB（见 IMPORTED_TOOL_DETAIL_BYTE_LIMIT） */
export const importedPartSchema = partSchemasWithLimit(IMPORTED_TOOL_DETAIL_BYTE_LIMIT, PART_TITLE_CHAR_LIMIT);
/* 决策 7 的 4 KiB 只管原生落盘：导入历史那一段终端输出剪到 4 KiB 等于把证据
   剪掉一半，它另有 16 KiB 一档，两者共用同一条 32 KB 消息预算。 */
export const overNativeDetail = (message: { segment?: "imported"; parts?: ChatPart[] }) =>
  message.segment !== "imported" &&
  (message.parts ?? []).some((part) =>
    part.type === "tool" && part.detail && utf8Length(part.detail) > TOOL_DETAIL_BYTE_LIMIT);
/** IPC 入口宽限 schema：detail/title 放宽只验形状，截断交给 normalizeMessage */
export const chatPartInputSchema = partSchemasWithLimit(
  MESSAGE_BYTE_LIMIT,
  100_000
);

/** 消息真实体积 = 最终回复 + 过程条目 + 附件元数据（决策 7 预算口径） */
export function messageBytes(message: {
  content: string;
  parts?: ChatPart[];
  attachments?: ChatAttachmentMeta[];
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
