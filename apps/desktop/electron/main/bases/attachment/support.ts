/**
 * [INPUT]: Depends on shared Base attachment/Gallery type, column/view budget and main error text
 * [OUTPUT]: Provides attachment replay consistency, rows/views allocation and failure mapping pure rules
 * [POS]: The base/attachment sub-module has no status sheets; attachment-service Only retains IO and transaction order
 */

import {
  BASE_COLUMN_LIMIT,
  BASE_VIEW_LIMIT,
  type BaseAttachmentFailure,
  type BaseMeta,
  type GalleryOccurrence,
} from "../../../../shared/bases-ipc";
import type { GalleryMediaError } from "../../../../shared/gallery-media-ipc";
import { errorMessage } from "../../errors";
import { AttachmentBudgetError } from "../store/attachments";

export function assertReplayCompatible(
  previous: GalleryOccurrence,
  incoming: Pick<
    GalleryOccurrence,
    | "blobId"
    | "attachmentId"
    | "logicalKey"
    | "sourceRevision"
    | "completedAt"
    | "assistantSeq"
    | "itemOrdinal"
    | "sourceChatId"
    | "sourceIncarnationId"
    | "rowId"
    | "columnId"
    | "dateColumnId"
  >
) {
  const exact = [
    "blobId",
    "attachmentId",
    "sourceRevision",
    "assistantSeq",
    "itemOrdinal",
    "rowId",
    "columnId",
  ] as const;
  const drifted =
    exact.some((key) => previous[key] !== incoming[key]) ||
    (!previous.occurrenceId.startsWith("manual:") &&
      previous.completedAt !== incoming.completedAt);
  const sourceDrifted =
    (previous.sourceChatId !== undefined &&
      previous.sourceChatId !== incoming.sourceChatId) ||
    (previous.sourceIncarnationId !== undefined &&
      previous.sourceIncarnationId !== incoming.sourceIncarnationId) ||
    (previous.dateColumnId !== undefined &&
      previous.dateColumnId !== incoming.dateColumnId);
  if (
    drifted ||
    sourceDrifted ||
    !compatibleLogicalKey(previous.logicalKey, incoming.logicalKey)
  ) {
    throw attachmentError(
      "ATTACHMENT_CONFLICT",
      `Occurrence ${previous.occurrenceId} immutable payload 冲突`
    );
  }
}

/** 只放行 v1 transcript:key → v2 transcript:chat:incarnation:key 的一次升级。 */
function compatibleLogicalKey(previous: string, incoming: string) {
  if (previous === incoming) return true;
  if (!previous.startsWith("transcript:") || !incoming.startsWith("transcript:")) {
    return false;
  }
  return incoming.endsWith(`:${previous.slice("transcript:".length)}`);
}

export function chooseAttachmentColumn(
  meta: BaseMeta,
  targetColumnId?: string,
  requestedColumnId?: string
) {
  if (requestedColumnId) {
    const requested = meta.columns.find(
      (column) => column.id === requestedColumnId
    );
    if (requested && requested.type !== "attachment") {
      throw attachmentError(
        "INVALID_INPUT",
        `列 ${requestedColumnId} 不是 attachment 类型`
      );
    }
    return requestedColumnId;
  }
  if (
    targetColumnId &&
    meta.columns.some(
      (column) =>
        column.id === targetColumnId && column.type === "attachment"
    )
  ) {
    return targetColumnId;
  }
  const attachment = meta.columns.find(
    (column) => column.type === "attachment"
  );
  if (attachment) return attachment.id;
  if (!meta.columns.some((column) => column.id === "image")) return "image";
  for (let index = 2; index <= BASE_COLUMN_LIMIT; index += 1) {
    const id = `image_${index}`;
    if (!meta.columns.some((column) => column.id === id)) return id;
  }
  throw attachmentError("INVALID_INPUT", "无法分配 attachment 列");
}

export function chooseDateColumn(meta: BaseMeta, targetDateColumnId?: string) {
  if (
    targetDateColumnId &&
    meta.columns.some(
      (column) => column.id === targetDateColumnId && column.type === "date"
    )
  ) {
    return targetDateColumnId;
  }
  for (let index = 1; index <= BASE_COLUMN_LIMIT; index += 1) {
    const id = index === 1 ? "created_at" : `created_at_${index}`;
    const column = meta.columns.find((candidate) => candidate.id === id);
    if (!column || column.type === "date") return id;
  }
  throw attachmentError("INVALID_INPUT", "无法分配 date 列");
}

export function allocateViewId(views: BaseMeta["views"], preferred: string) {
  if (!views.some((view) => view.id === preferred)) return preferred;
  for (let index = 2; index <= BASE_VIEW_LIMIT; index += 1) {
    const id = `${preferred}_${index}`;
    if (!views.some((view) => view.id === id)) return id;
  }
  throw new Error("Base 视图数超限");
}

export function attachmentError(
  code: BaseAttachmentFailure["error"]["code"],
  message: string,
  retryable = false
) {
  return Object.assign(new Error(message), { code, retryable });
}

export function attachmentFailure(cause: unknown): BaseAttachmentFailure {
  const candidate = cause as {
    code?: BaseAttachmentFailure["error"]["code"];
    retryable?: boolean;
    status?: number;
  };
  const code =
    candidate.code ??
    (cause instanceof AttachmentBudgetError
      ? "BUDGET_EXCEEDED"
      : candidate.status === 409
        ? "ATTACHMENT_CONFLICT"
        : candidate.status === 400
          ? "INVALID_INPUT"
          : "IO_ERROR");
  return {
    ok: false,
    error: {
      code,
      message: errorMessage(cause),
      retryable: candidate.retryable ?? code === "IO_ERROR",
    },
  };
}

export function galleryFailure(
  error: BaseAttachmentFailure["error"]
): GalleryMediaError {
  const code =
    error.code === "INCARNATION_MISMATCH"
      ? "INCARNATION_MISMATCH"
      : error.code === "BUDGET_EXCEEDED"
        ? "BUDGET_EXCEEDED"
        : error.code === "QUEUE_FULL"
          ? "QUEUE_FULL"
          : error.code === "DECODE_FAILED"
            ? "INVALID_IMAGE"
            : error.code === "ATTACHMENT_NOT_FOUND"
              ? "SOURCE_GONE"
              : "IO_ERROR";
  return {
    ok: false,
    error: {
      code,
      retryable: error.retryable,
      message: error.message,
    },
  };
}

export function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
