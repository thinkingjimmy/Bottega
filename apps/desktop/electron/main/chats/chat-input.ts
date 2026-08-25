/**
 * [INPUT]: Depends on zod, shared chat/agent/project Limit, renderer ManualTurn and main-only Trusted adopt
 * [OUTPUT]: Provides with an App edit/use/adopt role, append, modified CAS, formal or annex unified block, attachment MIME/header, equivalent renderer/coordinator chat, write schema, reusable user envelope schema and sorted attachment load type
 * [POS]: The input boundary of the chats module; renderer cannot construct an adopt, main trusted path to parse without performing perpetuation or lifecycle side effects
 */

import { z } from "zod";
import { agentBackendIdSchema } from "../../../shared/agent-schema";
import {
  ATTACHMENT_BYTE_LIMIT,
  ATTACHMENT_FILENAME_BYTE_LIMIT,
  ATTACHMENT_LIMIT,
  dataUrlByteSize,
  isValidImageDataUrl,
} from "../../../shared/agent-ipc";
import {
  MESSAGE_BYTE_LIMIT,
  type AdoptChatInput,
  type CreateAppChatInput,
} from "../../../shared/chats-ipc";
import { HISTORY_SOURCE_KINDS } from "../../../shared/history-import-ipc";
import { PROJECT_ID_PATTERN } from "../../../shared/projects-ipc";
import { incarnationPreconditionSchema } from "../../../shared/submission";
import { CHAT_ID_PATTERN, utf8Length } from "./chat-schema";

const userMessageInputSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    role: z.literal("user"),
    content: z.string(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict() // attachments 元数据由主进程生成，renderer 传入即拒（单一真相源）
  .superRefine((message, context) => {
    if (utf8Length(message.content) > MESSAGE_BYTE_LIMIT) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "用户消息不能超过 32 KB",
      });
    }
  });

const attachmentPayloadSchema = z
  .object({
    filename: z
      .string()
      .min(1)
      .refine((value) => utf8Length(value) <= ATTACHMENT_FILENAME_BYTE_LIMIT, {
        message: "附件文件名过长",
      }),
    mediaType: z.string().regex(/^image\/[a-z0-9+.-]+$/i, "仅支持图片附件落盘"),
    dataUrl: z
      .string()
      .refine(isValidImageDataUrl, "附件必须是合法的 base64 图片 data URL")
      .refine((value) => dataUrlByteSize(value) <= ATTACHMENT_BYTE_LIMIT, {
        message: "图片附件不能超过 8 MB",
      }),
  })
  .strict()
  .superRefine((payload, context) => {
    const declared = /^data:([^;,]+);base64,/i.exec(payload.dataUrl)?.[1];
    if (declared?.toLowerCase() === payload.mediaType.toLowerCase()) return;
    context.addIssue({
      code: "custom",
      path: ["mediaType"],
      message: "附件声明媒体类型与 data URL 不一致",
    });
  });

const attachmentPayloadsSchema = z
  .array(attachmentPayloadSchema)
  .max(ATTACHMENT_LIMIT)
  .optional();

function requireMessageOrAttachments(
  message: z.infer<typeof userMessageInputSchema>,
  attachmentPayloads: z.infer<typeof attachmentPayloadsSchema>,
  context: z.RefinementCtx,
  messageKey: "firstMessage" | "message"
) {
  if (message.content.trim() || attachmentPayloads?.length) return;
  context.addIssue({
    code: "custom",
    path: [messageKey, "content"],
    message: "用户消息必须包含正文或附件",
  });
}

export const userMessageEnvelopeSchema = z
  .object({
    message: userMessageInputSchema,
    attachmentPayloads: attachmentPayloadsSchema,
  })
  .strict()
  .superRefine((input, context) =>
    requireMessageOrAttachments(
      input.message,
      input.attachmentPayloads,
      context,
      "message"
    )
  );

export const createInputSchema = z
  .object({
    id: z.string().regex(CHAT_ID_PATTERN),
    agent: agentBackendIdSchema,
    firstMessage: userMessageInputSchema,
    projectId: z.string().regex(PROJECT_ID_PATTERN).nullable().optional(),
    attachmentPayloads: attachmentPayloadsSchema,
    incarnationId: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  })
  .strict()
  .superRefine((input, context) =>
    requireMessageOrAttachments(
      input.firstMessage,
      input.attachmentPayloads,
      context,
      "firstMessage"
    )
  );

export const createAppInputSchema = z
  .object({
    id: z.string().regex(CHAT_ID_PATTERN),
    appId: z.string().regex(/^[a-z0-9]{10}$/),
    projectId: z.string().regex(PROJECT_ID_PATTERN),
    appRole: z.enum(["edit", "use"]),
    agent: agentBackendIdSchema.optional(),
    firstMessage: userMessageInputSchema,
    attachmentPayloads: attachmentPayloadsSchema,
    incarnationId: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  })
  .strict()
  .superRefine((input, context) =>
    requireMessageOrAttachments(
      input.firstMessage,
      input.attachmentPayloads,
      context,
      "firstMessage"
    )
  ) satisfies z.ZodType<CreateAppChatInput>;

export const adoptInputSchema = z
  .object({
    id: z.string().regex(CHAT_ID_PATTERN),
    title: z.string().trim().min(1).max(200),
    agent: agentBackendIdSchema,
    firstMessage: userMessageInputSchema,
    projectId: z.string().regex(PROJECT_ID_PATTERN),
    incarnationId: z.string().regex(/^[a-f0-9]{32}$/),
    session: z.object({ backend: agentBackendIdSchema, id: z.string().min(1).max(512) }).strict(),
    importOrigin: z.object({
      sourceKind: z.enum(HISTORY_SOURCE_KINDS), storageFingerprint: z.string().min(1).max(512),
      canonicalNativeId: z.string().min(1).max(512), aliases: z.array(z.string().min(1).max(512)).max(64),
      resumeAlias: z.string().min(1).max(512), originalCwd: z.string().min(1), historyRevision: z.string().min(1).max(512),
      adoptionSnapshotId: z.string().regex(/^adopt_[a-f0-9]{64}$/), sourceSize: z.number().int().nonnegative(), sourceMtimeNs: z.string().regex(/^\d+$/),
    }).strict(),
    snapshotDigest: z.string().regex(/^[a-f0-9]{64}$/),
    attachmentPayloads: attachmentPayloadsSchema,
  })
  .strict()
  .superRefine((input, context) => {
    requireMessageOrAttachments(input.firstMessage, input.attachmentPayloads, context, "firstMessage");
    if (input.session.backend !== input.agent || input.importOrigin.sourceKind !== input.agent) {
      context.addIssue({ code: "custom", path: ["session"], message: "收养来源、SessionRef 与 Agent 必须同源" });
    }
  }) satisfies z.ZodType<AdoptChatInput>;

export const appendInputSchema = z
  .object({
    chatId: z.string().regex(CHAT_ID_PATTERN),
    message: userMessageInputSchema,
    attachmentPayloads: attachmentPayloadsSchema,
    precondition: incarnationPreconditionSchema.optional(),
    revise: z
      .object({
        supersedesUserMessageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
        throughSeqEnd: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.revise) {
      requireMessageOrAttachments(
        input.message,
        input.attachmentPayloads,
        context,
        "message"
      );
    }
    if (input.revise && input.attachmentPayloads) {
      context.addIssue({
        code: "custom",
        path: ["attachmentPayloads"],
        message: "修订附件必须由 main 从 canonical blob 重建",
      });
    }
  });

// 标题限额与 chatRecordSchema 同构：trim 后 1–200 字符
export const renameInputSchema = z
  .object({
    chatId: z.string().regex(CHAT_ID_PATTERN),
    title: z.string().trim().min(1).max(200),
  })
  .strict();

export type ParsedAttachmentPayload = z.infer<typeof attachmentPayloadSchema>;
