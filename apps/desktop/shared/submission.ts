/**
 * [INPUT]: Depends on zod, strict RichInput and transcript/owner-native attachment Gallery sourceRef; Receive route-independent content, Steer outbox identity, incarnation precondition, ACK and outcome queries
 * [OUTPUT]: Provides a strict file/content schema, workspace precondition CAS, a canonical RichValue SubmissionContentV1, a stere wrapper schema, a dual kind ACK, revision outcome, typed error code single points and capsule budget
 * [POS]: The only wire truth of the shared durable submission; Queues only contain content, route identity only generated when drain/Steer admission
 */

import { z } from "zod";
import {
  GALLERY_LOGICAL_KEY_LIMIT,
  galleryMediaSourceRefSchema,
  gallerySourceLogicalKey,
} from "./gallery-media-ipc";
import { richInputValueSchema } from "./rich-input-projection";
import {
  ATTACHMENT_BYTE_LIMIT,
  ATTACHMENT_FILENAME_BYTE_LIMIT,
  ATTACHMENT_LIMIT,
  OPAQUE_REF_BYTE_LIMIT,
} from "./agent-ipc";
import { MESSAGE_BYTE_LIMIT } from "./chats-ipc";

const entityId = z.string().min(1).max(256);
const workspaceEntityId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const utf8Length = (value: string) => new TextEncoder().encode(value).length;
const boundedString = (bytes: number) =>
  z
    .string()
    .max(bytes)
    .refine((value) => utf8Length(value) <= bytes, {
      message: `文本不能超过 ${bytes} 字节`,
    });
// 8 MiB 原文经 base64 编码后的最大长度，再留固定 data URL header 余量。
const FILE_URL_BYTE_LIMIT = Math.ceil((ATTACHMENT_BYTE_LIMIT * 4) / 3) + 256;

export const workspacePreconditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("default") }).strict(),
  z
    .object({
      kind: z.literal("app"),
      appId: workspaceEntityId,
    })
    .strict(),
  z
    .object({
      kind: z.literal("project"),
      projectId: workspaceEntityId,
      membershipRevision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("chat-home"),
      conversationId: workspaceEntityId,
      incarnationId: z.string().regex(/^[a-f0-9]{32}$/),
    })
    .strict(),
]);

export type WorkspacePrecondition = z.infer<
  typeof workspacePreconditionSchema
>;

export const submissionFileSchema = z
  .object({
    id: boundedString(OPAQUE_REF_BYTE_LIMIT).refine(Boolean, {
      message: "file id 不能为空",
    }),
    type: z.literal("file"),
    filename: boundedString(ATTACHMENT_FILENAME_BYTE_LIMIT).optional(),
    mediaType: boundedString(128).optional(),
    url: boundedString(FILE_URL_BYTE_LIMIT).optional(),
  })
  .strict();
const contentSchema = z
  .object({
    richValue: richInputValueSchema,
    displayText: boundedString(MESSAGE_BYTE_LIMIT),
    files: z.array(submissionFileSchema).max(ATTACHMENT_LIMIT),
  })
  .strict()
  .superRefine((content, context) => {
    const ids = new Set<string>();
    for (const [index, file] of content.files.entries()) {
      if (ids.has(file.id)) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "id"],
          message: "Submission file id 不得重复",
        });
      }
      ids.add(file.id);
    }
  });

const gallerySubmissionSnapshotV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    attachments: z
      .array(
        z
          .object({
            fileIndex: z.number().int().nonnegative(),
            attachmentId: entityId,
            logicalKey: z.string().min(1).max(GALLERY_LOGICAL_KEY_LIMIT),
            sourceRevision: z.string().min(1).max(256),
            selectionToken: entityId,
            materializationToken: entityId,
            sourceRef: galleryMediaSourceRefSchema,
          })
          .strict()
      )
      .max(ATTACHMENT_LIMIT),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const logicalKeys = new Set<string>();
    const attachmentIds = new Set<string>();
    const fileIndices = new Set<number>();
    for (const [index, attachment] of snapshot.attachments.entries()) {
      const expectedLogicalKey = gallerySourceLogicalKey(attachment.sourceRef);
      if (attachment.logicalKey !== expectedLogicalKey) {
        context.addIssue({
          code: "custom",
          path: ["attachments", index, "logicalKey"],
          message: "logicalKey 必须匹配 canonical sourceRef",
        });
      }
      if (
        attachment.sourceRef.kind === "attachment" &&
        attachment.sourceRevision !== attachment.sourceRef.sourceRevision
      ) {
        context.addIssue({
          code: "custom",
          path: ["attachments", index, "sourceRevision"],
          message: "attachment sourceRevision 必须匹配 sourceRef",
        });
      }
      if (logicalKeys.has(attachment.logicalKey)) {
        context.addIssue({
          code: "custom",
          path: ["attachments", index, "logicalKey"],
          message: "消费身份必须按唯一 logicalKey 冻结",
        });
      }
      if (attachmentIds.has(attachment.attachmentId)) {
        context.addIssue({
          code: "custom",
          path: ["attachments", index, "attachmentId"],
          message: "Gallery attachmentId 不得重复",
        });
      }
      if (fileIndices.has(attachment.fileIndex)) {
        context.addIssue({
          code: "custom",
          path: ["attachments", index, "fileIndex"],
          message: "Gallery fileIndex 不得重复",
        });
      }
      logicalKeys.add(attachment.logicalKey);
      attachmentIds.add(attachment.attachmentId);
      fileIndices.add(attachment.fileIndex);
    }
  });

const epochShape = {
  capabilityEpoch: z.number().int().nonnegative(),
  backendEpoch: z.number().int().nonnegative(),
} as const;

export const submissionContentV1Schema = z.discriminatedUnion("origin", [
  z
    .object({
      schemaVersion: z.literal(1),
      content: contentSchema,
      origin: z.literal("composer"),
      ...epochShape,
      gallery: gallerySubmissionSnapshotV1Schema.optional(),
    })
    .strict()
    .superRefine((submission, context) => {
      for (const [index, attachment] of (
        submission.gallery?.attachments ?? []
      ).entries()) {
        if (attachment.fileIndex >= submission.content.files.length) {
          context.addIssue({
            code: "custom",
            path: ["gallery", "attachments", index, "fileIndex"],
            message: "fileIndex 必须指向最终 files 数组",
          });
          continue;
        }
        if (
          submission.content.files[attachment.fileIndex]?.id !==
          attachment.attachmentId
        ) {
          context.addIssue({
            code: "custom",
            path: ["gallery", "attachments", index, "attachmentId"],
            message: "attachmentId 必须匹配 fileIndex 指向的文件",
          });
        }
      }
    }),
  z
    .object({
      schemaVersion: z.literal(1),
      content: contentSchema,
      origin: z.literal("interaction"),
      ...epochShape,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      content: contentSchema,
      origin: z.literal("system"),
      ...epochShape,
    })
    .strict(),
]);

export type SubmissionContentV1 = z.infer<typeof submissionContentV1Schema>;
export type GallerySubmissionSnapshotV1 = z.infer<
  typeof gallerySubmissionSnapshotV1Schema
>;

export const incarnationPreconditionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("existing"),
      incarnationId: entityId,
    })
    .strict(),
  z
    .object({
      kind: z.literal("absent"),
      proposedIncarnationId: entityId,
    })
    .strict(),
]);

export type IncarnationPrecondition = z.infer<
  typeof incarnationPreconditionSchema
>;

// manual 路由的 wire 真身 = sections-ipc 的 ManualTurnSubmission
//（content + precondition 在 coordinator-ipc 逐字段 strict 重验）；
// 此处只保留 Steer outbox wrapper 的独立 schema。
export const steerSubmissionEnvelopeV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    route: z.literal("steer"),
    outboxRef: entityId,
    requestId: entityId,
    conversationId: entityId,
    workspacePrecondition: workspacePreconditionSchema,
    content: submissionContentV1Schema,
  })
  .strict();

export const submissionAckSchema = z
  .object({
    intentId: entityId,
    outcomeRevision: z.number().int().nonnegative(),
    kind: z.enum(["admission", "recovery-installed"]),
  })
  .strict();

export type SubmissionAck = z.infer<typeof submissionAckSchema>;

const liveOutcomeSchema = z
  .object({
    kind: z.literal("live"),
    intentId: entityId,
    revision: z.number().int().nonnegative(),
    phase: z.enum([
      "queued",
      "appended",
      "claimed",
      "dispatching",
      "dispatched",
      "unknown",
      "result-prepared",
      "persisted",
      "failed",
    ]),
    custody: z.enum(["main-journal", "local-queue", "chat-persisted"]),
    retry: z.enum([
      "none",
      "safe",
      "reconcile",
      "recoverable",
      "retry-agent-turn",
    ]),
    message: z.string().max(2_000).optional(),
    expiresAt: z.number().int().positive().optional(),
  })
  .strict();

export const submissionOutcomeSchema = z.discriminatedUnion("kind", [
  liveOutcomeSchema,
  z
    .object({
      kind: z.literal("tombstone"),
      intentId: entityId,
      revision: z.number().int().nonnegative(),
      // 过期呈现走 live failed + message；会话删除直接删记录不立 intent
      // 墓碑——枚举只保留真实写入面。
      outcome: z.enum(["persisted", "failed"]),
      deletedAt: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("notFound"),
      intentId: entityId,
      revision: z.number().int().nonnegative(),
      reservation: z.enum(["absent", "inFlight", "unknown"]),
    })
    .strict(),
]);

export type SubmissionOutcome = z.infer<typeof submissionOutcomeSchema>;

export type SubmissionErrorCode =
  | "CAPSULE_LIMIT"
  | "CUSTODY_UNAVAILABLE"
  | "EPOCH_MISMATCH"
  | "INCARNATION_MISMATCH"
  | "OUTCOME_CONFLICT"
  | "RESERVATION_CONFLICT";

export const SUBMISSION_CAPSULE_BYTE_LIMIT = 1024 * 1024;
export const SUBMISSION_CAPSULE_CHAT_LIMIT = 10;
/** capsule 寿命恒小于 coordinator ledger 的 TOMBSTONE_RETENTION_MS（30d）。 */
export const SUBMISSION_CAPSULE_TTL_MS = 72 * 60 * 60 * 1_000;
