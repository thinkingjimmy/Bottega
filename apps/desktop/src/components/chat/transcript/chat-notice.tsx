/**
 * [INPUT]: Depends on shared NoticeChatMessage canonical structure, I18n Provider, Section snapshot, React and Button
 * [OUTPUT]: Provides instantly updated memo ChatNotice with current language; dormant app-chat-ready identity notices render no UI, while actionable notices retain live state
 * [POS]: chat/transcript control-message renderer; ordinary user and assistant content stays in the standard message bubble path
 */

import { memo, useEffect, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import type {
  ChatNotice as ChatNoticeData,
  NoticeChatMessage,
} from "../../../../shared/chats-ipc";
import type { RelayActionState } from "../../../../shared/sections-ipc";
import {
  continueRelay,
  discardRelay,
  subscribeRelayActions,
} from "@/lib/sections-client";
import { useAppTranslation } from "@/components/providers/i18n-provider";

const SETTLED_COPY_KEYS = {
  continued: "notice.continued",
  discarded: "notice.discarded",
  stale: "notice.stale",
} as const;

/** canonical content 继续由 shared 固定；renderer 只按结构化 kind 做当前语言投影。 */
function localizedNoticeMessageContent(
  notice: ChatNoticeData,
  t: ReturnType<typeof useAppTranslation>["t"]
) {
  if (notice.kind === "app-chat-ready") return "";
  if (notice.kind === "manual-recovered") return t("notice.manualRecovered");
  if (notice.kind === "skill-descriptions-truncated") {
    return t("notice.skillDescriptionsTruncated");
  }
  if (notice.kind === "relay-failed") {
    return t("notice.relayFailed", { relayId: notice.relayId });
  }
  return t(
    notice.kind === "chain-paused"
      ? "notice.chainPaused"
      : "notice.chainRecovered",
    { count: notice.pendingCount }
  );
}

const VisibleChatNotice = memo(function VisibleChatNotice({
  message,
}: {
  message: NoticeChatMessage;
}) {
  const { t } = useAppTranslation();
  const [result, setResult] = useState<
    "continued" | "discarded" | "stale" | "busy" | null
  >(null);
  const actionNotice =
    message.notice.kind === "chain-paused" ||
    message.notice.kind === "startup-recovered"
      ? message.notice
      : null;
  const actionable = Boolean(actionNotice);
  const [actionState, setActionState] =
    useState<RelayActionState | null>(null);
  useEffect(() => {
    if (!actionNotice) return;
    const notice = actionNotice;
    return subscribeRelayActions((snapshot) => {
      const action = snapshot.actions[notice.actionId];
      setActionState(
        action?.pauseEpoch === notice.pauseEpoch
          ? action.state
          : "expired"
      );
    });
  }, [actionNotice]);
  const act = async (kind: "continue" | "discard") => {
    if (
      !actionNotice ||
      result ||
      actionState !== "active"
    ) {
      return;
    }
    const notice = actionNotice;
    setResult("busy");
    const input = {
      actionId: notice.actionId,
      expectedPauseEpoch: notice.pauseEpoch,
    };
    setResult(
      kind === "continue"
        ? await continueRelay(input)
        : await discardRelay(input)
    );
  };
  const settledState =
    result && result !== "busy"
      ? result
      : actionState === "continued" || actionState === "discarded"
        ? actionState
        : actionState === "expired"
          ? "stale"
          : null;
  const settledCopyKey = !settledState
    ? null
    : SETTLED_COPY_KEYS[settledState];
  return (
    <div className="mx-auto w-full rounded-xl border border-dashed bg-muted/40 px-4 py-3 text-center text-muted-foreground text-sm">
      <p>
        {localizedNoticeMessageContent(message.notice, t)}
      </p>
      {actionable && (
        <div className="mt-2 flex justify-center gap-2">
          <Button
            disabled={Boolean(result) || actionState !== "active"}
            onClick={() => void act("continue")}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("common.continue")}
          </Button>
          <Button
            disabled={Boolean(result) || actionState !== "active"}
            onClick={() => void act("discard")}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("common.discard")}
          </Button>
        </div>
      )}
      {settledCopyKey && (
        <p className="mt-2 text-xs">
          {t(settledCopyKey)}
        </p>
      )}
    </div>
  );
});

export const ChatNotice = memo(function ChatNotice({
  message,
}: {
  message: NoticeChatMessage;
}) {
  return message.notice.kind === "app-chat-ready"
    ? null
    : <VisibleChatNotice message={message} />;
});
