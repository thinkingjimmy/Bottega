/**
 * [INPUT]: Depends on durable deletion IPC, shared confirmation controls and desktop locale.
 * [OUTPUT]: Presents retained pending/confirmed/conflicted deletion with native and mirror content left intact until confirmation.
 * [POS]: Lazy desktop facts companion; local-only deletion stays in the existing native flow.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { ChatDeletion } from "@ai-chat/chat-ui/deletion";
import { Button } from "@ai-chat/ui/components/ui/button";
import { chatNavigationCopy } from "@ai-chat/chat-ui/navigation-copy";
import { DesktopChatDeletion } from "@/lib/cloud/chat/facts/deletion";
import { useAppTranslation } from "@/components/providers/i18n-provider";
export function DesktopDeletionEntry({ chatId, bridge, connected, disabled, onBlockingChange }: {
  chatId: string; bridge: NonNullable<Window["cloudChat"]>; connected: boolean; disabled: boolean; onBlockingChange(blocked: boolean): void;
}) {
  const session = useMemo(() => new DesktopChatDeletion(bridge, chatId), [bridge, chatId]), { i18n } = useAppTranslation();
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot), copy = chatNavigationCopy(i18n.language);
  useEffect(() => { void session.open(); return () => session.close(); }, [session]);
  useEffect(() => { onBlockingChange(["saving", "pending", "failed", "deleted"].includes(state.stage)); }, [state.stage, onBlockingChange]);
  if (!state.head) return state.stage === "failed" ? <div role="alert" className="chat-facts"><p>{copy.failed}</p><Button variant="outline" onClick={() => void session.retry()}>{copy.retry}</Button></div> : null;
  return <ChatDeletion head={state.head} session={session} locale={i18n.language} connected={connected} disabled={disabled} durable />;
}
