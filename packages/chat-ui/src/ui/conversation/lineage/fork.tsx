/**
 * [INPUT]: Depends on encrypted portable lineage and account-scoped parent/message reads.
 * [OUTPUT]: Renders a Fork divider whose source action is enabled only after identity verification.
 * [POS]: conversation/lineage's inherited-transcript boundary; no local execution assumptions.
 */
import { useEffect, useState } from "react";
import type { PortableChat } from "@ai-chat/cloud-protocol/chats/model";
import type { ChatListSource, TranscriptSource } from "../../../platform/contracts";
import { continuationCopy } from "../../../i18n/continuation";
export type LineageNavigation = { chats: Pick<ChatListSource, "head">; navigate(chatId: string, messageId: string): void };
export function ForkBoundary({ chat, source, navigation, locale }: { chat: PortableChat; source: TranscriptSource; navigation?: LineageNavigation; locale: string }) {
  const [verified, setVerified] = useState<string | null>(null), copy = continuationCopy(locale);
  const { parentChatId, parentIncarnationId, parentMessageId } = chat;
  const key = JSON.stringify([parentChatId, parentIncarnationId, parentMessageId]);
  const heads = navigation?.chats;
  useEffect(() => {
    if (!parentChatId || !parentMessageId || !heads || !source.locate) return;
    const controller = new AbortController();
    void Promise.all([heads.head(parentChatId, controller.signal), source.locate(parentChatId, parentMessageId, controller.signal)])
      .then(([parent, message]) => { if (!controller.signal.aborted && parent?.chat.incarnationId === parentIncarnationId && message) setVerified(key); })
      .catch(() => {});
    return () => controller.abort();
  }, [heads, source, parentChatId, parentIncarnationId, parentMessageId, key]);
  const available = verified === key && Boolean(navigation);
  return <div className="chat-notice" role="separator" data-fork-divider=""><button type="button" disabled={!available}
    title={available ? undefined : copy.unavailable} onClick={() => { if (available) navigation!.navigate(parentChatId!, parentMessageId!); }}>{copy.fork}</button></div>;
}
