/**
 * [INPUT]: React view lifetime and account-bound Chat, session and draft stores.
 * [OUTPUT]: A retained RemoteQueueController and its reactive metadata; leaving a view detaches only its UI callbacks.
 * [POS]: Thin React bridge to shared remote queue ownership.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ChatPlatform } from "../../contracts";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { RemoteDraftStore } from "../input/draft";
import type { RemoteCommandSession } from "../commands/session";
import { RemoteQueueController } from "./controller";
const controllers = new WeakMap<RemoteDraftStore, RemoteQueueController>();
const empty = { waiting: null, busy: false, error: null, revision: 0 };
export function useRemoteQueue(platform: ChatPlatform, head: CloudChatHead, store: RemoteDraftStore, session: RemoteCommandSession | null) {
  const controller = useMemo(() => {
    const port = platform.commands.remote; if (!port || !session) return null;
    let value = controllers.get(store);
    if (!value) { value = new RemoteQueueController(platform, head, store, session, port); controllers.set(store, value); }
    return value;
  }, [platform, store, session, head.chat.id, head.chat.incarnationId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { controller?.start(); return () => controller?.detach(); }, [controller]);
  const state = useSyncExternalStore(controller?.subscribe ?? (() => () => {}), controller?.snapshot ?? (() => empty));
  return { controller, ...state };
}
