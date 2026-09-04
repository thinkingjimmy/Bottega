/**
 * [INPUT]: Depends on AppRecord, typed Apps navigation IPC, scoped Chat events, URL destination hints, and localized error projection
 * [OUTPUT]: Provides the explicit App Use conversation/history state machine with frozen paging, scoped stale detection, durable switch receipts, New Chat, one refresh entry, and canonical chat identity
 * [POS]: App Use renderer controller; main owns history membership, destination validation, active residence, and issuance authority
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { AppRecord, AppUseHistoryItem } from "../../../../shared/apps-ipc";
import {
  ensureAppChatSlot,
  listAppUseHistory,
  newAppUseChat,
  openAppUseChat,
} from "@/lib/apps-client";
import { errorMessage } from "@/lib/errors";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { onChatsEvent } from "@/lib/chats-client";

type UseView = "conversation" | "history";

export function useAppUseChat(record: AppRecord, active: boolean) {
  const { t } = useAppTranslation();
  const [searchParams] = useSearchParams();
  const routeChatId = searchParams.get("chatId") ?? "";
  const routeIncarnationId = searchParams.get("incarnationId") ?? "";
  const routeHistory = searchParams.get("panel") === "history";
  const initial = record.activeUseChatSlot;
  const [identity, setIdentity] = useState({
    chatId: initial?.id ?? "",
    incarnationId: initial?.incarnationId ?? "",
  });
  const [view, setView] = useState<UseView>(routeHistory ? "history" : "conversation");
  const [history, setHistory] = useState<AppUseHistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [snapshotRevision, setSnapshotRevision] = useState<string | null>(null);
  const [historyStale, setHistoryStale] = useState(false);
  const [historyState, setHistoryState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [switchState, setSwitchState] = useState<"idle" | "switching" | "recovering">("idle");
  const [error, setError] = useState("");

  const loadHistory = useCallback(async (nextCursor?: string) => {
    setHistoryState("loading");
    setError("");
    try {
      const page = await listAppUseHistory({
        appId: record.id,
        ...(nextCursor ? { cursor: nextCursor } : {}),
        ...(nextCursor && snapshotRevision
          ? { expectedSnapshotRevision: snapshotRevision }
          : {}),
        pageSize: 20,
      });
      setHistory((current) => nextCursor ? [...current, ...page.items] : page.items);
      setSnapshotRevision(page.snapshotRevision);
      setHistoryStale(page.latestSnapshotRevision !== page.snapshotRevision);
      setCursor(page.nextCursor);
      setHistoryState("ready");
    } catch (cause) {
      setHistoryState("error");
      setError(errorMessage(cause, t("apps.usePanel.restoreFailed")));
    }
  }, [record.id, snapshotRevision, t]);

  useEffect(() => {
    if (!snapshotRevision) return;
    return onChatsEvent((event) => {
      if (
        event.type === "upserted" &&
        event.summary.context?.kind === "app-use" &&
        event.summary.context.appId === record.id
      ) {
        setHistoryStale(true);
        return;
      }
      if (
        (event.type === "removed" ||
          event.type === "messages" ||
          event.type === "messages-delta") &&
        history.some((item) => item.chatId === event.chatId)
      ) {
        setHistoryStale(true);
      }
    });
  }, [history, record.id, snapshotRevision]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const target = routeChatId && routeIncarnationId
      ? openAppUseChat({
          appId: record.id,
          chatId: routeChatId,
          incarnationId: routeIncarnationId,
          requestId: crypto.randomUUID(),
        }).then((receipt) => {
          if (receipt.status === "precommit-rejected") throw new Error(receipt.reason);
          if (receipt.status === "recovering" || receipt.status === "committed") {
            setSwitchState("recovering");
            return null;
          }
          return receipt.target;
        })
      : ensureAppChatSlot({
          appId: record.id,
          role: "use",
          requestId: crypto.randomUUID(),
        }).then((slot) => ({
          kind: "app-use-chat" as const,
          appId: record.id,
          chatId: slot.id,
          incarnationId: slot.incarnationId,
        }));
    void target
      .then((destination) => {
        if (!alive || !destination) return;
        setIdentity({ chatId: destination.chatId, incarnationId: destination.incarnationId });
        if (!routeHistory) setView("conversation");
        setSwitchState("idle");
      })
      .catch((cause) => {
        if (alive) setError(errorMessage(cause, t("apps.usePanel.restoreFailed")));
      });
    return () => { alive = false; };
  }, [active, record.id, routeChatId, routeHistory, routeIncarnationId, t]);

  useEffect(() => {
    if (!active || !routeHistory || historyState !== "idle") return;
    const timer = window.setTimeout(() => void loadHistory(), 0);
    return () => window.clearTimeout(timer);
  }, [active, historyState, loadHistory, routeHistory]);

  useEffect(() => {
    const slot = record.activeUseChatSlot;
    if (!active || !slot || record.activeUseSwitch) return;
    if (
      switchState === "idle" &&
      identity.chatId === slot.id &&
      identity.incarnationId === slot.incarnationId
    ) return;
    const timer = window.setTimeout(() => {
      setIdentity({ chatId: slot.id, incarnationId: slot.incarnationId });
      setSwitchState("idle");
      if (!routeHistory) setView("conversation");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    active,
    identity.chatId,
    identity.incarnationId,
    record.activeUseChatSlot,
    record.activeUseSwitch,
    routeHistory,
    switchState,
  ]);

  const showHistory = () => {
    setView("history");
    if (historyState === "idle" || historyState === "error") void loadHistory();
  };

  const select = async (item: AppUseHistoryItem) => {
    setSwitchState("switching");
    setError("");
    try {
      const receipt = await openAppUseChat({
        appId: record.id,
        chatId: item.chatId,
        incarnationId: item.incarnationId,
        requestId: crypto.randomUUID(),
      });
      if (receipt.status === "precommit-rejected") throw new Error(receipt.reason);
      if (receipt.status !== "completed") {
        setSwitchState("recovering");
        return;
      }
      setIdentity({ chatId: receipt.target.chatId, incarnationId: receipt.target.incarnationId });
      setView("conversation");
      setSwitchState("idle");
    } catch (cause) {
      setSwitchState("idle");
      setError(errorMessage(cause, t("apps.usePanel.restoreFailed")));
    }
  };

  const createNew = async () => {
    setSwitchState("switching");
    setError("");
    try {
      const receipt = await newAppUseChat(record.id, crypto.randomUUID());
      if (receipt.status === "precommit-rejected") throw new Error(receipt.reason);
      if (receipt.status !== "completed") {
        setSwitchState("recovering");
        return;
      }
      setIdentity({ chatId: receipt.target.chatId, incarnationId: receipt.target.incarnationId });
      setView("conversation");
      setSwitchState("idle");
    } catch (cause) {
      setSwitchState("idle");
      setError(errorMessage(cause, t("apps.usePanel.createFailed")));
    }
  };

  return {
    ...identity,
    view,
    history,
    historyState,
    switchState,
    cursor,
    historyStale,
    error,
    createNew: () => void createNew(),
    showHistory,
    showConversation: () => setView("conversation"),
    /* 重试与刷新是同一件事：重读第一页。挂两个名字只会逼调用方先猜
       哪一个才是「对的」那个。 */
    refreshHistory: () => void loadHistory(),
    loadMore: () => cursor && void loadHistory(cursor),
    select: (item: AppUseHistoryItem) => void select(item),
  };
}

export type AppUseChat = ReturnType<typeof useAppUseChat>;
