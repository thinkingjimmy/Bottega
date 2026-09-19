/**
 * [INPUT]: Depends on account-fenced Project candidate/review IPC and shared accessible dialogs.
 * [OUTPUT]: Offers original-request retry, explicit keep and separately confirmed fresh deletion from Archive settings.
 * [POS]: Project deletion recovery UI; opening a review never submits or rebases an operation.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import type { CloudChatBridge } from "../../../../shared/cloud/chat";
import type { ProjectDeletionCandidate, ProjectDeletionReview } from "../../../../shared/cloud/projects/deletion";
import { projectDeletionCopy } from "./project-copy";
export function ProjectDeletionCandidates({ bridge, locale, online }: { bridge: CloudChatBridge; locale: string; online: boolean }) {
  const copy = projectDeletionCopy(locale), [items, setItems] = useState<ProjectDeletionCandidate[]>([]), [version, setVersion] = useState(0);
  const [afterId, setAfterId] = useState<string | null>(null), [cursor, setCursor] = useState<string | null>(null), [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null), [savedReview, setSavedReview] = useState<{ key: string; value: ProjectDeletionReview } | null>(null), [loadedReview, setLoadedReview] = useState<string | null>(null), [busy, setBusy] = useState(false), [actionFailed, setActionFailed] = useState(false);
  const candidate = items.find(item => item.projectId === selected);
  const submitting = useRef(false);
  const projectId = candidate?.projectId, reviewable = Boolean(candidate && ["conflicted", "kept"].includes(candidate.state) && online);
  const reviewKey = JSON.stringify([projectId, candidate?.candidateHash, online, version]), review = savedReview?.key === reviewKey ? savedReview.value : null;
  const loading = reviewable && loadedReview !== reviewKey;
  const refresh = () => { setAfterId(null); setVersion(value => value + 1); };
  useEffect(() => bridge.onLocalChanged?.(refresh), [bridge]);
  useEffect(() => {
    let active = true;
    void bridge.projectDeletionCatalog({ afterId }).then(page => { if (active) {
      setItems(old => afterId ? [...old, ...page.items.filter(item => !old.some(previous => previous.projectId === item.projectId))] : page.items); setCursor(page.cursor); setFailed(false);
    } }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [afterId, bridge, version]);
  useEffect(() => {
    if (!projectId || !reviewable) return;
    let active = true;
    void bridge.reviewProjectDeletion({ projectId }).then(value => { if (active) setSavedReview({ key: reviewKey, value }); })
      .catch(() => { if (active) setActionFailed(true); }).finally(() => { if (active) setLoadedReview(reviewKey); });
    return () => { active = false; };
  }, [bridge, projectId, reviewKey, reviewable]);
  const decide = async (action: "keep" | "delete") => {
    if (!review || submitting.current) return; submitting.current = true; setBusy(true); setActionFailed(false);
    try { await bridge.resolveProjectDeletion({ review, action, decisionId: crypto.randomUUID() }); setSelected(null); }
    catch { setActionFailed(true); } finally { submitting.current = false; setBusy(false); refresh(); }
  };
  const retry = async (projectId: string) => {
    if (submitting.current) return; submitting.current = true; setBusy(true); setActionFailed(false);
    try { await bridge.retryProjectDeletion({ projectId }); }
    catch { setActionFailed(true); } finally { submitting.current = false; setBusy(false); refresh(); }
  };
  if (!items.length && !failed) return null;
  return <section className="space-y-3" aria-labelledby="project-deletion-title"><h2 id="project-deletion-title" className="text-sm font-medium">{copy.title}</h2>
    {failed && <p role="alert" className="text-sm">{copy.error} <Button variant="outline" onClick={refresh}>{copy.review}</Button></p>}
    {!online && <p className="text-sm text-muted-foreground">{copy.online}</p>}
    <ul className="divide-y rounded-md border empty:hidden">{items.map(item => <li key={item.projectId} className="flex min-h-12 flex-wrap items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0"><p className="truncate text-sm font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{copy[item.state]}</p>{item.proposedNames.map(name => <p key={name} className="select-text break-words text-sm">{name}</p>)}</div>
      {item.state !== "deleted" && <Button variant="outline" disabled={!online || busy} onClick={() => { setActionFailed(false); setSelected(item.projectId); }}>{item.state === "pending" ? copy.retry : copy.review}</Button>}
    </li>)}</ul>
    {cursor && <Button variant="outline" onClick={() => setAfterId(cursor)}>{copy.more}</Button>}
    <Dialog open={Boolean(candidate)} onOpenChange={open => { if (!open && !busy) setSelected(null); }}><DialogContent>
      <DialogHeader><DialogTitle>{review?.name ?? candidate?.name}</DialogTitle><DialogDescription>{copy.description}</DialogDescription></DialogHeader>
      {candidate && <p className="text-sm">{copy[candidate.state]}</p>}{loading && <p role="status">{copy.loading}</p>}
      {review && <p className="text-sm">{copy.revision.replace("{revision}", String(review.revision))}</p>}
      <p className="text-sm text-muted-foreground">{copy.retained}</p>
      {actionFailed && <p role="alert" className="text-sm">{copy.error}</p>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setSelected(null)}>{copy.close}</Button>
        {candidate?.state === "pending" ? <Button disabled={!online || busy} onClick={() => void retry(candidate.projectId)}>{busy ? copy.working : copy.retry}</Button> : <>
          {!review && <Button disabled={!online || loading || busy} onClick={refresh}>{copy.review}</Button>}
          {review && <><Button variant="outline" disabled={!online || busy} onClick={() => void decide("keep")}>{copy.keep}</Button><Button variant="destructive" disabled={!online || busy} onClick={() => void decide("delete")}>{busy ? copy.working : copy.remove}</Button></>}
        </>}
      </DialogFooter>
    </DialogContent></Dialog>
  </section>;
}
