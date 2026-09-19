/**
 * [INPUT]: Depends on the scoped desktop account, durable facts bridge and shared title/archive controls.
 * [OUTPUT]: Presents shared facts and explicit deletion review for native/mirror Chats without optimistic content removal.
 * [POS]: Lazy desktop facts entry; local-only Chats continue using their ordinary local controls.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChatFacts } from "@ai-chat/chat-ui/facts";
import { Button } from "@ai-chat/ui/components/ui/button";
import { chatNavigationCopy } from "@ai-chat/chat-ui/navigation-copy";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useCloudAccount } from "@/lib/cloud/client";
import { DesktopChatFacts } from "@/lib/cloud/chat/facts/session";
import "@ai-chat/chat-ui/styles.css";
import { DesktopDeletionEntry } from "./deletion";
export function DesktopFactsEntry({ chatId, onBlockingChange }: { chatId: string; onBlockingChange?(blocked: boolean): void }) {
  const account = useCloudAccount(), bridge = window.cloudChat;
  const allowed = Boolean(bridge && account.profile && ["ready", "temporarily-offline"].includes(account.status) && !["not-connected", "closing"].includes(account.sync.status));
  return allowed && bridge ? <Facts key={`${account.profile!.userId}:${chatId}`} chatId={chatId} bridge={bridge} connected={account.status === "ready"} onBlockingChange={onBlockingChange} /> : null;
}
function Facts({ chatId, bridge, connected, onBlockingChange }: { chatId: string; bridge: NonNullable<Window["cloudChat"]>; connected: boolean; onBlockingChange?(blocked: boolean): void }) {
  const [deletionBlocked, setDeletionBlocked] = useState(false), [dirty, setDirty] = useState(false);
  const session = useMemo(() => new DesktopChatFacts(bridge, chatId), [bridge, chatId]), { i18n, t } = useAppTranslation();
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot), copy = chatNavigationCopy(i18n.language);
  useEffect(() => { void session.open(); return () => session.close(); }, [session]);
  useEffect(() => { onBlockingChange?.(dirty || deletionBlocked); }, [dirty, deletionBlocked, onBlockingChange]);
  if (!state.head) return state.stage === "failed" ? <div role="alert" className="chat-facts"><p>{copy.failed}</p><Button variant="outline" onClick={() => void session.retry()}>{copy.retry}</Button></div> : <p role="status" className="chat-facts">{t("common.loading")}</p>;
  return <><ChatFacts head={state.head} session={session} locale={i18n.language} connected={connected} durable disabled={deletionBlocked} onDirtyChange={setDirty} />
    <DesktopDeletionEntry chatId={chatId} bridge={bridge} connected={connected} disabled={dirty || !["idle", "saved"].includes(state.stage)} onBlockingChange={setDeletionBlocked} /></>;
}
