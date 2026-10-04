/**
 * [INPUT]: Depends on useChatSession (background mode), the composer store's store-wide queue feed, the active-Chat claim store,
 *          useChats and enabled App summaries, surface residency, presenceStore (quit authorization), and selectQueueRunners
 * [OUTPUT]: Provides BackgroundQueueHost: mounts at most two UI-less runners so an off-screen Chat's queue keeps sending (F-34c)
 * [POS]: Main-window host of runtime/background; the runner reuses the whole session path, so fences, custody and ACKs are the view's own
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useOptionalApps } from "@/components/providers/content/apps-provider";
import { useHoldsSurface } from "@/lib/platform/window-surfaces-client";
import { chatSurface } from "../../../../../shared/ipc/settings/window-surfaces-ipc";
import { useChats } from "@/components/providers/chats-provider";
import { readActiveChatId, subscribeActiveChat } from "@/lib/chat/state/chat-activity-store";
import { composerStoreRevision, readComposerQueues, subscribeAllComposers } from "@/lib/chat/state/composer/chat-composer-store";
import { presenceStore } from "@/lib/clients/presence-client";
import { useChatSession } from "../use-chat-session";
import { selectQueueRunners } from "./select";

/* Never claims the active Chat and renders nothing: a reply that lands here stays unread like any background reply. */
function QueueRunner({ chatId, drainAllowed }: { chatId: string; drainAllowed: boolean }) {
  const { chats } = useChats();
  const chat = chats.find(chat => chat.id === chatId), context = chat?.context;
  const ownsSurface = useHoldsSurface(chatSurface(chatId, chat?.incarnationId ?? "unavailable"));
  useChatSession({ scope: { conversationId: chatId }, project: context?.kind === "app-use" || context?.kind === "app-edit"
    ? { kind: "fixed-app", appId: context.appId, appRole: context.kind === "app-use" ? "use" : "edit" }
    : { kind: "selectable" }, background: { drainAllowed: drainAllowed && ownsSurface } });
  return null;
}

export function BackgroundQueueHost() {
  const { chats } = useChats();
  useSyncExternalStore(subscribeAllComposers, composerStoreRevision, composerStoreRevision);
  const visibleChatId = useSyncExternalStore(subscribeActiveChat, readActiveChatId, readActiveChatId);
  const quitting = useSyncExternalStore(presenceStore.subscribe, presenceStore.getSnapshot, presenceStore.getSnapshot).presence?.quitting === true;
  useEffect(() => presenceStore.load(), []);
  const apps = useOptionalApps()?.records;
  // App queues resume through the same session path, and only in the window holding their surface.
  const localChatIds = useMemo(() => new Set(chats
    .filter(chat => {
      const context = chat.context;
      return !chat.readOnlyReason && !chat.archivedAt &&
        (context?.kind !== "app-use" && context?.kind !== "app-edit" || apps?.some(app => app.id === context.appId && app.enabled));
    })
    .map((chat) => chat.id)), [apps, chats]);
  const [mounted, setMounted] = useState<readonly string[]>([]);
  const runners = selectQueueRunners({ queues: readComposerQueues(), visibleChatId, localChatIds, quitting, mounted });
  const mountedKey = runners.map((runner) => runner.chatId).join("\u0000");
  if (mounted.join("\u0000") !== mountedKey) setMounted(runners.map(runner => runner.chatId));
  return runners.map((runner) => <QueueRunner key={runner.chatId} {...runner} />);
}
