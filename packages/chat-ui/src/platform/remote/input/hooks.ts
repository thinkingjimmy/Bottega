/**
 * [INPUT]: Complete draft custody and the current account-scoped upload port.
 * [OUTPUT]: Subscribes the composer to drafts and starts queued uploads after a Chat identity exists.
 * [POS]: React binding; navigation preserves uploads while key disposal aborts them.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { RemoteCommandPort } from "../contracts";
import type { RemoteDraftStore } from "./draft";
export function useRemoteDraft(store: RemoteDraftStore, port?: RemoteCommandPort, chatId?: string) {
  const draft = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useEffect(() => {
    if (!chatId || !port?.attachments) return;
    for (const file of draft.files) if (file.state === "queued") void store.stage(file, chatId, port.attachments, port.lifetime ?? new AbortController().signal).catch(() => {});
  }, [draft.files, store, port, chatId]);
  return draft;
}
