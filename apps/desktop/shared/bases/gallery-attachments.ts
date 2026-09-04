/**
 * [INPUT]: Depends on zod, Base owner/attachment value and Gallery canonical occurrence/sourceRef; owner-native manual upload and read DTO of the receiving main/renderer
 * [OUTPUT]: Provides the Gallery ledger with canonical percent-encoded occurrence ids, date/auto View markers, full fingerprint, owner-native upload request carrying the optional App surface lease, method DTOs and budgets
 * [POS]: The only source of truth for shared/bases attachment protocols; BaseStore, ingestion, preload and renderer are shared, with no paths or workspace lease in the structure
 */

import { z } from "zod";
import {
  GALLERY_LOGICAL_KEY_LIMIT,
  galleryOccurrenceKey,
  transcriptGalleryOccurrenceIdSchema,
} from "../gallery-media-ipc";
import { BASE_OWNER_KEY_PATTERN } from "../bases-ipc";

export const BASE_ATTACHMENT_BYTE_LIMIT = 8 * 1024 * 1024;
export const BASE_ATTACHMENT_CHAT_BUDGET = 512 * 1024 * 1024;
export const BASE_ATTACHMENT_GLOBAL_BUDGET = 2 * 1024 * 1024 * 1024;
export const BASE_ATTACHMENT_QUEUE_BYTES = 64 * 1024 * 1024;
export const BASE_ATTACHMENT_JOB_LIMIT = 8;
export const BASE_GALLERY_LEDGER_BYTE_LIMIT = 2 * 1024 * 1024;
export const BASE_GALLERY_LEDGER_ENTRY_LIMIT = 10_000;
export const BASE_ATTACHMENT_THUMB_BUCKETS = [
  160, 320, 640, 1024, 2048, 4096,
] as const;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
// ledger producer 使用 transcript:<chatId>:<incarnationId>:<seq>:<itemId>；
// 三个 source id 各取合法上限时仍须落在同一 schema 域内。
const logicalKey = z.string().min(1).max(GALLERY_LOGICAL_KEY_LIMIT);
const blobId = z
  .string()
  .regex(/^att_[a-f0-9]{64}\.(?:png|jpe?g|webp|gif)$/);
const manualOccurrenceIdSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value.startsWith("manual:"), "Manual occurrenceId 格式无效");
const canonicalOccurrenceId = z.union([
  manualOccurrenceIdSchema,
  transcriptGalleryOccurrenceIdSchema,
]);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);

export const baseAttachmentValueSchema = z
  .object({
    kind: z.literal("attachment"),
    attachmentId: id,
    blobId,
    filename: z.string().min(1).max(255),
    mediaType: z.enum([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ]),
    byteLength: z.number().int().positive().max(BASE_ATTACHMENT_BYTE_LIMIT),
    width: z.number().int().positive().max(32_768),
    height: z.number().int().positive().max(32_768),
    revision: z.string().min(1).max(256),
  })
  .strict();

export const galleryOccurrenceSchema = z
  .object({
    occurrenceId: canonicalOccurrenceId,
    blobId,
    attachmentId: id,
    logicalKey,
    sourceRevision: z.string().min(1).max(256),
    completedAt: z.number().int().nonnegative(),
    assistantSeq: z.number().int().nonnegative().optional(),
    itemOrdinal: z.number().int().nonnegative().optional(),
    sourceChatId: id.optional(),
    sourceIncarnationId: id.optional(),
    rowId: id,
    columnId: id,
    dateColumnId: id.optional(),
    fingerprint,
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export const galleryAssociationSchema = z
  .object({
    galleryItemId: z.string().min(3).max(257),
    occurrenceId: canonicalOccurrenceId,
    logicalKey,
    attachmentId: id,
    rowId: id,
    columnId: id,
    createdAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.galleryItemId !== `${value.rowId}:${value.columnId}`) {
      context.addIssue({
        code: "custom",
        path: ["galleryItemId"],
        message: "GalleryItemId 必须等于 rowId:columnId",
      });
    }
  });

export const galleryTombstoneSchema = z
  .object({
    occurrenceId: canonicalOccurrenceId,
    deletedAt: z.number().int().nonnegative(),
    epoch: z.number().int().nonnegative(),
  })
  .strict();

export const baseGalleryLedgerSchema = z
  .object({
    schemaVersion: z.literal(1),
    chatId: id,
    incarnationId: id,
    targetColumnId: id.optional(),
    targetDateColumnId: id.optional(),
    autoGalleryState: z.enum(["pending", "created", "suppressed"]).optional(),
    epoch: z.number().int().nonnegative(),
    associations: z.record(z.string(), galleryAssociationSchema),
    occurrences: z.record(z.string(), galleryOccurrenceSchema),
    tombstones: z.record(z.string(), galleryTombstoneSchema),
    aliases: z.record(logicalKey, z.string().min(3).max(257)),
  })
  .strict();

export type BaseGalleryLedger = z.infer<typeof baseGalleryLedgerSchema>;
export type GalleryOccurrence = z.infer<typeof galleryOccurrenceSchema>;
export type GalleryAssociation = z.infer<typeof galleryAssociationSchema>;

export const BASE_ATTACHMENT_ERROR_CODES = [
  "ATTACHMENT_CONFLICT",
  "ATTACHMENT_NOT_FOUND",
  "BUDGET_EXCEEDED",
  "DECODE_FAILED",
  "EPOCH_MISMATCH",
  "INCARNATION_MISMATCH",
  "INVALID_INPUT",
  "IO_ERROR",
  "QUEUE_FULL",
  "SOURCE_GONE",
] as const;

export type BaseAttachmentErrorCode =
  (typeof BASE_ATTACHMENT_ERROR_CODES)[number];

export const baseAttachmentFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.enum(BASE_ATTACHMENT_ERROR_CODES),
        message: z.string().min(1).max(2_000),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type BaseAttachmentFailure = z.infer<
  typeof baseAttachmentFailureSchema
>;

const chatOwnership = {
  chatId: id,
  incarnationId: id,
} as const;

export const putAttachmentInputSchema = z
  .object({
    ownerKey: z.string().regex(BASE_OWNER_KEY_PATTERN),
    ownerInstanceId: id,
    opId: id,
    expectedRevision: z.number().int().nonnegative().optional(),
    rowId: id.optional(),
    columnId: id.optional(),
    filename: z.string().min(1).max(255),
    mediaType: z.enum([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ]),
    dataUrl: z.string().min(1).max(12 * 1024 * 1024),
  })
  .strict();

/* App window surface 的 lease；主窗口上传不带此字段。 */
export const putAttachmentRequestSchema = putAttachmentInputSchema.extend({
  surfaceLeaseId: z.string().uuid().optional(),
}).strict();

export const readAttachmentThumbnailInputSchema = z
  .object({
    ...chatOwnership,
    attachmentId: id,
    revision: z.string().min(1).max(256),
    maxEdge: z.number().int().min(1).max(4096),
    requestVersion: z.number().int().nonnegative(),
  })
  .strict();

export const listGalleryEntriesInputSchema = z
  .object({
    ...chatOwnership,
    columnId: id.optional(),
  })
  .strict();

export type PutAttachmentInput = z.infer<typeof putAttachmentInputSchema>;
export type PutAttachmentRequest = z.infer<typeof putAttachmentRequestSchema>;
export type ReadAttachmentThumbnailInput = z.infer<
  typeof readAttachmentThumbnailInputSchema
>;
export type ListGalleryEntriesInput = z.infer<
  typeof listGalleryEntriesInputSchema
>;

const success = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ ok: z.literal(true), value }).strict();
const result = <T extends z.ZodTypeAny>(value: T) =>
  z.union([success(value), baseAttachmentFailureSchema]);

export const putAttachmentResultSchema = result(
  z
    .object({
      attachmentId: id,
      rowId: id,
      columnId: id,
      galleryItemId: z.string().min(3).max(257),
      revision: z.string().min(1).max(256),
      idempotent: z.boolean(),
    })
    .strict()
);

const thumbnailBucketSchema = z.union([
  z.literal(160),
  z.literal(320),
  z.literal(640),
  z.literal(1024),
  z.literal(2048),
  z.literal(4096),
]);

export const readAttachmentThumbnailResultSchema = result(
  z
    .object({
      attachmentId: id,
      dataUrl: z.string().min(1).max(12 * 1024 * 1024),
      bucket: thumbnailBucketSchema,
      width: z.number().int().positive().max(32_768),
      height: z.number().int().positive().max(32_768),
      revision: z.string().min(1).max(256),
      requestVersion: z.number().int().nonnegative(),
    })
    .strict()
);

export const listGalleryEntriesResultSchema = result(
  z
    .object({
      entries: z.array(galleryAssociationSchema).max(10_000),
      galleryGeneration: z.number().int().nonnegative(),
    })
    .strict()
);

export type PutAttachmentResult = z.infer<typeof putAttachmentResultSchema>;
export type ReadAttachmentThumbnailResult = z.infer<
  typeof readAttachmentThumbnailResultSchema
>;
export type ListGalleryEntriesResult = z.infer<
  typeof listGalleryEntriesResultSchema
>;

export async function galleryPayloadFingerprint(input: {
  occurrenceId: string;
  blobId: string;
  logicalKey: string;
  sourceRevision: string;
  completedAt: number;
  assistantSeq?: number;
  itemOrdinal?: number;
  sourceChatId?: string;
  sourceIncarnationId?: string;
  attachmentId: string;
  rowId: string;
  columnId: string;
  dateColumnId?: string;
}) {
  const canonical = [
    input.occurrenceId,
    input.blobId,
    input.logicalKey,
    input.sourceRevision,
    input.completedAt,
    input.assistantSeq ?? -1,
    input.itemOrdinal ?? -1,
    input.sourceChatId ?? "",
    input.sourceIncarnationId ?? "",
    input.attachmentId,
    input.rowId,
    input.columnId,
    input.dateColumnId ?? "",
  ].join("\0");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical)
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function transcriptOccurrenceId(input: {
  chatId: string;
  incarnationId: string;
  assistantSeq: number;
  itemId: string;
}) {
  return galleryOccurrenceKey({ kind: "transcript", ...input });
}

export function manualOccurrenceId(opId: string) {
  return `manual:${opId}`;
}
