/**
 * [INPUT]: Depends on the injected title/archive session, confirmed head, connectivity and five-language copy.
 * [OUTPUT]: Provides metadata editing with retained input, retry/conflict decisions and a host-owned deletion exclusion.
 * [POS]: The Chat page's facts controls beside navigation/; execution and portable classification remain outside this surface.
 */
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { ChatFactsController } from "../../platform/facts";
import { chatNavigationCopy } from "../../i18n/navigation";
export function ChatFacts({ head: confirmedHead, session, locale, connected, deleted = false, disabled = false, durable = false, onDirtyChange }: { head: CloudChatHead; session: ChatFactsController; locale: string; connected: boolean; deleted?: boolean; disabled?: boolean; durable?: boolean; onDirtyChange?(dirty: boolean): void }) {
  const copy = chatNavigationCopy(locale), id = useId(), state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const head = state.head ?? confirmedHead;
  const canSave = connected || durable;
  const [edit, setEdit] = useState<{ head: CloudChatHead; title: string } | null>(null);
  const locked = disabled || deleted || ["saving", "failed", "conflicted", "deleted"].includes(state.stage);
  const dirty = Boolean(edit && edit.title !== (edit.head.chat.title ?? "")) || ["saving", "failed", ...(!durable ? ["conflicted"] : [])].includes(state.stage);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const finish = async (flight: Promise<void>) => { await flight; if (["saved", "pending", "idle"].includes(session.snapshot().stage)) setEdit(null); };
  const changes = state.candidate ?? (state.operation?.command.kind === "patch" ? state.operation.command.changes : null);
  const current = state.receipt?.head && state.receipt.head.chat.cloudRevision > head.chat.cloudRevision ? state.receipt.head : head;
  return <section className="chat-facts" aria-label={copy.title}>
    {!edit ? <div className="chat-facts-actions">
      <Button variant="outline" disabled={locked || !canSave} onClick={() => setEdit({ head, title: head.chat.title ?? "" })}>{copy.rename}</Button>
      <Button variant="outline" disabled={locked || !canSave} onClick={() => void finish(session.submit(head, { archivedAt: head.archivedAt === null ? Date.now() : null }))}>{head.archivedAt === null ? copy.archive : copy.restore}</Button>
    </div> : <form onSubmit={event => { event.preventDefault(); if (!locked && canSave) void finish(session.submit(edit.head, { title: edit.title.trim() || null })); }}>
      <label htmlFor={id}>{copy.title}</label><input id={id} value={edit.title} maxLength={200} readOnly={locked} onChange={event => setEdit({ ...edit, title: event.target.value })} />
      <div className="chat-facts-actions"><Button type="submit" disabled={locked || !canSave}>{copy.save}</Button><Button type="button" variant="outline" disabled={locked} onClick={() => setEdit(null)}>{copy.cancel}</Button></div>
    </form>}
    {!connected && !deleted && <p role="status">{durable ? copy.localOffline : copy.offline}</p>}
    {state.stage === "saving" && <p role="status">{copy.saving}</p>}
    {dirty && !locked && <p role="status">{copy.draft}</p>}
    {state.stage === "saved" && !dirty && <p role="status">{copy.saved}</p>}
    {state.stage === "pending" && <p role="status">{copy.pending}</p>}
    {state.stage === "failed" && <div role="alert"><p>{copy.failed}</p><Button variant="outline" disabled={!canSave} onClick={() => void finish(session.retry())}>{copy.retry}</Button></div>}
    {(deleted || state.stage === "deleted") && <p role="alert">{copy.deleted}</p>}
    {state.stage === "conflicted" && <div role="alert"><p>{copy.conflict}</p>{changes && <>
      <dl>{changes.title !== undefined && <><dt>{copy.title} · {copy.current}</dt><dd>{current.chat.title ?? copy.chats}</dd>
        <dt>{copy.title} · {copy.mine}</dt><dd>{changes.title ?? copy.chats}</dd></>}
        {changes.archivedAt !== undefined && <><dt>{copy.archive} · {copy.current}</dt><dd>{current.archivedAt === null ? copy.active : copy.archived}</dd>
          <dt>{copy.archive} · {copy.mine}</dt><dd>{changes.archivedAt === null ? copy.active : copy.archived}</dd></>}
        {/* A raw sort key is a timestamp nobody can read; say only whether the row was placed by hand. */}
        {changes.sortKey !== undefined && <><dt>{copy.position} · {copy.current}</dt><dd>{current.chat.sortKey === undefined ? copy.positionCreated : copy.positionMoved}</dd>
          <dt>{copy.position} · {copy.mine}</dt><dd>{changes.sortKey === null ? copy.positionCreated : copy.positionMoved}</dd></>}</dl>
      <div className="chat-facts-actions"><Button disabled={!connected || deleted} onClick={() => void finish(session.useMine(current))}>{copy.useMine}</Button>
        <Button variant="outline" onClick={() => void finish(Promise.resolve(session.keepCurrent()))}>{copy.keepCurrent}</Button></div></>}
    </div>}
  </section>;
}
