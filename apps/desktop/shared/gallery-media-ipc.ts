/**
 * [INPUT]: Depends on zod; The receiving renderer contains only transcripts or the owner-native Base attachment identity of the Gallery media request
 * [OUTPUT]: Provides dual variant sourceRef, unambiguous occurrence/logicalKey, source/destination separated logistics requests, projection events, indexing records and summary results
 * [POS]: The Gallery's media security borders; Any renderer visible structure does not contain a work area path or read lease
 */

import { z } from "zod";

export const GALLERY_THUMB_BUCKETS = [160, 320, 640, 1024] as const;
export const GALLERY_LOGICAL_KEY_LIMIT = 8 * 1024;

function isUnicodeScalarString(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

const unicodeScalar = (value: string) => isUnicodeScalarString(value);

export const transcriptGallerySourceRefSchema = z
  .object({
    kind: z.literal("transcript"),
    chatId: z.string().min(1).max(128).refine(unicodeScalar),
    incarnationId: z.string().min(1).max(128).refine(unicodeScalar),
    assistantSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    itemId: z.string().min(1).max(256).refine(unicodeScalar),
  })
  .strict();

export const galleryAttachmentSourceRefSchema = z
  .object({
    kind: z.literal("attachment"),
    ownerKey: z
      .string()
      .regex(/^(?:chat|project):[A-Za-z0-9_-]{1,128}$/),
    ownerInstanceId: z.string().min(1).max(128).refine(unicodeScalar),
    rowId: z.string().min(1).max(128).refine(unicodeScalar),
    columnId: z.string().min(1).max(128).refine(unicodeScalar),
    attachmentId: z.string().min(1).max(128).refine(unicodeScalar),
    sourceRevision: z.string().min(1).max(256),
  })
  .strict();

export const galleryMediaSourceRefSchema = z.discriminatedUnion("kind", [
  transcriptGallerySourceRefSchema,
  galleryAttachmentSourceRefSchema,
]);

/** 案 A 的转录投影维持窄类型；双源 media port 使用 GalleryMediaSourceRef。 */
export const gallerySourceRefSchema = transcriptGallerySourceRefSchema;
export type GallerySourceRef = z.infer<typeof gallerySourceRefSchema>;
export type TranscriptGallerySourceRef = z.infer<
  typeof transcriptGallerySourceRefSchema
>;
export type AttachmentGallerySourceRef = z.infer<
  typeof galleryAttachmentSourceRefSchema
>;
export type GalleryMediaSourceRef = z.infer<
  typeof galleryMediaSourceRefSchema
>;

export const GALLERY_MEDIA_ERROR_CODES = [
  "OUT_OF_WORKSPACE",
  "INCARNATION_MISMATCH",
  "SOURCE_GONE",
  "CACHE_PENDING",
  "BUDGET_EXCEEDED",
  "UNSUPPORTED_FORMAT",
  "INVALID_IMAGE",
  "TOO_LARGE",
  "DECODE_TIMEOUT",
  "QUEUE_FULL",
  "IO_ERROR",
] as const;

export type GalleryMediaErrorCode =
  (typeof GALLERY_MEDIA_ERROR_CODES)[number];

export type GalleryMediaError = {
  ok: false;
  error: {
    code: GalleryMediaErrorCode;
    retryable: boolean;
    message: string;
  };
};

export type GalleryThumbnailResult =
  | {
      ok: true;
      value: {
        dataUrl: string;
        bucket: (typeof GALLERY_THUMB_BUCKETS)[number];
        width: number;
        height: number;
        sourceRevision: string;
      };
    }
  | GalleryMediaError;

export type GalleryMaterializeResult =
  | {
      ok: true;
      value: {
        attachmentId: string;
        filename: string;
        mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
        dataUrl: string;
        sourceRevision: string;
        materializationToken: string;
      };
    }
  | GalleryMediaError;

export type GalleryItemProjectionEventV1 = {
  schemaVersion: 1;
  type: "completed-image";
  sourceRef: TranscriptGallerySourceRef;
  messageId?: string;
  itemOrdinal: number;
  logicalKey: string;
  sourceRevision: string;
  completedAt: number;
};

export const galleryMediaIndexRecordV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    incarnationId: z.string().min(1).max(128).refine(unicodeScalar),
    assistantSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    itemId: z.string().min(1).max(256).refine(unicodeScalar),
    messageId: z.string().min(1).max(256).optional(),
    itemOrdinal: z.number().int().nonnegative(),
    logicalKey: z.string().min(1).max(GALLERY_LOGICAL_KEY_LIMIT),
    sourceRevision: z.string().min(1).max(256),
    file: z.string().regex(/^[a-f0-9]{64}\.(?:png|jpe?g|webp|gif)$/),
    width: z.number().int().positive().max(32_768),
    height: z.number().int().positive().max(32_768),
    completedAt: z.number().finite().nonnegative(),
    copiedAt: z.number().finite().nonnegative(),
  })
  .strict()
  .refine(
    (record) =>
      record.width <= Math.floor(100_000_000 / record.height),
    {
    message: "TOO_LARGE",
    }
  );

export type GalleryMediaIndexRecordV1 = z.infer<
  typeof galleryMediaIndexRecordV1Schema
>;

export const galleryThumbnailInputSchema = z
  .object({
    sourceRef: galleryMediaSourceRefSchema,
    maxEdge: z.number().int().positive().max(1024),
  })
  .strict();

export const galleryMaterializeInputSchema = z
  .object({
    sourceRef: galleryMediaSourceRefSchema,
    destinationChatId: z.string().min(1).max(128),
  })
  .strict();

export const GALLERY_MEDIA_CHANNEL = {
  thumbnail: "gallery-media:thumbnail",
  materialize: "gallery-media:materialize",
  event: "gallery-media:event",
} as const;

export type GalleryMediaBridgeApi = {
  thumbnail(
    input: z.input<typeof galleryThumbnailInputSchema>
  ): Promise<GalleryThumbnailResult>;
  materialize(
    input: z.input<typeof galleryMaterializeInputSchema>
  ): Promise<GalleryMaterializeResult>;
  onGalleryMediaEvent(
    callback: (event: GalleryItemProjectionEventV1) => void
  ): () => void;
};

const CANONICAL_OCCURRENCE_ID_LIMIT = 8 * 1024;

function occurrenceSegment(value: string) {
  return encodeURIComponent(value);
}

function decodeOccurrenceSegment(value: string) {
  try {
    const decoded = decodeURIComponent(value);
    return occurrenceSegment(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * transcript occurrence 始终是四段，但每段先独立 percent-encode。
 * 因此旧的 ASCII 四段 id 保持原字节，冒号、百分号和 Unicode 也不会破坏分段。
 */
export const transcriptGalleryOccurrenceIdSchema = z
  .string()
  .min(1)
  .max(CANONICAL_OCCURRENCE_ID_LIMIT)
  .refine((value) => {
    const parts = value.split(":");
    if (parts.length !== 4 || !/^(?:0|[1-9]\d*)$/.test(parts[2]!)) {
      return false;
    }
    const chatId = decodeOccurrenceSegment(parts[0]!);
    const incarnationId = decodeOccurrenceSegment(parts[1]!);
    const itemId = decodeOccurrenceSegment(parts[3]!);
    const assistantSeq = Number(parts[2]);
    return (
      chatId !== null &&
      incarnationId !== null &&
      itemId !== null &&
      Number.isSafeInteger(assistantSeq) &&
      transcriptGallerySourceRefSchema.safeParse({
        kind: "transcript",
        chatId,
        incarnationId,
        assistantSeq,
        itemId,
      }).success
    );
  }, "Canonical transcript occurrenceId 格式无效");

export function galleryOccurrenceKey(sourceRef: GalleryMediaSourceRef) {
  return sourceRef.kind === "transcript"
    ? [
        sourceRef.chatId,
        sourceRef.incarnationId,
        String(sourceRef.assistantSeq),
        sourceRef.itemId,
      ]
        .map(occurrenceSegment)
        .join(":")
    : [
        "attachment",
        sourceRef.ownerKey,
        sourceRef.ownerInstanceId,
        sourceRef.rowId,
        sourceRef.columnId,
        sourceRef.attachmentId,
      ]
        .map(occurrenceSegment)
        .join(":");
}

/** renderer/main 共用的消费身份；不得以内容寻址 attachmentId 代替 occurrence。 */
export function gallerySourceLogicalKey(sourceRef: GalleryMediaSourceRef) {
  return sourceRef.kind === "transcript"
    ? `transcript:${sourceRef.assistantSeq}:${sourceRef.itemId}`
    : [
        "base",
        sourceRef.ownerKey,
        sourceRef.ownerInstanceId,
        sourceRef.rowId,
        sourceRef.columnId,
        sourceRef.attachmentId,
      ]
        .map(occurrenceSegment)
        .join(":");
}
