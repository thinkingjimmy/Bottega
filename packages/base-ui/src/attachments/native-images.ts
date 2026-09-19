/**
 * [INPUT]: Depends on closed Base value schemas and attachment budgets.
 * [OUTPUT]: Defines bounded image staging, owner-scoped previews and atomic record commit IPC.
 * [POS]: Platform-neutral native transport contract; no filesystem paths or renderer authority cross the wire.
 */
import { z } from "zod";
import { BASE_COLUMN_LIMIT, BASE_OWNER_KEY_PATTERN, type BaseSnapshot } from "../model/bases-ipc";
import { baseCellValueSchema, baseColumnSchema } from "../model/bases-schema";
import { BASE_ATTACHMENT_BYTE_LIMIT, baseAttachmentValueSchema } from "./gallery-attachments";

export const BASE_IMAGE_PART_BYTES = 1024 * 1024;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).refine(value => !["__proto__", "prototype", "constructor"].includes(value));
const scope = z.object({ ownerKey: z.string().regex(BASE_OWNER_KEY_PATTERN), ownerInstanceId: id, surfaceLeaseId: id.optional() }).strict();
export const imageBeginSchema = scope.extend({ uploadId: z.string().uuid(), filename: z.string().min(1).max(255),
  mediaType: baseAttachmentValueSchema.shape.mediaType, byteLength: z.number().int().positive().max(BASE_ATTACHMENT_BYTE_LIMIT),
  sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const imageTransferSchema = scope.extend({ transferId: z.string().uuid() }).strict();
export const imagePartSchema = imageTransferSchema.extend({ offset: z.number().int().nonnegative().max(BASE_ATTACHMENT_BYTE_LIMIT),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.instanceof(Uint8Array).refine(value => value.byteLength > 0 && value.byteLength <= BASE_IMAGE_PART_BYTES) }).strict();
export const imageThumbnailSchema = scope.omit({ surfaceLeaseId: true }).extend({ value: baseAttachmentValueSchema,
  maxEdge: z.number().int().min(1).max(1024) }).strict();
export const baseRecordCommitSchema = scope.extend({ rowId: id, baselineValues: z.record(id, baseCellValueSchema).nullable(),
  columns: z.array(baseColumnSchema).max(BASE_COLUMN_LIMIT),
  patch: z.record(id, baseCellValueSchema.nullable()), stagedImages: z.record(id, z.string().uuid()),
}).strict().superRefine((value, context) => {
  if (Object.keys(value.patch).length > BASE_COLUMN_LIMIT || Object.keys(value.stagedImages).length > BASE_COLUMN_LIMIT ||
    new Set(value.columns.map(column => column.id)).size !== value.columns.length) context.addIssue({ code: "custom", message: "Record budget exceeded" });
});
export type ImageScope = z.infer<typeof scope>;
export type ImageBegin = z.infer<typeof imageBeginSchema>;
export type ImageTransferRequest = z.infer<typeof imageTransferSchema>;
export type ImagePart = z.infer<typeof imagePartSchema>;
export type ImageThumbnail = z.infer<typeof imageThumbnailSchema>;
export type BaseRecordCommit = z.infer<typeof baseRecordCommitSchema>;
export const imageStatusSchema = z.object({ transferId: z.string().uuid(), offset: z.number().int().nonnegative().max(BASE_ATTACHMENT_BYTE_LIMIT),
  value: baseAttachmentValueSchema.optional() }).strict();
export type ImageStatus = z.infer<typeof imageStatusSchema>;
export const imageErrorSchema = z.enum(["image_upload_limit", "image_transfer_missing", "image_transfer_conflict", "image_invalid",
  "image_transfer_io", "base_scope_changed", "record_conflict", "record_missing", "schema_conflict", "invalid_record", "record_save_failed"]);
export type ImageErrorCode = z.infer<typeof imageErrorSchema>;
export type ImageReply<T> = { ok: true; value: T } | { ok: false; error: { code: ImageErrorCode; retryable: boolean } };
export interface BaseImagesBridge {
  begin(input: ImageBegin): Promise<ImageReply<ImageStatus>>;
  part(input: ImagePart): Promise<ImageReply<ImageStatus>>;
  finish(input: ImageTransferRequest): Promise<ImageReply<ImageStatus>>;
  cancel(input: ImageTransferRequest): Promise<ImageReply<null>>;
  commitRecord(input: BaseRecordCommit): Promise<ImageReply<BaseSnapshot>>;
  thumbnail(input: ImageThumbnail): Promise<ImageReply<{ dataUrl: string; width: number; height: number } | null>>;
}
export const BASE_IMAGE_CHANNEL = { begin: "bases:image-begin", part: "bases:image-part", finish: "bases:image-finish",
  cancel: "bases:image-cancel", commitRecord: "bases:record-commit", thumbnail: "bases:image-thumbnail" } as const;
