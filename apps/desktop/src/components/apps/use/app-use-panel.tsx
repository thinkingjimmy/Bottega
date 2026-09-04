"use client";

/**
 * [INPUT]: Depends on AppUseChat explicit state machine, AppSidePanel chrome, fixed-App ChatView, i18n, and accessible UI primitives
 * [OUTPUT]: Provides separate Conversation and History surfaces with deterministic focus return, Back, New Chat, one refresh entry, frozen incremental history announced on its status line only, switching recovery, bottom dock, and consistent 32px panel chrome
 * [POS]: App Use product surface; history is a first-class state rather than a chat selector embedded in Conversation chrome
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { ArrowLeftIcon, CircleAlertIcon, HistoryIcon, LoaderCircleIcon, PanelBottomIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { cn } from "@ai-chat/ui/lib/utils";
import { panelChromeClassName } from "@/components/page-shell";
import type { AppRecord } from "../../../../shared/apps-ipc";
import type { AppUseChat } from "./use-app-use-chat";
import { AppSidePanel } from "../app-side-panel";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  readAllChatActivity,
  subscribeAllChatActivity,
  type ChatActivity,
} from "@/lib/chat-activity-store";

const ChatView = lazy(() =>
  import("@/components/chat/chat-view").then((module) => ({ default: module.ChatView }))
);

const historyActivityKeys = {
  waiting: "chat.sidebar.waiting",
  running: "chat.sidebar.running",
  done: "chat.sidebar.done",
  failed: "chat.sidebar.failed",
} satisfies Record<ChatActivity, string>;

export function AppUsePanel({
  open,
  record,
  chat,
  onClose,
  onDock,
}: {
  open: boolean;
  record: AppRecord;
  chat: AppUseChat;
  onClose: () => void;
  onDock: () => void;
}) {
  const { t } = useAppTranslation();
  const busy = chat.switchState !== "idle";
  const history = chat.view === "history";
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const historyHeading = useRef<HTMLParagraphElement>(null);
  const restoreHistoryTrigger = useRef(false);

  useEffect(() => {
    if (history || !restoreHistoryTrigger.current) return;
    restoreHistoryTrigger.current = false;
    historyTrigger.current?.focus();
  }, [history]);

  useEffect(() => {
    if (
      history &&
      (chat.historyState !== "ready" || chat.history.length === 0)
    ) {
      historyHeading.current?.focus();
    }
  }, [chat.history.length, chat.historyState, history]);

  return (
    <AppSidePanel
      closeLabel={t("apps.usePanel.close")}
      header={history ? (
        <>
          <Button
            aria-label={t("apps.usePanel.back")}
            className={cn("[-webkit-app-region:no-drag]", panelChromeClassName)}
            onClick={() => {
              restoreHistoryTrigger.current = true;
              chat.showConversation();
            }}
            size="icon-lg"
            type="button"
            variant="ghost"
          >
            <ArrowLeftIcon />
          </Button>
          <p
            ref={historyHeading}
            className="min-w-0 flex-1 truncate px-2 font-medium text-sm outline-none"
            tabIndex={-1}
          >
            {t("apps.usePanel.history")}
          </p>
          <NewChatButton busy={busy} create={chat.createNew} />
        </>
      ) : (
        <>
          <Button
            aria-label={t("apps.usePanel.dock")}
            className={cn("[-webkit-app-region:no-drag]", panelChromeClassName)}
            onClick={onDock}
            size="icon-lg"
            title={t("apps.usePanel.dockHint")}
            type="button"
            variant="ghost"
          >
            <PanelBottomIcon />
          </Button>
          <p className="min-w-0 flex-1 truncate px-2 font-medium text-sm">
            {t("apps.usePanel.useNamed", { name: record.displayName })}
          </p>
          <Button
            ref={historyTrigger}
            aria-label={t("apps.usePanel.history")}
            className={cn("[-webkit-app-region:no-drag]", panelChromeClassName)}
            onClick={chat.showHistory}
            size="icon-lg"
            type="button"
            variant="ghost"
          >
            <HistoryIcon />
          </Button>
          <NewChatButton busy={busy} create={chat.createNew} />
        </>
      )}
      onClose={onClose}
      open={open}
      railHint={t("apps.usePanel.resizeHint")}
      railLabel={t("apps.usePanel.resizeLabel")}
    >
      {history ? (
        <HistorySurface chat={chat} />
      ) : (
        <ConversationSurface busy={busy} chat={chat} record={record} />
      )}
    </AppSidePanel>
  );
}

function NewChatButton({ busy, create }: { busy: boolean; create: () => void }) {
  const { t } = useAppTranslation();
  return (
    <Button
      aria-label={t("apps.usePanel.createChat")}
      className={cn("[-webkit-app-region:no-drag]", panelChromeClassName)}
      disabled={busy}
      onClick={create}
      size="icon-lg"
      title={t("apps.usePanel.createChat")}
      type="button"
      variant="ghost"
    >
      <PlusIcon />
    </Button>
  );
}

function ConversationSurface({
  busy,
  chat,
  record,
}: {
  busy: boolean;
  chat: AppUseChat;
  record: AppRecord;
}) {
  const { t } = useAppTranslation();
  if (busy) {
    return (
      <div className="grid size-full place-items-center p-6 text-muted-foreground text-sm" role="status" aria-live="polite">
        {t("apps.usePanel.recovering")}
      </div>
    );
  }
  if (!chat.chatId) {
    return (
      <div className="grid size-full place-items-center text-muted-foreground text-sm">
        {t("apps.usePanel.preparing")}
      </div>
    );
  }
  return (
    <>
      {chat.error && <p className="border-b px-4 py-2 text-destructive text-xs" role="alert">{chat.error}</p>}
      <Suspense fallback={<div className="grid size-full place-items-center text-muted-foreground text-sm">{t("apps.usePanel.loading")}</div>}>
        <ChatView
          key={`${chat.chatId}:${chat.incarnationId}`}
          draftAgent={record.agent}
          emptyDescription={t("apps.usePanel.emptyDescription")}
          emptyTitle={t("apps.usePanel.emptyTitle", { name: record.displayName })}
          enableSidePanel={false}
          project={{ kind: "fixed-app", appId: record.id, appRole: "use" }}
          scope={{ conversationId: chat.chatId }}
        />
      </Suspense>
    </>
  );
}

function HistorySurface({ chat }: { chat: AppUseChat }) {
  const { t, i18n } = useAppTranslation();
  const activity = useSyncExternalStore(
    subscribeAllChatActivity,
    readAllChatActivity,
    readAllChatActivity
  );
  /* 一种语言一枚 formatter。逐行 new 一个 Intl.DateTimeFormat 是这张清单
     里最贵的一件事——构造器要解析 locale 数据，而每行读的是同一份。 */
  const dayFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric" }),
    [i18n.language]
  );
  if (chat.historyState === "loading" && !chat.history.length) {
    return <div className="grid size-full place-items-center text-muted-foreground text-sm" role="status">{t("apps.usePanel.historyLoading")}</div>;
  }
  if (chat.historyState === "error") {
    return (
      <div className="grid size-full place-items-center gap-3 p-6 text-center text-sm">
        <p className="text-destructive" role="alert">{chat.error}</p>
        <Button className="min-h-11" onClick={chat.refreshHistory} variant="outline">
          <RefreshCwIcon />{t("apps.usePanel.retry")}
        </Button>
      </div>
    );
  }
  if (chat.historyState === "ready" && !chat.history.length) {
    return <div className="grid size-full place-items-center p-6 text-center text-muted-foreground text-sm">{t("apps.usePanel.historyEmpty")}</div>;
  }
  const hasActive = chat.history.some((item) => item.active);
  return (
    /* aria-live 从前罩着整张清单：翻一页、换一个标题、多一枚活动标记，
       读屏就把整条列表重念一遍。会话的播报点是那条状态行，不是清单本身；
       aria-busy 留在容器上，因为「正在切换」说的确实是这一整块。 */
    <div
      aria-busy={chat.switchState !== "idle"}
      className="flex size-full flex-col overflow-auto p-2"
    >
      {chat.historyStale && (
        <div aria-live="polite" className="mb-2 flex min-h-11 items-center gap-2 rounded-lg bg-muted px-3 text-sm" role="status">
          <span className="min-w-0 flex-1">{t("apps.usePanel.historyChanged")}</span>
          <Button className="min-h-11" onClick={chat.refreshHistory} size="sm" variant="ghost">
            <RefreshCwIcon />{t("apps.usePanel.refresh")}
          </Button>
        </div>
      )}
      <ul className="space-y-1" aria-label={t("apps.usePanel.history")}>
        {chat.history.map((item, index) => (
          <li key={`${item.chatId}:${item.incarnationId}`}>
            <button
              aria-current={item.active ? "true" : undefined}
              autoFocus={item.active || (!hasActive && index === 0)}
              className={cn(
                "flex min-h-11 w-full flex-col rounded-lg px-3 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                item.active && "bg-accent text-accent-foreground"
              )}
              disabled={chat.switchState !== "idle"}
              onClick={() => chat.select(item)}
              type="button"
            >
              <span className="flex w-full items-center gap-2">
                <span
                  className="min-w-0 flex-1 truncate font-medium text-sm"
                  title={item.title ?? t("apps.usePanel.generatingTitle")}
                >
                  {item.title ?? t("apps.usePanel.generatingTitle")}
                </span>
                <time className="shrink-0 text-muted-foreground text-xs" dateTime={new Date(item.updatedAt).toISOString()}>
                  {dayFormatter.format(item.updatedAt)}
                </time>
                <HistoryActivity state={activity.get(item.chatId)} />
              </span>
              {item.preview && (
                <span
                  className="mt-0.5 line-clamp-2 text-muted-foreground text-xs"
                  title={item.preview}
                >
                  {item.preview}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {chat.cursor && (
        <Button className="mt-2 min-h-11" disabled={chat.historyState === "loading"} onClick={chat.loadMore} variant="ghost">
          {chat.historyState === "loading" ? t("apps.usePanel.historyLoading") : t("apps.usePanel.loadMore")}
        </Button>
      )}
    </div>
  );
}

function HistoryActivity({ state }: { state?: ChatActivity }) {
  const { t } = useAppTranslation();
  if (!state) return null;
  const label = t(historyActivityKeys[state]);
  if (state === "running") {
    return (
      <LoaderCircleIcon
        aria-label={label}
        className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
        data-chat-activity={state}
      />
    );
  }
  if (state === "failed") {
    return (
      <CircleAlertIcon
        aria-label={label}
        className="size-3.5 shrink-0 text-amber-500"
        data-chat-activity={state}
      />
    );
  }
  return (
    <span
      aria-label={label}
      className={cn(
        "size-2 shrink-0 rounded-full",
        state === "waiting" ? "bg-violet-500" : "bg-blue-500"
      )}
      data-chat-activity={state}
      role="img"
    />
  );
}
