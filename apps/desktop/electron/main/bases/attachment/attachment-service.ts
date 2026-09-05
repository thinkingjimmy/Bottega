/**
 * [INPUT]: Depends on BaseStore only submit kernel, sibling support.ts pure rules, shared attachment/Gallery DTO, thumbnail cache, owner-native/manual and canonical chat identity, admission/event narrow ports
 * [OUTPUT]: Provides owner-native manual upload, automatic transcript ingestion, id-indexed ownerKey-scoped attachment reads, thumbnails, immutable occurrence replay, and target-Chat Gallery authorization
 * [POS]: the business owner of bases/attachment; BasesService is only available as an IPC/common line gateway, and this module is exclusive to attachment
 */

import { createHash, randomUUID } from "node:crypto";
import {
  BASE_COLUMN_LIMIT,
  BASE_VIEW_LIMIT,
  isBaseAttachmentValue,
  type BaseAttachmentValue,
  type BaseChangedEvent,
  type BaseSnapshot,
  type GalleryOccurrence,
  type ListGalleryEntriesInput,
  type ListGalleryEntriesResult,
  type PutAttachmentInput,
  type PutAttachmentResult,
  type ReadAttachmentThumbnailInput,
  type ReadAttachmentThumbnailResult,
} from "../../../../shared/bases-ipc";
import {
  BASE_ATTACHMENT_THUMB_BUCKETS,
  manualOccurrenceId,
  transcriptOccurrenceId,
  galleryPayloadFingerprint,
} from "../../../../shared/bases/gallery-attachments";
import type { BaseHistoryActor } from "../../../../shared/bases/history-ledger-schema";
import type {
  GalleryMaterializeResult,
  GalleryMediaSourceRef,
  GalleryThumbnailResult,
} from "../../../../shared/gallery-media-ipc";
import { errorMessage, statusError } from "../../errors";
import type { CompletedImageEventV1 } from "../../gallery/turn-events-broker";
import {
  BaseStore,
  NO_ROWS_CHANGED,
  type BaseIdentity,
  type BaseOwnerIdentity,
} from "../base-store";
import type { IndexedBaseSnapshot } from "../base-store-model";
import { putGalleryOccurrence } from "../store/gallery-ledger";
import { parseAttachmentDataUrl } from "../store/attachments";
import { AttachmentThumbnailCache } from "../store/thumbnail-cache";
import { ownerFileStem } from "../store/base-files";
import {
  allocateViewId,
  assertReplayCompatible,
  attachmentError,
  attachmentFailure,
  chooseAttachmentColumn,
  chooseDateColumn,
  galleryFailure,
} from "./support";

const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

type AttachmentServiceOptions = {
  identity(
    chatId: string
  ): Promise<
    BaseIdentity &
      BaseOwnerIdentity & { ownerKey: string; ownerInstanceId: string }
  >;
  ownerIdentity(
    ownerKey: string
  ): Promise<BaseOwnerIdentity & { ownerKey: string; ownerInstanceId: string }>;
  authorizeDestination(
    ownerKey: string,
    ownerInstanceId: string,
    chatId: string
  ): Promise<void>;
  assertAdmission(): void;
  emitChange(
    snapshot: BaseSnapshot,
    delta: Omit<
      BaseChangedEvent,
      "type" | "ownerKey" | "ownerInstanceId" | "revision"
    >
  ): void;
  now(): number;
};

export class BaseAttachmentService {
  private readonly thumbnails = new AttachmentThumbnailCache();

  constructor(
    private readonly store: BaseStore,
    private readonly options: AttachmentServiceOptions
  ) {}

  clearFamily(ownerKey: string, ownerInstanceId: string) {
    this.thumbnails.clearFamily(`${ownerKey}/${ownerInstanceId}/`);
  }

  /** App GUI 只能按已解析 owner 读取当前 Base 仍引用的 attachment。 */
  async readAttachmentForOwner(ownerKey: string, attachmentId: string) {
    const identity = await this.options.ownerIdentity(ownerKey);
    const snapshot = this.store.peek(ownerKey, identity.ownerInstanceId);
    if (!snapshot) throw statusError(404, "Base 尚未创建");
    const value = findAttachment(snapshot, attachmentId);
    if (!value) throw statusError(404, "Attachment 不存在");
    const bytes = await this.store.attachments.read(
      ownerFileStem(ownerKey),
      identity.ownerInstanceId,
      value
    );
    return {
      bytes,
      filename: value.filename,
      mediaType: value.mediaType,
      byteLength: value.byteLength,
    };
  }

  /** actor 由调用方的 authority 决定；本层不猜「谁在写」。 */
  async putAttachment(
    input: PutAttachmentInput,
    actor: BaseHistoryActor
  ): Promise<PutAttachmentResult> {
    try {
      const identity = await this.options.ownerIdentity(input.ownerKey);
      if (identity.ownerInstanceId !== input.ownerInstanceId) {
        throw attachmentError(
          "INCARNATION_MISMATCH",
          "Attachment owner instance 已变化"
        );
      }
      const parsed = parseAttachmentDataUrl(input.dataUrl);
      if (parsed.mediaType !== input.mediaType) {
        throw statusError(400, "dataURL mediaType 与声明不一致");
      }
      return await this.ingestAttachment({
        identity,
        actor,
        occurrenceId: manualOccurrenceId(input.opId),
        logicalKey: manualOccurrenceId(input.opId),
        filename: input.filename,
        bytes: parsed.bytes,
        sourceRevision: createHash("sha256").update(parsed.bytes).digest("hex"),
        completedAt: this.options.now(),
        expectedRevision: input.expectedRevision,
        rowId: input.rowId,
        columnId: input.columnId,
      });
    } catch (cause) {
      return attachmentFailure(cause);
    }
  }

  ingestCompletedImage(
    event: CompletedImageEventV1,
    bytes: Buffer,
    filename = `${event.sourceRef.itemId}.png`
  ) {
    return this.ingestTranscriptAttachment({
      chatId: event.sourceRef.chatId,
      incarnationId: event.sourceRef.incarnationId,
      assistantSeq: event.sourceRef.assistantSeq,
      itemId: event.sourceRef.itemId,
      itemOrdinal: event.itemOrdinal,
      logicalKey: event.logicalKey,
      completedAt: event.completedAt,
      sourceRevision: event.sourceRevision,
      bytes,
      filename,
    });
  }

  async ingestTranscriptAttachment(input: {
    chatId: string;
    incarnationId: string;
    assistantSeq: number;
    itemId: string;
    itemOrdinal: number;
    logicalKey: string;
    completedAt: number;
    sourceRevision: string;
    bytes: Buffer;
    filename: string;
  }): Promise<PutAttachmentResult> {
    try {
      const identity = await this.options.identity(input.chatId);
      if (identity.incarnationId !== input.incarnationId) {
        throw attachmentError(
          "INCARNATION_MISMATCH",
          "Attachment incarnation 与当前聊天不一致"
        );
      }
      return await this.ingestAttachment({
        ...input,
        identity,
        /* transcript 图片是 agent 这一轮的产物，不是平台自发的维护写。 */
        actor: "agent",
        occurrenceId: transcriptOccurrenceId(input),
        logicalKey: transcriptLogicalKey(input),
        sourceChatId: input.chatId,
        sourceIncarnationId: input.incarnationId,
      });
    } catch (cause) {
      return attachmentFailure(cause);
    }
  }

  async readAttachmentThumbnail(
    input: ReadAttachmentThumbnailInput
  ): Promise<ReadAttachmentThumbnailResult> {
    try {
      const identity = await this.assertIdentity(
        input.chatId,
        input.incarnationId
      );
      const value = this.ownedAttachment(input, identity);
      const bytes = await this.store.attachments.read(
        ownerFileStem(identity.ownerKey),
        identity.ownerInstanceId,
        value
      );
      const bucket =
        BASE_ATTACHMENT_THUMB_BUCKETS.find(
          (candidate) => candidate >= input.maxEdge
        ) ?? 4096;
      const thumbnail = await this.thumbnails.get(
        `${identity.ownerKey}/${identity.ownerInstanceId}/${value.blobId}/${bucket}`,
        bytes,
        bucket
      );
      return {
        ok: true,
        value: {
          attachmentId: value.attachmentId,
          dataUrl: thumbnail.dataUrl,
          bucket,
          width: thumbnail.width,
          height: thumbnail.height,
          revision: value.revision,
          requestVersion: input.requestVersion,
        },
      };
    } catch (cause) {
      return attachmentFailure(cause);
    }
  }

  async listGalleryEntries(
    input: ListGalleryEntriesInput
  ): Promise<ListGalleryEntriesResult> {
    try {
      const identity = await this.assertIdentity(
        input.chatId,
        input.incarnationId
      );
      const entries = Object.values(
        this.store.gallery(
          identity.ownerKey,
          identity.ownerInstanceId
        ).associations
      )
        .filter((entry) => !input.columnId || entry.columnId === input.columnId)
        .sort(
          (left, right) =>
            left.createdAt - right.createdAt ||
            left.galleryItemId.localeCompare(right.galleryItemId)
        );
      return {
        ok: true,
        value: {
          entries,
          galleryGeneration:
            this.store.get(identity.ownerKey, identity.ownerInstanceId)!.meta
              .galleryGeneration ?? 0,
        },
      };
    } catch (cause) {
      return attachmentFailure(cause);
    }
  }

  async galleryThumbnail(
    sourceRef: GalleryMediaSourceRef,
    maxEdge: number
  ): Promise<GalleryThumbnailResult | null> {
    const owned = await this.resolveGalleryAttachment(sourceRef);
    if (!owned) return null;
    try {
      const bytes = await this.store.attachments.read(
        ownerFileStem(owned.ownerKey),
        owned.ownerInstanceId,
        owned.value
      );
      const bucket =
        BASE_ATTACHMENT_THUMB_BUCKETS.find((candidate) => candidate >= maxEdge) ??
        4096;
      const thumbnail = await this.thumbnails.get(
        `${owned.ownerKey}/${owned.ownerInstanceId}/${owned.value.blobId}/${bucket}`,
        bytes,
        bucket
      );
      return {
        ok: true,
        value: {
          dataUrl: thumbnail.dataUrl,
          bucket: bucket as 160 | 320 | 640 | 1024,
          width: thumbnail.width,
          height: thumbnail.height,
          sourceRevision: owned.value.revision,
        },
      };
    } catch (cause) {
      return galleryFailure(attachmentFailure(cause).error);
    }
  }

  async galleryMaterialize(
    sourceRef: GalleryMediaSourceRef,
    destinationChatId: string
  ): Promise<GalleryMaterializeResult | null> {
    const owned = await this.resolveGalleryAttachment(sourceRef);
    if (!owned) return null;
    try {
      await this.options.authorizeDestination(
        owned.ownerKey,
        owned.ownerInstanceId,
        destinationChatId
      );
      const bytes = await this.store.attachments.read(
        ownerFileStem(owned.ownerKey),
        owned.ownerInstanceId,
        owned.value
      );
      return {
        ok: true,
        value: {
          attachmentId: owned.value.attachmentId,
          filename: owned.value.filename,
          mediaType: owned.value.mediaType,
          dataUrl: `data:${owned.value.mediaType};base64,${bytes.toString("base64")}`,
          sourceRevision: owned.value.revision,
          materializationToken: randomUUID(),
        },
      };
    } catch (cause) {
      return galleryFailure(attachmentFailure(cause).error);
    }
  }

  async assertGalleryAttachmentAuthorized(
    sourceRef: Extract<GalleryMediaSourceRef, { kind: "attachment" }>,
    destinationChatId: string
  ) {
    const owned = await this.resolveGalleryAttachment(sourceRef);
    if (!owned) return false;
    await this.options.authorizeDestination(
      owned.ownerKey,
      owned.ownerInstanceId,
      destinationChatId
    );
    return true;
  }

  private async ingestAttachment(input: {
    identity: BaseOwnerIdentity & {
      ownerKey: string;
      ownerInstanceId: string;
    };
    actor: BaseHistoryActor;
    occurrenceId: string;
    logicalKey: string;
    filename: string;
    bytes: Buffer;
    sourceRevision: string;
    completedAt: number;
    assistantSeq?: number;
    itemOrdinal?: number;
    sourceChatId?: string;
    sourceIncarnationId?: string;
    expectedRevision?: number;
    rowId?: string;
    columnId?: string;
  }): Promise<PutAttachmentResult> {
    this.options.assertAdmission();
    const { identity } = input;
    await this.store.ensure({
      owner: identity.owner,
      ownerInstanceId: identity.ownerInstanceId,
      title: identity.title,
    });
    const described = this.store.attachments.describe({
      filename: input.filename,
      bytes: input.bytes,
      sourceRevision: input.sourceRevision,
    });
    const generatedRowId = `gallery_${createHash("sha256")
      .update(input.occurrenceId)
      .digest("hex")
      .slice(0, 24)}`;
    let committedRowId = "";
    let changed = false;
    let targetDateColumnId = "";
    const committed = await this.store.transactGallery(
      identity.ownerKey,
      identity.ownerInstanceId,
      async ({ snapshot, gallery }) => {
        this.options.assertAdmission();
        if (
          input.expectedRevision !== undefined &&
          snapshot.meta.revision !== input.expectedRevision
        ) {
          throw statusError(
            409,
            `Base revision 已变化：期望 ${input.expectedRevision}，实际 ${snapshot.meta.revision}`
          );
        }
        const meta = structuredClone(snapshot.meta);
        const columnId = chooseAttachmentColumn(
          meta,
          gallery.targetColumnId,
          input.columnId
        );
        if (!meta.columns.some((column) => column.id === columnId)) {
          if (meta.columns.length >= BASE_COLUMN_LIMIT) {
            throw statusError(400, "Base 列数超限，无法自动创建 Image 列");
          }
          meta.columns.push({ id: columnId, name: "Image", type: "attachment" });
        }
        const dateColumnId = chooseDateColumn(meta, gallery.targetDateColumnId);
        targetDateColumnId = dateColumnId;
        if (!meta.columns.some((column) => column.id === dateColumnId)) {
          if (meta.columns.length >= BASE_COLUMN_LIMIT) {
            throw statusError(400, "Base 列数超限，无法自动创建 Created at 列");
          }
          meta.columns.push({
            id: dateColumnId,
            name: "Created at",
            type: "date",
          });
        }
        const previousOccurrence = gallery.occurrences[input.occurrenceId];
        const rowId = input.rowId ?? previousOccurrence?.rowId ?? generatedRowId;
        committedRowId = rowId;
        const existingRow = rowsById(this.store, identity)?.get(rowId);
        const occupied = existingRow?.values[columnId];
        if (occupied && !isBaseAttachmentValue(occupied)) {
          throw attachmentError(
            "ATTACHMENT_CONFLICT",
            `row ${rowId} 的目标 cell 已被占用`
          );
        }
        if (previousOccurrence) {
          assertReplayCompatible(previousOccurrence, {
            blobId: described.blobId,
            attachmentId: described.attachmentId,
            logicalKey: input.logicalKey,
            sourceRevision: input.sourceRevision,
            completedAt: input.completedAt,
            assistantSeq: input.assistantSeq,
            itemOrdinal: input.itemOrdinal,
            sourceChatId: input.sourceChatId,
            sourceIncarnationId: input.sourceIncarnationId,
            rowId,
            columnId,
            dateColumnId,
          });
        }
        const completedAt = previousOccurrence?.completedAt ?? input.completedAt;
        const logicalKey = previousOccurrence?.logicalKey ?? input.logicalKey;
        const fingerprint = previousOccurrence?.fingerprint ?? await galleryPayloadFingerprint({
          occurrenceId: input.occurrenceId,
          blobId: described.blobId,
          logicalKey,
          sourceRevision: input.sourceRevision,
          completedAt,
          assistantSeq: input.assistantSeq,
          itemOrdinal: input.itemOrdinal,
          sourceChatId: input.sourceChatId,
          sourceIncarnationId: input.sourceIncarnationId,
          attachmentId: described.attachmentId,
          rowId,
          columnId,
          dateColumnId,
        });
        const occurrence: GalleryOccurrence = {
          occurrenceId: input.occurrenceId,
          blobId: described.blobId,
          attachmentId: described.attachmentId,
          logicalKey,
          sourceRevision: input.sourceRevision,
          completedAt,
          ...(input.assistantSeq === undefined
            ? {}
            : { assistantSeq: input.assistantSeq }),
          ...(input.itemOrdinal === undefined
            ? {}
            : { itemOrdinal: input.itemOrdinal }),
          ...(input.sourceChatId
            ? { sourceChatId: input.sourceChatId }
            : {}),
          ...(input.sourceIncarnationId
            ? { sourceIncarnationId: input.sourceIncarnationId }
            : {}),
          rowId,
          columnId,
          dateColumnId,
          fingerprint,
          createdAt: this.options.now(),
        };
        const ledgerResult = putGalleryOccurrence(
          gallery,
          occurrence,
          this.options.now()
        );
        if (ledgerResult.idempotent) {
          // putGalleryOccurrence 已保证幂等分支的 association 存在且指向同 cell。
          return {
            mutation: null,
            result: {
              attachmentId: described.attachmentId,
              rowId,
              columnId,
              galleryItemId: `${rowId}:${columnId}`,
              revision: described.revision,
              idempotent: true,
            },
          };
        }
        ledgerResult.ledger.targetDateColumnId ??= dateColumnId;
        const stored = await this.store.attachments.put({
          chatId: ownerFileStem(identity.ownerKey),
          incarnationId: identity.ownerInstanceId,
          filename: input.filename,
          bytes: input.bytes,
          sourceRevision: input.sourceRevision,
        });
        if (!same(stored.value, described)) {
          throw new Error("Attachment describe/put 结果不一致");
        }
        const rows = existingRow
          ? snapshot.rows.map((row) =>
              row.id === rowId
                ? {
                    ...row,
                    values: {
                      ...row.values,
                      [dateColumnId]:
                        row.values[dateColumnId] ??
                        new Date(completedAt).toISOString(),
                      [columnId]: stored.value,
                    },
                  }
                : row
            )
          : [
              ...snapshot.rows,
              {
                id: rowId,
                values: {
                  [columnId]: stored.value,
                  [dateColumnId]: new Date(completedAt).toISOString(),
                },
              },
            ];
        changed = true;
        return {
          mutation: {
            meta: { ...meta, revision: snapshot.meta.revision + 1 },
            rows,
            changedRowIds: new Set([rowId]),
            gallery: ledgerResult.ledger,
            galleryChanged: true,
            actor: input.actor,
            operation: "attachment-put",
          },
          result: {
            attachmentId: stored.value.attachmentId,
            rowId,
            columnId,
            galleryItemId: `${rowId}:${columnId}`,
            revision: stored.value.revision,
            idempotent: false,
          },
        };
      }
    );
    if (!committed.result) {
      throw new Error("Attachment transaction 未返回结果");
    }
    if (changed) {
      this.options.emitChange(committed.snapshot, {
        meta: committed.snapshot.meta,
        upserts: committed.snapshot.rows.filter(
          (row) => row.id === committedRowId
        ),
      });
    }
    if (targetDateColumnId) {
      await this.ensureAutoGallery(
        input.actor,
        identity.ownerKey,
        identity.ownerInstanceId,
        committed.result.columnId,
        targetDateColumnId
      ).catch((cause) =>
        console.warn(`Gallery 自动建 View 失败：${errorMessage(cause)}`)
      );
    }
    return { ok: true, value: committed.result };
  }

  private async ensureAutoGallery(
    actor: BaseHistoryActor,
    ownerKey: string,
    ownerInstanceId: string,
    attachmentColumnId: string,
    groupByDateColumnId: string
  ) {
    let changed = false;
    const committed = await this.store.transactGallery(
      ownerKey,
      ownerInstanceId,
      async ({ snapshot, gallery }) => {
        if (gallery.autoGalleryState && gallery.autoGalleryState !== "pending") {
          return null;
        }
        const nextGallery = structuredClone(gallery);
        const alreadyExists = snapshot.meta.views.some(
          (view) => view.config.type === "gallery"
        );
        const atLimit = snapshot.meta.views.length >= BASE_VIEW_LIMIT;
        nextGallery.autoGalleryState = alreadyExists
          ? "created"
          : atLimit
            ? "suppressed"
            : "created";
        const views = alreadyExists || atLimit
          ? snapshot.meta.views
          : [
              ...snapshot.meta.views,
              {
                id: allocateViewId(snapshot.meta.views, "gallery"),
                name: "Gallery",
                order: snapshot.meta.views.length,
                config: {
                  type: "gallery" as const,
                  attachmentColumnId,
                  groupByDateColumnId,
                  dateBucket: "minute" as const,
                },
              },
            ];
        changed = true;
        return {
          mutation: {
            meta: {
              ...snapshot.meta,
              views,
              revision: snapshot.meta.revision + 1,
            },
            /* 自动建 View 只碰 meta：rows 原样交回，引用相等即证明未碰行。 */
            rows: snapshot.rows,
            changedRowIds: NO_ROWS_CHANGED,
            gallery: nextGallery,
            galleryChanged: true,
            actor,
            operation: "gallery-auto-view",
          },
          result: true,
        };
      }
    );
    if (changed) {
      this.options.emitChange(committed.snapshot, {
        meta: committed.snapshot.meta,
      });
    }
  }

  private async assertIdentity(chatId: string, incarnationId: string) {
    const identity = await this.options.identity(chatId);
    if (identity.incarnationId !== incarnationId) {
      throw attachmentError(
        "INCARNATION_MISMATCH",
        "Attachment incarnation 与当前聊天不一致"
      );
    }
    if (!this.store.get(identity.ownerKey, identity.ownerInstanceId)) {
      throw attachmentError("ATTACHMENT_NOT_FOUND", "Base 尚未创建");
    }
    return identity;
  }

  private ownedAttachment(input: {
    chatId: string;
    incarnationId: string;
    attachmentId: string;
    revision: string;
  }, identity: Awaited<ReturnType<AttachmentServiceOptions["identity"]>>): BaseAttachmentValue {
    const ledger = this.store.gallery(
      identity.ownerKey,
      identity.ownerInstanceId
    );
    const snapshot = rowsSnapshot(this.store, identity);
    // attachmentId 是内容寻址：同字节不同 revision 会有多条 association，
    // 必须按 attachmentId + revision 双键匹配，取首条会误判 NOT_FOUND。
    for (const association of Object.values(ledger.associations)) {
      if (association.attachmentId !== input.attachmentId) continue;
      const value = snapshot?.rowsById.get(association.rowId)
        ?.values[association.columnId];
      if (
        isBaseAttachmentValue(value) &&
        value.attachmentId === input.attachmentId &&
        value.revision === input.revision
      ) {
        return value;
      }
    }
    throw attachmentError(
      "ATTACHMENT_NOT_FOUND",
      "Attachment 不存在或 revision 已失效"
    );
  }

  private async resolveGalleryAttachment(sourceRef: GalleryMediaSourceRef) {
    try {
      if (sourceRef.kind === "attachment") {
        const value = rowsById(this.store, sourceRef)?.get(sourceRef.rowId)
          ?.values[sourceRef.columnId];
        return isBaseAttachmentValue(value) &&
          value.attachmentId === sourceRef.attachmentId &&
          value.revision === sourceRef.sourceRevision
          ? {
              ownerKey: sourceRef.ownerKey,
              ownerInstanceId: sourceRef.ownerInstanceId,
              value,
            }
          : null;
      }
      const identity = await this.assertIdentity(
        sourceRef.chatId,
        sourceRef.incarnationId
      );
      const ledger = this.store.gallery(
        identity.ownerKey,
        identity.ownerInstanceId
      );
      const galleryItemId = ledger.aliases[transcriptLogicalKey(sourceRef)];
      if (!galleryItemId) return null;
      const association = ledger.associations[galleryItemId];
      if (!association) return null;
      const value = rowsById(this.store, identity)?.get(association.rowId)
        ?.values[association.columnId];
      return isBaseAttachmentValue(value)
        ? {
            association,
            ownerKey: identity.ownerKey,
            ownerInstanceId: identity.ownerInstanceId,
            value,
          }
        : null;
    } catch {
      return null;
    }
  }
}

function transcriptLogicalKey(input: {
  chatId: string;
  incarnationId: string;
  assistantSeq: number;
  itemId: string;
}) {
  return `transcript:${input.chatId}:${input.incarnationId}:${input.assistantSeq}:${input.itemId}`;
}

type OwnerRef = { ownerKey: string; ownerInstanceId: string };

const rowsSnapshot = (store: BaseStore, owner: OwnerRef) =>
  store.peek(owner.ownerKey, owner.ownerInstanceId);

/** 行按 id 直取：association.rowId → row → cell，不再为一张缩略图扫全表。 */
const rowsById = (store: BaseStore, owner: OwnerRef) =>
  rowsSnapshot(store, owner)?.rowsById;

/** 逐行扫但扫到即止：只给了 attachmentId 时，这是唯一的退路。 */
function findAttachment(snapshot: IndexedBaseSnapshot, attachmentId: string) {
  for (const row of snapshot.rowsById.values()) {
    for (const value of Object.values(row.values)) {
      if (isBaseAttachmentValue(value) && value.attachmentId === attachmentId) {
        return value;
      }
    }
  }
  return undefined;
}
