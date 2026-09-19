/**
 * [INPUT]: Depends on account-fenced retained-content IPC, shared message/file rendering and five-language recovery copy.
 * [OUTPUT]: Provides the reusable retained transcript/file reader with bounded paging in both directions.
 * [POS]: Read-only branch reader for the Archive catalog; divergent content becomes an ordinary Fork on its own, so nothing here saves.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { TranscriptMessage } from "@ai-chat/chat-ui/message";
import { TranscriptFile } from "@ai-chat/chat-ui/file";
import { ImportedMessage } from "@ai-chat/chat-ui/imported-message";
import { chatCopy } from "@ai-chat/chat-ui/copy";
import type { RecoveryCopy } from "@ai-chat/chat-ui/recovery-copy";
import { hashChatContent, type ChatBody } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { ImportedEntry } from "@ai-chat/cloud-protocol/chats/imported/model";
import type { HomeEntry } from "@ai-chat/cloud-protocol/chats/home/model";
import type { CloudChatBridge } from "../../../../shared/cloud/chat";
import type { RecoverySummary, RecoveryPage } from "../../../../shared/cloud/recovery";
import { chatFileURL } from "@/lib/cloud/chat/files";
import "@ai-chat/chat-ui/styles.css";
export function BranchTranscript({ archive, bridge, locale, copy }: { archive: RecoverySummary; bridge: CloudChatBridge; locale: string; copy: RecoveryCopy }) {
  const [saved, setPage] = useState<{ before: number | null; page: RecoveryPage } | null>(null), [before, setBefore] = useState<number | null>(null), [newer, setNewer] = useState<Array<number | null>>([]);
  const page = saved?.before === before ? saved.page : null;
  const [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void bridge.recoveryPage({ chatId: archive.chatId, archiveId: archive.archiveId, before }).then(value => {
      if (active) { setPage({ before, page: value }); setFailed(false); }
    }).catch(() => { if (active) setFailed(true); }); return () => { active = false; };
  }, [archive.archiveId, archive.chatId, before, bridge, retry]);
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <p className="shrink-0">{archive.messageCount === null ? copy.local : copy.count.replace("{count}", String(archive.messageCount))}</p>
    {page?.home?.pending && <p className="shrink-0" role="status">{copy.homePending} <Button variant="outline" className="min-h-11" onClick={() => setRetry(value => value + 1)}>{copy.retry}</Button></p>}
    {page?.home?.unavailable && <p className="shrink-0" role="alert">{copy.homeUnavailable} <Button variant="outline" className="min-h-11" onClick={() => setRetry(value => value + 1)}>{copy.retry}</Button></p>}
    {!!page?.home?.omitted && <p className="shrink-0" role="note">{copy.homePartial.replace("{count}", String(page.home.omitted))}</p>}
    {failed ? <p role="alert">{copy.error} <Button variant="outline" className="min-h-11" onClick={() => setRetry(value => value + 1)}>{copy.retry}</Button></p> : !page ? <p role="status">{copy.loading}</p> : <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md border p-3"><div className="chat-transcript">
        {page.messages.map(body => <BranchMessage key={body.message.id} archive={archive} body={body} bridge={bridge} locale={locale} />)}
        {page.imported.map(entry => <BranchImport key={entry.entryVersionId} archive={archive} entry={entry} bridge={bridge} locale={locale} />)}
        {page.files.map(entry => <BranchFile key={entry.path} archive={archive} entry={entry} bridge={bridge} locale={locale} />)}
      </div></div>
      <div className="flex shrink-0 flex-wrap gap-2"><Button variant="outline" className="min-h-11" disabled={page.cursor === null} onClick={() => { setNewer(values => [...values, before]); setBefore(page.cursor); }}>{archive.kind === "home" || archive.kind === "imported" ? chatCopy(locale).next : copy.older}</Button>
        <Button variant="outline" className="min-h-11" disabled={!newer.length} onClick={() => { setBefore(newer.at(-1)!); setNewer(values => values.slice(0, -1)); }}>{archive.kind === "home" || archive.kind === "imported" ? chatCopy(locale).previous : copy.newer}</Button></div>
    </>}
  </div>;
}
function useRecoveryFiles(archive: RecoverySummary, bridge: CloudChatBridge, messageId: string) {
  const state = useRef<{ controller: AbortController; urls: Set<string> } | null>(null);
  useEffect(() => {
    const value = { controller: new AbortController(), urls: new Set<string>() }; state.current = value;
    return () => { value.controller.abort(); for (const url of value.urls) URL.revokeObjectURL(url); value.urls.clear(); if (state.current === value) state.current = null; };
  }, []);
  return useMemo(() => ({ file: (_chatId: string, descriptor: Parameters<CloudChatBridge["openFile"]>[0]["descriptor"], signal: AbortSignal) => {
    const value = state.current; if (!value) return Promise.reject(new Error("RECOVERY_READER_CLOSED"));
    return chatFileURL(bridge, () => bridge.recoveryFile({ chatId: archive.chatId, archiveId: archive.archiveId, messageId, descriptor }), descriptor,
      AbortSignal.any([signal, value.controller.signal]), value.urls);
  } }), [archive.archiveId, archive.chatId, messageId, bridge]);
}
function BranchMessage({ archive, body, bridge, locale }: { archive: RecoverySummary; body: ChatBody; bridge: CloudChatBridge; locale: string }) {
  const source = useRecoveryFiles(archive, bridge, body.message.id);
  return <TranscriptMessage chatId={archive.chatId} body={body} source={source} copy={chatCopy(locale)} locale={locale} />;
}
function BranchImport({ archive, entry, bridge, locale }: { archive: RecoverySummary; entry: ImportedEntry; bridge: CloudChatBridge; locale: string }) {
  const source = useRecoveryFiles(archive, bridge, `import-${entry.deliverySeq}`);
  return <ImportedMessage chatId={archive.chatId} entry={entry} source={source} copy={chatCopy(locale)} />;
}
function BranchFile({ archive, entry, bridge, locale }: { archive: RecoverySummary; entry: HomeEntry; bridge: CloudChatBridge; locale: string }) {
  const source = useRecoveryFiles(archive, bridge, hashChatContent(entry.path));
  return <div className="space-y-2 break-all py-2"><p>{entry.path}</p>{entry.kind === "file" ? <TranscriptFile chatId={archive.chatId} name={entry.path} descriptor={entry.blob} source={source} copy={chatCopy(locale)} /> :
    <p role="note">{chatCopy(locale).unavailableDetail}</p>}</div>;
}
