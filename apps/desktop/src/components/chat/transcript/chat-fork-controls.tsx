/**
 * [INPUT]: Depends on strict fork contracts, bounded Chat reads/commands, localized dialog primitives, Phosphor icons, and the shared transcript divider
 * [OUTPUT]: Provides fork lineage navigation and a direct-choice same-workspace/managed-worktree fork dialog
 * [POS]: Fork-specific transcript interaction sibling; ChatTranscript decides eligibility and owns the selected anchor
 */

import { useEffect, useState } from "react";
import { ForkChatDialog as SharedForkChatDialog } from "@ai-chat/chat-ui/interactions/fork";
import type {
  AssistantChatMessage,
  ChatSummary,
} from "../../../../shared/chats-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  forkChat,
  getChatTimelineAround,
  preflightChatFork,
} from "@/lib/chats-client";
import { AgentBackendIcon, backendLabel } from "@/lib/agent-backends";
import { TranscriptDividerRow } from "./transcript-divider";

export type ChatForkViewContext = Readonly<{
  summary: ChatSummary;
  parent: ChatSummary | null;
  navigateToChat: (chatId: string, messageId?: string) => void;
}>;

export function ForkLineageDivider({ context }: { context: ChatForkViewContext }) {
  const { t } = useAppTranslation();
  const { summary, parent } = context;
  const lineageKey = parent && summary.parentMessageId && summary.parentIncarnationId
    ? `${parent.id}:${summary.parentIncarnationId}:${summary.parentMessageId}`
    : null;
  const [verifiedKey, setVerifiedKey] = useState<string | null>(() => lineageKey);
  const available = Boolean(lineageKey && verifiedKey === lineageKey);
  useEffect(() => {
    if (!parent || !summary.parentMessageId || !summary.parentIncarnationId || !lineageKey) return;
    let live = true;
    void getChatTimelineAround({
      chatId: parent.id,
      messageId: summary.parentMessageId,
      radius: 1,
    }).then((page) => {
      const exact = page?.incarnationId === summary.parentIncarnationId &&
        page?.messages.some((message) => message.id === summary.parentMessageId);
      if (live) setVerifiedKey(exact ? lineageKey : null);
    }).catch(() => { if (live) setVerifiedKey(null); });
    return () => { live = false; };
  }, [lineageKey, parent, summary.parentIncarnationId, summary.parentMessageId]);
  return (
    <TranscriptDividerRow role="separator">
      {summary.forkAgent && <span className="inline-flex items-center gap-1.5"><AgentBackendIcon backend={summary.forkAgent} className="size-3.5" />{backendLabel(summary.forkAgent)}</span>}
      <button
        aria-label={available && parent
          ? t("chat.fork.openSource", { title: parent.title ?? t("chat.newTask") })
          : t("chat.fork.originalUnavailable")}
        className="min-h-11 rounded-full px-3 py-1 transition-colors enabled:hover:bg-muted enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        data-fork-divider=""
        disabled={!available}
        onClick={() => context.navigateToChat(parent!.id, summary.parentMessageId!)}
        type="button"
      >
        {t("chat.fork.continuedFrom")}
      </button>
    </TranscriptDividerRow>
  );
}

const forkPorts = { preflight: preflightChatFork, fork: forkChat };
export function ForkChatDialog(props: { anchor: AssistantChatMessage; context: ChatForkViewContext; onClose(): void }) {
  const { t } = useAppTranslation();
  return <SharedForkChatDialog {...props} ports={forkPorts} t={t} />;
}
