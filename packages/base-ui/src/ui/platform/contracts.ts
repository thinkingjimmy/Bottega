/**
 * [INPUT]: Depends on shared Base snapshots, mutations, attachment DTOs and history records.
 * [OUTPUT]: Defines Base data/mutation/list/private attachment ports, including account-scoped source-device display names.
 * [POS]: Platform boundary; browser memory and desktop stores implement the same presentation contracts.
 */
import type { BaseColumn, BaseMetaPatch, BaseSnapshot, BaseRow, BaseRowPatch, BaseAttachmentValue, PutAttachmentRequest,
  PutAttachmentResult, BaseNavigationSummary } from "../../model/bases-ipc";
import type { BaseHistoryEntry } from "../../metadata/history-ledger-schema";
import type { GalleryMediaSourceRef, GalleryThumbnailResult } from "../../attachments/gallery-media-ipc";
export type BaseQueryState = "loading" | "ready" | "updating" | "over-limit" | "error";
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
export interface BaseListSource {
  list(input: { cursor: string | null; projectId?: string }): Promise<{ items: BaseNavigationSummary[]; cursor: string | null }>;
}
export interface BaseAttachmentFacade {
  sourceDeviceName?(deviceId: string, signal: AbortSignal): Promise<string | null>;
  stageImage?(input: { ownerKey: string; ownerInstanceId: string; surfaceLeaseId?: string; file: File; uploadId: string }, signal: AbortSignal,
    progress?: (value: { phase: string; bytes: number; total: number }) => void): Promise<BaseAttachmentValue>;
  discardImages?(uploadIds: string[]): Promise<void>;
  preview(input: { value: BaseAttachmentValue; owner?: { chatId: string; incarnationId: string }; baseOwner?: { ownerKey: string; ownerInstanceId: string }; maxEdge: number },
    signal: AbortSignal): Promise<{ url: string; release(): void } | null>;
  galleryThumbnail(input: { sourceRef: GalleryMediaSourceRef; maxEdge: number }, signal: AbortSignal): Promise<GalleryThumbnailResult & { release?: () => void }>;
  putAttachment(input: PutAttachmentRequest): Promise<PutAttachmentResult>;
}
