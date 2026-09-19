/**
 * [INPUT]: Depends on React context and platform data, mutation, attachment and optional Gallery ports.
 * [OUTPUT]: Provides BaseUIProvider, independent draft scopes, modal receipt recovery with optional retarget decisions and scoped view/synchronization adapters.
 * [POS]: Shared Base composition boundary; each mounted owner has one explicit host adapter.
 */
import { createContext, useContext, useMemo, useCallback, useSyncExternalStore, type ReactNode } from "react";
import type { BaseDataSource, BaseMutationSink, BaseAttachmentFacade } from "./contracts";
import { EMPTY_GALLERY_STATE, type GalleryIntegration } from "./gallery";
import type { GalleryItem } from "../media/model";
import type { BaseSyncPresentation } from "../../sync/model";
export type BasePlatform = { data: BaseDataSource; mutations: BaseMutationSink; attachments: BaseAttachmentFacade;
  sync?: BaseSyncPresentation;
  drafts?: { locked?: boolean;
    retained?: { notice: string; saveLabel: string; saveDisabled: boolean; save(): Promise<void>; keep?: { label: string; run(): void } };
    register?(scopeId: string, save: () => Promise<unknown>): () => void; begin(scopeId?: string): void; changed(scopeId?: string): void; cancel(scopeId?: string): void;
    commit?<T>(scopeId: string, write: () => Promise<T>): Promise<T> };
  gallery?: GalleryIntegration; overlay?: GalleryItem[]; openExternal(url: string): unknown };
const Context = createContext<BasePlatform | null>(null);
export function BaseUIProvider({ value, children }: { value: BasePlatform; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useBasePlatform() {
  const value = useContext(Context);
  if (!value) throw new Error("BaseUIProvider is required");
  return value;
}
export function useBaseSnapshots() {
  const { data, mutations } = useBasePlatform();
  return useMemo(() => ({ ...data, ...mutations }), [data, mutations]);
}
export function useBasesNavigation() { return useBasePlatform().data; }
export function useGalleryState(chatId: string) {
  const { gallery } = useBasePlatform();
  const subscribe = useCallback((listener: () => void) => gallery?.subscribe(chatId, listener) ?? (() => undefined), [chatId, gallery]);
  const read = useCallback(() => gallery?.read(chatId) ?? EMPTY_GALLERY_STATE, [chatId, gallery]);
  return useSyncExternalStore(subscribe, read, read);
}
