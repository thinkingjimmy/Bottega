/**
 * [INPUT]: Depends on zod, strict RichInput and transcript/owner-native attachment Gallery sourceRef schema; Receiving frozen messages, credible back-source identity, dual tokens, backend and capability epoch
 * [OUTPUT]: Provides freezeGalleryDraft PreparedSubmissionV1 strict RichValue/cross consistency schema, unified 8KiB logicalKey Budget, type and stable comment template
 * [POS]: The Gallery renderer is frozen in the middle mode of shared; The route is pre-encoded in SubmissionContent V1, not directly into the main envelope
 */

import { z } from "zod";
import { ATTACHMENT_LIMIT } from "./agent-ipc";
import { agentBackendIdSchema } from "./agent-schema";
import {
  GALLERY_LOGICAL_KEY_LIMIT,
  galleryMediaSourceRefSchema,
  gallerySourceLogicalKey,
} from "./gallery-media-ipc";
import { richInputValueSchema } from "./rich-input-projection";
import { submissionFileSchema } from "./submission";

export const preparedSubmissionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    message: z
      .object({
        richValue: richInputValueSchema,
        displayText: z.string(),
        files: z.array(submissionFileSchema).max(ATTACHMENT_LIMIT),
      })
      .strict(),
    galleryAttachments: z
      .array(
        z
          .object({
            fileIndex: z.number().int().nonnegative(),
            attachmentId: z.string().min(1),
            logicalKey: z.string().min(1).max(GALLERY_LOGICAL_KEY_LIMIT),
            sourceRevision: z.string().min(1),
            selectionToken: z.string().min(1),
            materializationToken: z.string().min(1),
            sourceRef: galleryMediaSourceRefSchema,
          })
          .strict()
      )
      .max(ATTACHMENT_LIMIT),
    origin: z.object({ kind: z.literal("composer") }).strict(),
    backend: agentBackendIdSchema,
    capabilityEpoch: z.number().int().nonnegative(),
    backendEpoch: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    const fileCount = value.message.files.length;
    const fileIds = new Set<string>();
    for (const [index, file] of value.message.files.entries()) {
      if (fileIds.has(file.id)) {
        context.addIssue({
          code: "custom",
          path: ["message", "files", index, "id"],
          message: "Submission file id 不得重复",
        });
      }
      fileIds.add(file.id);
    }
    const attachmentIds = new Set<string>();
    const fileIndices = new Set<number>();
    const logicalKeys = new Set<string>();
    for (const [index, attachment] of value.galleryAttachments.entries()) {
      if (attachment.fileIndex >= fileCount) {
        context.addIssue({
          code: "custom",
          path: ["galleryAttachments", index, "fileIndex"],
          message: "fileIndex 必须指向最终 files",
        });
      }
      if (
        value.message.files[attachment.fileIndex]?.id !==
        attachment.attachmentId
      ) {
        context.addIssue({
          code: "custom",
          path: ["galleryAttachments", index, "attachmentId"],
          message: "attachmentId 必须匹配 fileIndex 指向的文件",
        });
      }
      if (
        attachment.logicalKey !== gallerySourceLogicalKey(attachment.sourceRef)
      ) {
        context.addIssue({
          code: "custom",
          path: ["galleryAttachments", index, "logicalKey"],
          message: "logicalKey 必须匹配 sourceRef",
        });
      }
      if (
        attachment.sourceRef.kind === "attachment" &&
        attachment.sourceRevision !== attachment.sourceRef.sourceRevision
      ) {
        context.addIssue({
          code: "custom",
          path: ["galleryAttachments", index, "sourceRevision"],
          message: "attachment sourceRevision 必须匹配 sourceRef",
        });
      }
      if (attachmentIds.has(attachment.attachmentId)) {
        context.addIssue({
          code: "custom",
          path: ["galleryAttachments", index, "attachmentId"],
          message: "Gallery attachmentId 不得重复",
        });
      }
      if (logicalKeys.has(attachment.logicalKey)) {
        context.addIssue({
          code: "custom",
          path: ["galleryAttachments", index, "logicalKey"],
          message: "Gallery logicalKey 不得重复",
        });
      }
      if (fileIndices.has(attachment.fileIndex)) {
        context.addIssue({
          code: "custom",
          path: ["galleryAttachments", index, "fileIndex"],
          message: "Gallery fileIndex 不得重复",
        });
      }
      attachmentIds.add(attachment.attachmentId);
      fileIndices.add(attachment.fileIndex);
      logicalKeys.add(attachment.logicalKey);
    }
  });

export type PreparedSubmissionV1 = z.infer<
  typeof preparedSubmissionV1Schema
>;

type GalleryCommentForPrompt = {
  x: number;
  y: number;
  text: string;
};

export function formatGalleryCommentBlock(
  imageNumber: number,
  comments: readonly GalleryCommentForPrompt[]
) {
  if (!comments.length) return "";
  const lines = comments.map(
    (comment, index) =>
      `${index + 1}. (x: ${percent(comment.x)}, y: ${percent(comment.y)}) ${comment.text}`
  );
  return `Image ${imageNumber}:\n${lines.join("\n")}`;
}

export function appendGalleryCommentBlocks(
  input: string,
  blocks: readonly string[]
) {
  const meaningful = blocks.filter(Boolean);
  if (!meaningful.length) return input;
  // 原文为空时不产生前导空行，模板始终以首个 Image N: 开头
  if (!input.trim()) return meaningful.join("\n\n");
  return `${input}\n\n${meaningful.join("\n\n")}`;
}

function percent(value: number) {
  return `${(Math.min(1, Math.max(0, value)) * 100).toFixed(1)}%`;
}
