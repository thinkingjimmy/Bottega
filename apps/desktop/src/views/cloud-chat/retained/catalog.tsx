/**
 * [INPUT]: Depends on the current account, bounded retention IPC and existing transcript/file recovery rendering.
 * [OUTPUT]: Provides account-bound Archive recovery discovery, Project deletion decisions and readonly native/mirror content dialogs.
 * [POS]: Local recovery catalog; account changes unmount all original content and file leases.
 */
import { useEffect, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { recoveryCopy } from "@ai-chat/chat-ui/recovery-copy";
import { useCloudAccount } from "@/lib/cloud/client";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { CloudChatBridge } from "../../../../shared/cloud/chat";
import { recoverySummarySchema, type RetainedCatalog, type RetainedMetadata } from "../../../../shared/cloud/recovery";
import { BranchTranscript } from "./branch-transcript";
import { retainedCopy } from "./copy";
import { ProjectDeletionCandidates } from "./projects";
type Entry = RetainedCatalog["items"][number];
const summary = ({ title: _title, ...archive }: Entry) => recoverySummarySchema.parse(archive);
export function RetainedContentEntry() {
  const account = useCloudAccount(), { i18n } = useAppTranslation();
  if (!window.cloudChat || !account.profile?.userId || !["ready", "temporarily-offline"].includes(account.status) || ["not-connected", "closing"].includes(account.sync.status)) return null;
  return <div key={account.profile.userId} className="space-y-8"><ProjectDeletionCandidates bridge={window.cloudChat} locale={i18n.language} online={account.status === "ready" && account.sync.status !== "paused"} />
    <RetainedContentCatalog bridge={window.cloudChat} locale={i18n.language} /></div>;
}
export function RetainedContentCatalog({ bridge, locale }: { bridge: CloudChatBridge; locale: string }) {
  const copy = retainedCopy(locale), [items, setItems] = useState<Entry[]>([]), [cursor, setCursor] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const [afterId, setAfterId] = useState<string | null>(null), [loaded, setLoaded] = useState<string | null>(null), [failed, setFailed] = useState(false), [selected, setSelected] = useState<Entry | null>(null);
  const loadKey = JSON.stringify([afterId, retry]), loading = loaded !== loadKey;
  useEffect(() => bridge.onLocalChanged?.(() => { setAfterId(null); setRetry(value => value + 1); }), [bridge]);
  useEffect(() => {
    let active = true;
    const read = async () => {
      let page = await bridge.retainedCatalog({ afterId });
      for (let step = 0; active && !page.items.length && page.cursor && step < 7; step++) page = await bridge.retainedCatalog({ afterId: page.cursor });
      return page;
    };
    void read().then(page => {
      if (!active) return; setItems(old => afterId ? [...old, ...page.items.filter(item => !old.some(row => row.archiveId === item.archiveId))] : page.items);
      setCursor(page.cursor); setFailed(false);
      if (!page.items.length && page.cursor) setAfterId(page.cursor);
    }).catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoaded(loadKey); });
    return () => { active = false; };
  }, [afterId, bridge, loadKey]);
  return <section className="space-y-3" aria-labelledby="retained-content-title">
    <div><h2 id="retained-content-title" className="text-sm font-medium">{copy.title}</h2><p className="text-xs text-muted-foreground">{copy.description}</p></div>
    {!items.length && !cursor && !loading && !failed && <p className="text-sm text-muted-foreground">{copy.empty}</p>}
    <ul className="divide-y rounded-md border empty:hidden">{items.map(item => <li key={item.archiveId}><button type="button" className="flex min-h-12 w-full flex-col gap-1 px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring"
      onClick={() => setSelected(item)}><span className="max-w-full truncate text-sm">{item.title || copy.unnamed}</span><span className="text-xs text-muted-foreground">{item.kind === "metadata" ? copy.metadata : recoveryCopy(locale)[item.origin ?? item.kind]} · {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(item.createdAt)}</span></button></li>)}</ul>
    {loading && <p role="status" className="text-sm">{copy.loading}</p>}
    {failed && <p role="alert" className="text-sm">{copy.error} <Button variant="outline" onClick={() => setRetry(value => value + 1)}>{copy.retry}</Button></p>}
    {cursor && <Button variant="outline" disabled={loading} onClick={() => setAfterId(cursor)}>{copy.more}</Button>}
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="flex h-[80svh] max-w-3xl flex-col overflow-hidden">
      <DialogHeader><DialogTitle>{selected?.title || copy.unnamed}</DialogTitle><DialogDescription>{copy.description}</DialogDescription></DialogHeader>
      {selected && (selected.kind === "metadata" ? <MetadataCandidate key={selected.archiveId} entry={selected} bridge={bridge} locale={locale} /> :
        <BranchTranscript key={selected.archiveId} archive={summary(selected)} bridge={bridge} locale={locale} copy={recoveryCopy(locale)} />)}
    </DialogContent></Dialog>
  </section>;
}
function MetadataCandidate({ entry, bridge, locale }: { entry: Entry; bridge: CloudChatBridge; locale: string }) {
  const copy = retainedCopy(locale), [page, setPage] = useState<RetainedMetadata | null>(null), [before, setBefore] = useState<number | null>(null), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void bridge.retainedMetadata({ chatId: entry.chatId, archiveId: entry.archiveId, before }).then(value => { if (active) { setPage(value); setFailed(false); } }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [before, bridge, entry.archiveId, entry.chatId, retry]);
  return <div className="min-h-0 space-y-4 overflow-y-auto text-sm"><p>{copy.candidate}</p>
    {failed ? <p role="alert">{copy.error} <Button onClick={() => setRetry(value => value + 1)}>{copy.retry}</Button></p> : !page ? <p role="status">{copy.loading}</p> : <>
      <dl><dt className="text-muted-foreground">{copy.original}</dt><dd className="break-words">{page.title || copy.unnamed}</dd></dl>
      {page.edits.map(edit => <div key={edit.operationId} className="space-y-1 rounded-md border p-3">{edit.title !== undefined && <dl><dt className="text-muted-foreground">{copy.proposed}</dt><dd className="select-text break-words">{edit.title ?? copy.automatic}</dd></dl>}{edit.archived !== undefined && <p>{edit.archived ? copy.archived : copy.unarchived}</p>}</div>)}
      {page.cursor !== null && <Button variant="outline" onClick={() => { setBefore(page.cursor); setPage(null); }}>{copy.more}</Button>}
    </>}
  </div>;
}
