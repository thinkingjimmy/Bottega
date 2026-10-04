/**
 * [INPUT]: Depends on the injected deletion controller, confirmed Chat revision, connectivity, the owning computer's availability and shadcn Dialog/Button.
 * [OUTPUT]: Presents deletion confirmation, dismissal after completed keep decisions, stable-request recovery and renewed revision review.
 * [POS]: Shared deletion surface; it never discards content optimistically or manufactures execution authority.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@ai-chat/ui/components/ui/dialog";
import type { ChatDeletionController } from "./session";
import { chatDeletionCopy } from "./copy";
export function ChatDeletion({ head, session, locale, connected, disabled = false, deleted = false, durable = false, initiallyOpen = false, hideTrigger = false, blocked = null, onUnresolvedChange, onDismiss }: {
  head: CloudChatHead; session: ChatDeletionController; locale: string; connected: boolean; disabled?: boolean; deleted?: boolean;
  initiallyOpen?: boolean; hideTrigger?: boolean; durable?: boolean;
  /** Why the computer that owns this Chat cannot be asked to erase it right now; deleting is an execution command. */
  blocked?: string | null;
  onUnresolvedChange?(unresolved: boolean): void; onDismiss?(): void;
}) {
  const copy = chatDeletionCopy(locale), state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const [review, setReview] = useState<CloudChatHead | null>(initiallyOpen ? head : null);
  const busy = state.stage === "saving", unresolved = busy || state.stage === "failed";
  /* Deletion is not a record write: the owning computer has to erase its own copy, so it has to be up. An attempt
     already in flight is never withdrawn by a computer going to sleep — only a new one is refused. */
  const canSubmit = (connected || durable) && !blocked;
  const removed = deleted || state.stage === "deleted";
  useEffect(() => { onUnresolvedChange?.(unresolved); }, [unresolved, onUnresolvedChange]);
  const finish = async (attempt: Promise<void>) => { await attempt; if (session.snapshot().stage !== "failed") setReview(null); };
  const dismiss = () => { setReview(null); onDismiss?.(); };
  const keep = async () => {
    await session.keep();
    if (session.snapshot().stage === "idle") dismiss();
  };
  const conflictReady = state.result?.status !== "conflicted" || (state.result.currentRevision ?? 0) <= head.chat.cloudRevision;
  return <section className="chat-facts" aria-label={copy.action}>
    {!hideTrigger && !removed && state.stage === "idle" && <Button variant="outline" disabled={disabled || !canSubmit} onClick={() => setReview(head)}>{copy.action}</Button>}
    {!connected && !removed && !durable && <p role="status">{copy.offline}</p>}
    {blocked && !removed && state.stage === "idle" && <p role="status" data-deletion-blocked>{blocked}</p>}
    {busy && <p role="status">{copy.deleting}</p>}
    {state.stage === "pending" && <p role="status">{copy.pending}</p>}
    {removed && <p role="status">{copy.deleted}</p>}
    {state.stage === "failed" && <div role="alert"><p>{copy.failed}</p><Button variant="outline" disabled={!canSubmit} onClick={() => void finish(session.retry())}>{copy.retry}</Button></div>}
    {state.stage === "conflicted" && !removed && <div role="alert"><p>{copy.conflict}</p><div className="chat-facts-actions">
      <Button variant="outline" disabled={disabled || !canSubmit || !conflictReady} onClick={() => setReview(head)}>{copy.review}</Button>
      <Button variant="outline" onClick={() => void keep()}>{copy.keep}</Button></div></div>}
    <Dialog open={review !== null && !removed} onOpenChange={open => { if (!open && !busy) dismiss(); }}>
      <DialogContent showCloseButton={!busy}><DialogHeader><DialogTitle>{copy.title}</DialogTitle><DialogDescription>{copy.detail}</DialogDescription></DialogHeader>
        <p>{review?.chat.title ?? copy.unnamed}</p>
        <DialogFooter><Button size="pill" variant="outline" disabled={busy} onClick={dismiss}>{copy.cancel}</Button>
          <Button size="pill" variant="destructive" disabled={disabled || !canSubmit || busy || state.stage === "failed" || !review}
            onClick={() => { if (review) void finish(session.submit(review)); }}>{busy ? copy.deleting : copy.action}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
