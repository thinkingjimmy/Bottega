/**
 * [INPUT]: Depends on shared Gallery items and logical receipt DTOs.
 * [OUTPUT]: Defines optional host-owned selection, comment and Composer focus integration.
 * [POS]: Gallery presentation boundary; no Agent, composer store or materialization authority enters this package.
 */
import type { GalleryItem } from "../media/model";
import type { ListGalleryEntriesInput, ListGalleryEntriesResult } from "../../model/bases-ipc";
export type GalleryComment = { id: string; version: number; x: number; y: number; text: string };
export type GalleryPresentationState = { selections: ReadonlyMap<string, unknown>; comments: ReadonlyMap<string, GalleryComment[]> };
type ReadyItem = Extract<GalleryItem, { phase: "ready" }>;
export interface GalleryIntegration {
  subscribe(chatId: string, listener: () => void): () => void;
  read(chatId: string): GalleryPresentationState;
  selectGalleryItem(chatId: string, item: ReadyItem, multiple: boolean): Promise<void>;
  saveGalleryComment(chatId: string, item: ReadyItem, comment: Partial<GalleryComment> & Pick<GalleryComment, "x" | "y" | "text">): unknown;
  deleteGalleryComment(chatId: string, logicalKey: string, id: string): void;
  reconcileGallerySources(chatId: string, keys: ReadonlySet<string>): void;
  expireGallerySource(chatId: string, logicalKey: string): void;
  migrateGalleryIdentity(chatId: string, logicalKey: string, item: ReadyItem): void;
  listBaseGalleryEntries(input: ListGalleryEntriesInput): Promise<ListGalleryEntriesResult>;
  registerGalleryFocus(chatId: string, focus: () => void): () => void;
  focusComposer(chatId: string): void;
}
export const EMPTY_GALLERY_STATE: GalleryPresentationState = { selections: new Map(), comments: new Map() };
