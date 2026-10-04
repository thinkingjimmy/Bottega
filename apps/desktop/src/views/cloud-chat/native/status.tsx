/**
 * [INPUT]: Depends on the scoped execution facade, local draft custody and shared execution copy.
 * [OUTPUT]: Renders retryable preparation status and the Home snapshot capture failure (Retry, Skip) inside the ordinary conversation, and states deletion once, at the composer position.
 * [POS]: Native Chat status slot; confirmed local execution renders no additional interface.
 */
import { executionCopy } from "@ai-chat/chat-ui/execution-copy";
import { useChatExecution } from "@ai-chat/chat-ui/platform-hooks";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useDesktopChatSources } from "@/lib/cloud/chat/sources";
import { useContinuationDraft } from "@/lib/cloud/chat/draft";
import { useCloudAccount } from "@/lib/cloud/client";
import { ContinueAction } from "../continuation";
import { useState, type ReactNode } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { ExecutionCopy } from "@ai-chat/chat-ui/execution-copy";
import type { ExecutionFacade, ExecutionView } from "@ai-chat/chat-ui/contracts";

export function NativeCloudComposer({ chatId, children }: { chatId: string; children: ReactNode }) {
  const sources = useDesktopChatSources();
  return sources ? <Composer chatId={chatId} sources={sources}>{children}</Composer> : children;
}
function Composer({ chatId, sources, children }: { chatId: string; sources: NonNullable<ReturnType<typeof useDesktopChatSources>>; children: ReactNode }) {
  const { view } = useChatExecution(chatId, sources.execution), { i18n } = useAppTranslation();
  const copy = executionCopy(i18n.language);
  if (view?.reason === "deleted") return <div role="status" className="mx-auto w-full max-w-3xl px-4 py-3 text-sm text-muted-foreground">{copy.deleted}</div>;
  return children;
}

export function NativeCloudStatus({ chatId }: { chatId: string }) {
  const sources = useDesktopChatSources();
  return sources ? <Status chatId={chatId} sources={sources} /> : null;
}

function Status({ chatId, sources }: { chatId: string; sources: NonNullable<ReturnType<typeof useDesktopChatSources>> }) {
  const { view } = useChatExecution(chatId, sources.execution), { i18n } = useAppTranslation();
  const account = useCloudAccount(), copy = executionCopy(i18n.language);
  const draft = useContinuationDraft(chatId, view?.head?.chat.incarnationId, account.profile?.userId);
  // Deletion is stated once at the composer; the status row doesn't repeat it.
  if (view?.reason === "deleted") return null;
  if (view?.head?.ownerDeviceId && view.head.ownerDeviceId !== view.localDeviceId) return null;
  if (view?.homeCapture && view.homeCapture.reason !== "pending") return <HomeCaptureStatus chatId={chatId} execution={sources.execution} capture={view.homeCapture} copy={copy} />;
  if (!view || view.phase === "ready" || !view.head) return null;
  if (view.phase !== "blocked") return null;
  return <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-2 text-xs text-muted-foreground" role="status">
    <span className="flex-1">{copy.failed}</span>
    <ContinueAction chatId={chatId} execution={sources.execution} view={view} copy={copy} draft={draft} />
  </div>;
}

/* F-14: a transient failure retries on its own and offers Retry now; a permanent one, or a transient one that has hit the 60 s cap,
   also offers Skip, which releases the next send and records the turn as having no saved files. */
const SKIP_AFTER_FAILURES = 6;
function HomeCaptureStatus({ chatId, execution, capture, copy }: { chatId: string; execution: ExecutionFacade; capture: NonNullable<ExecutionView["homeCapture"]>; copy: ExecutionCopy }) {
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const permanent = capture.reason === "permanent", skippable = permanent || capture.failures >= SKIP_AFTER_FAILURES;
  const act = async (action: "retry" | "skip") => {
    if (busy || !execution.homeCapture) return; setBusy(true); setFailed(false);
    try { await (action === "skip" ? execution.homeCapture.skip(chatId, capture.jobId) : execution.homeCapture.retry(chatId)); } catch { setFailed(true); } finally { setBusy(false); }
  };
  return <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 px-4 py-2 text-xs text-muted-foreground" role="status">
    <span className="min-w-0 flex-1">{permanent ? copy.homeCaptureLost : copy.homeCaptureRetrying}</span>
    {failed && <span className="text-destructive" role="alert">{copy.homeCaptureActionFailed}</span>}
    {execution.homeCapture && <div className="flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => void act("retry")}>{copy.retryHomeCapture}</Button>
      {skippable && <Button type="button" size="sm" className="min-h-11" disabled={busy} onClick={() => void act("skip")}>{copy.skipHomeCapture}</Button>}
    </div>}
  </div>;
}
