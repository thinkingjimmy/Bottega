/**
 * [INPUT]: Depends on @ai-chat/base-core semantic contracts and shared Base snapshots, mutations, attachment DTOs and history records.
 * [OUTPUT]: Provides type-only Base data/mutation/private attachment ports, including account-scoped source-device display names and the optional image-source admission of converting hosts; no runtime export.
 * [POS]: Platform boundary; browser memory and desktop stores implement the same presentation contracts.
 */
import type { BaseColumn, BaseMetaPatch, BaseSnapshot, BaseRow, BaseRowPatch, BaseAttachmentValue, PutAttachmentRequest,
  PutAttachmentResult } from "@ai-chat/base-core/model/bases-ipc";
import type { BaseHistoryEntry } from "@ai-chat/base-core/metadata/history-ledger-schema";
import type { GalleryMediaSourceRef, GalleryThumbnailResult } from "@ai-chat/base-core/attachments/gallery-media-ipc";
export interface BaseDataSource {
  snapshots: Readonly<Record<string, BaseSnapshot>>;
  get(ownerKey: string): Promise<BaseSnapshot | null>;
  ensure(ownerKey: string): Promise<BaseSnapshot>;
  rowHistory(ownerKey: string, rowId: string): Promise<{ entries: BaseHistoryEntry[] }>;
}
export interface BaseMutationSink {
  commitRecord?(input: BaseRecordMutation): Promise<BaseSnapshot>;
  updateMeta(input: { ownerKey: string; expectedRevision: number; patch: BaseMetaPatch; surfaceLeaseId?: string }): Promise<BaseSnapshot>;
  insertRows(ownerKey: string, rows: BaseRow[], surfaceLeaseId?: string): Promise<BaseSnapshot>;
  patchRow(ownerKey: string, rowId: string, patch: BaseRowPatch, surfaceLeaseId?: string): Promise<BaseSnapshot>;
  deleteRows(ownerKey: string, rowIds: string[], expectedRevision: number, surfaceLeaseId?: string): Promise<BaseSnapshot>;
}
export type BaseRecordMutation = { ownerKey: string; ownerInstanceId: string; surfaceLeaseId?: string; rowId: string;
  columns: BaseColumn[]; baselineValues: BaseRow["values"] | null; patch: BaseRowPatch };
export interface BaseAttachmentFacade {
  sourceDeviceName?(deviceId: string, signal: AbortSignal): Promise<string | null>;
  stageImage?(input: { ownerKey: string; ownerInstanceId: string; surfaceLeaseId?: string; file: File; uploadId: string }, signal: AbortSignal,
    progress?: (value: { phase: string; bytes: number; total: number }) => void): Promise<BaseAttachmentValue>;
  discardImages?(uploadIds: string[]): Promise<void>;
  /** Set when stageImage converts picked images itself (HEIC, oversized photos, metadata); the editor then admits any image source up to the Base limit. */
  imageSources?: { accept: string; admits(file: File): boolean };
  preview(input: { value: BaseAttachmentValue; owner?: { chatId: string; incarnationId: string }; baseOwner?: { ownerKey: string; ownerInstanceId: string }; maxEdge: number },
    signal: AbortSignal): Promise<{ url: string; release(): void } | null>;
  galleryThumbnail(input: { sourceRef: GalleryMediaSourceRef; maxEdge: number }, signal: AbortSignal): Promise<GalleryThumbnailResult & { release?: () => void }>;
  putAttachment(input: PutAttachmentRequest): Promise<PutAttachmentResult>;
}
