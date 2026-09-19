/**
 * [INPUT]: Depends on shared part codecs, notices, failures, completion and content budgets.
 * [OUTPUT]: Provides one message/Subagent factory, paired remote user provenance and closed portable validators.
 * [POS]: Canonical transcript grammar shared by desktop storage and cloud body publication.
 */
import { z } from "zod";
import { cloudIdSchema, deviceNameSchema } from "../../auth";
import { completionFields } from "./completion";
import { agentBackendIdSchema } from "../options";
import { productFailureSchema } from "./failure";
import { chatNoticeSchema, noticeMessageContent } from "./notices";
import { ATTACHMENT_FILENAME_BYTE_LIMIT, ATTACHMENT_LIMIT, MESSAGE_BYTE_LIMIT,
  MESSAGE_PART_LIMIT } from "./budgets";
import { chatPartSchema as portablePartSchema, importedPartSchema as portableImportedPartSchema,
  messageBytes, overNativeDetail, utf8Length, type ChatPart } from "./parts";
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CHAT_ID_PATTERN = MESSAGE_ID_PATTERN;
export const ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;
const memoryFailureKindSchema = z.enum([
  "initialization",
  "scope-resolution",
  "policy-store",
  "runtime-configuration",
  "identity",
  "provider",
  "ownership",
  "deadline",
  "render-budget",
  "stale-capability",
]);

const memoryOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("used"), count: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("unavailable"), failureKind: memoryFailureKindSchema }).strict(),
  z.object({
    kind: z.literal("skipped"),
    reason: z.enum(["disabled", "paused", "plan-mode", "prompt-not-issued"]),
  }).strict(),
]);

const contextReceiptSchema = z
  .object({
    version: z.literal(1),
    requestId: z.string().regex(MESSAGE_ID_PATTERN),
    memory: memoryOutcomeSchema,
  })
  .strict();

export function createMessageSchemas<Native extends z.ZodType<ChatPart>, Imported extends z.ZodType<ChatPart>>(
  chatPartSchema: Native, importedPartSchema: Imported,
) {
  const attachmentMetaSchema = z
    .object({
      id: z.string().regex(ATTACHMENT_ID_PATTERN),
      filename: z
        .string()
        .min(1)
        .refine((value) => utf8Length(value) <= ATTACHMENT_FILENAME_BYTE_LIMIT, {
          message: "附件文件名过长",
        }),
      mediaType: z.string().min(1).max(100),
      byteSize: z.number().int().nonnegative(),
    })
    .strict();

  const persistedSubagentSchema = z
    .object({
      meta: z
        .object({
          agentThreadId: z.string().min(1).max(256),
          name: z.string().min(1).max(256),
          model: z.string().min(1).max(200).optional(),
          origin: z.enum(["native", "spawn"]).optional(),
          agent: agentBackendIdSchema.optional(),
          ...completionFields,
          status: z.enum(["completed", "errored", "shutdown", "interrupted"]),
          spawnedAt: z.number().int().nonnegative(),
          lastActivityAt: z.number().int().nonnegative(),
          resultBytes: z.number().int().nonnegative().optional(),
          resultTruncated: z.boolean().optional(),
        })
        .strict(),
      parts: z.array(chatPartSchema).max(MESSAGE_PART_LIMIT),
    })
    .strict();

  const subagentsSchema = z
    .record(z.string().min(1).max(256), persistedSubagentSchema)
    .superRefine((subagents, context) => {
      for (const [key, agent] of Object.entries(subagents)) {
        if (key !== agent.meta.agentThreadId) {
          context.addIssue({
            code: "custom",
            path: [key, "meta", "agentThreadId"],
            message: "subagent key 必须等于 meta.agentThreadId",
          });
        }
      }
    });

  // Reject invalid reset timestamps instead of displaying an invented countdown.
  const usageLimitSchema = z
    .object({
      window: z.enum(["five-hour", "weekly", "provider", "unknown"]),
      resetsAt: z.number().int().positive().optional(),
    })
    .strict();

  const boundedMessageContentSchema = z.string().refine(
    (value) => utf8Length(value) <= MESSAGE_BYTE_LIMIT,
    { message: "消息不能超过 32 KB" }
  );

  const nonEmptyMessageContentSchema = z
    .string()
    .min(1)
    .refine((value) => utf8Length(value) <= MESSAGE_BYTE_LIMIT, {
      message: "消息不能超过 32 KB",
    });

  const messageBaseFields = {
    id: z.string().regex(MESSAGE_ID_PATTERN),
    content: boundedMessageContentSchema,
    createdAt: z.number().int().nonnegative(),
    seq: z.number().int().positive(),
    // Imported projection marker; native stored messages never use it.
    segment: z.literal("imported").optional(),
  };

  const nonEmptyMessageBaseFields = {
    ...messageBaseFields,
    content: nonEmptyMessageContentSchema,
  };

  const userMessageSchema = z
    .object({
      ...messageBaseFields,
      role: z.literal("user"),
      remoteCommandId: cloudIdSchema.optional(),
      remoteSource: z.object({ deviceId: cloudIdSchema, name: deviceNameSchema }).strict().optional(),
      attachments: z.array(attachmentMetaSchema).min(1).max(ATTACHMENT_LIMIT).optional(),
      relay: z
        .object({
          sourceSectionId: z.string().regex(CHAT_ID_PATTERN),
          chainId: z.string().min(1).max(256),
        })
        .strict()
        .optional(),
    })
    .strict()
    .superRefine((message, context) => {
      if ((message.remoteCommandId === undefined) !== (message.remoteSource === undefined)) {
        context.addIssue({ code: "custom", message: "Remote provenance must be paired" });
      }
      if (message.content.trim() || message.attachments?.length) return;
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "用户消息必须包含正文或附件",
      });
    });

  const assistantMessageSchema = z
    .object({
      ...messageBaseFields,
      role: z.literal("assistant"),
      ...completionFields,
      backend: agentBackendIdSchema,
      kind: z.literal("plan").optional(),
      // Imported detail has a wider limit; native segments retain the smaller budget.
      parts: z.array(importedPartSchema).min(1).max(MESSAGE_PART_LIMIT).optional(),
      durationMs: z.number().int().nonnegative().optional(),
      isError: z.boolean().optional(),
      failureKind: z
        .enum(["auth-required", "usage-limit", "unknown"])
        .optional(),
      failure: productFailureSchema.optional(),
      usageLimit: usageLimitSchema.optional(),
      contextReceipt: contextReceiptSchema.optional(),
    })
    .strict()
    .superRefine((message, context) => {
      if (!message.content.trim() && !message.parts?.length && !message.failure) {
        context.addIssue({
          code: "custom",
          path: ["content"],
          message: "Assistant message requires content, parts, or ProductFailure",
        });
      }
      if (messageBytes(message) > MESSAGE_BYTE_LIMIT) {
        context.addIssue({
          code: "custom",
          path: ["parts"],
          message: "消息（含过程条目）不能超过 32 KB",
        });
      }
      if (overNativeDetail(message)) {
        context.addIssue({ code: "custom", path: ["parts"], message: "工具输出超出限制" });
      }
    });

  const noticeMessageSchema = z
    .object({
      ...nonEmptyMessageBaseFields,
      role: z.literal("notice"),
      notice: chatNoticeSchema,
    })
    .strict()
    .superRefine((message, context) => {
      if (message.content !== noticeMessageContent(message.notice)) {
        context.addIssue({
          code: "custom",
          path: ["content"],
          message: "notice content 必须由 notice 载荷确定性派生",
        });
      }
    });

  const messageSchema = z.discriminatedUnion("role", [
    userMessageSchema,
    assistantMessageSchema,
    noticeMessageSchema,
  ]);


  return { messageSchema, subagentsSchema, persistedSubagentSchema, attachmentMetaSchema };
}
export const { messageSchema, subagentsSchema, persistedSubagentSchema, attachmentMetaSchema } =
  createMessageSchemas(portablePartSchema, portableImportedPartSchema);
export type ChatMessage = z.infer<typeof messageSchema>;
export type PersistedSubagent = z.infer<typeof persistedSubagentSchema>;
export type ChatAttachmentMeta = z.infer<typeof attachmentMetaSchema>;
