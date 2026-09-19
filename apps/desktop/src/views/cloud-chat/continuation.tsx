/**
 * [INPUT]: Depends on shared generation-fenced executor reading, sanitized capabilities, five-language copy and the existing composer owner.
 * [OUTPUT]: Provides the banner action, preparation/deletion feedback, readonly App explanation and explicit retained-draft save-error retry.
 * [POS]: Desktop mirror continuation controls; only a ready native route exposes sending and attachments.
 */
import { useState } from "react";
export { useChatExecution as useContinuation } from "@ai-chat/chat-ui/platform-hooks";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { ExecutorFacade, ExecutionView } from "@ai-chat/chat-ui/contracts";
import type { ExecutionCopy } from "@ai-chat/chat-ui/execution-copy";
import type { useContinuationDraft } from "@/lib/cloud/chat/draft";
export type ContinuationDraft = ReturnType<typeof useContinuationDraft>;
export function ContinuationBanner({ chatId, executor, view, copy, draft, deviceName, deviceState, ordinary }: {
  chatId: string; executor: ExecutorFacade; view: ExecutionView | null; copy: ExecutionCopy; draft: ContinuationDraft;
  deviceName: string; deviceState: string; ordinary: boolean;
}) {
  const phase = view?.phase, remote = view?.head?.executorDeviceId !== view?.localDeviceId;
  const preparation = phase && ["settling", "body", "home", "attachments"].includes(phase) ? copy[phase as "settling" | "body" | "home" | "attachments"] :
    phase === "claiming" ? copy.claiming : view?.reason === "body-unavailable" ? copy.bodyFailed : ["home-unavailable", "chat-home-unavailable"].includes(view?.reason ?? "") ? copy.homeFailed :
    view?.reason === "permission-required" ? copy.authorize : ["project-unbound", "project-path-unbound"].includes(view?.reason ?? "") ? copy.bindProject : view?.phase === "blocked" ? copy.failed : null;
  const device = remote && view?.head?.executionPreparation ? (view.head.executionPreparation.state === "ready" ? copy.remoteReady : copy.remotePreparing) : copy.runningOn;
  return <aside className="chat-executor-banner flex flex-wrap items-center justify-between gap-3">
    <div className="min-w-0 flex-1 space-y-1" role="status"><p>{view?.reason === "deleted" ? copy.deleted : preparation ?? device.replace("{device}", deviceName)}</p>
      {view?.reason !== "deleted" && <p className="text-xs">{ordinary ? deviceState : copy.appReadonly}</p>}</div>
    {ordinary && view?.reason !== "deleted" && <ContinueAction chatId={chatId} executor={executor} view={view} copy={copy} draft={draft} />}
  </aside>;
}
export function ContinueAction({ chatId, executor, view, copy, draft }: { chatId: string; executor: ExecutorFacade; view: ExecutionView | null; copy: ExecutionCopy; draft: ContinuationDraft }) {
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const preparing = view && ["settling", "body", "home", "attachments"].includes(view.phase);
  const action = async () => {
    if (busy || !view) return; setBusy(true); setFailed(false);
    try { await draft.flush(); if (view.canPrepare) await executor.prepare(chatId); else if (view.canClaim) await executor.claim(chatId); }
    catch { setFailed(true); } finally { setBusy(false); }
  };
  return <div className="flex items-center gap-2">
    {(failed || draft.error) && <span className="text-xs text-destructive" role="alert">{draft.error ? copy.draftFailed : copy.unavailable}</span>}
    {draft.error && <Button type="button" size="sm" variant="outline" onClick={() => void draft.retry().catch(() => {})}>{copy.retryDraft}</Button>}
    <Button size="sm" className="min-h-11" disabled={busy || !draft.ready || !view || !view.canClaim && !view.canPrepare} onClick={() => void action()}>
      {preparing ? copy.preparing : busy || view?.phase === "claiming" ? copy.claiming : view?.canPrepare ? copy.retryPreparation : copy.continueHere}
    </Button>
  </div>;
}
