/**
 * [INPUT]: Private recovery token, immutable receipt entries and current-executor submit authority.
 * [OUTPUT]: Native-equivalent recovery dialog whose action remains pending until durable evidence arrives.
 * [POS]: Remote adapter for the shared recovery view; dismissing never resolves the turn.
 */
import { useState } from "react";
import type { LiveProjection } from "@ai-chat/cloud-protocol/turns/live";
import { ResumeFailureDialog } from "../../conversation/interactions/recovery";
import { useComposerTranslation } from "../../composer/controls/copy/translation";
import type { RemoteInteractionControls, RemoteAction } from "./interactions";
type Recovery = NonNullable<LiveProjection["recovery"]>;
type Action = "sameSession" | "freshSession" | "abandon";
const kinds = { sameSession: "retry-same-session", freshSession: "retry-without-session", abandon: "abandon-fatal-turn" } as const;
export function RemoteRecovery({ recovery, requestId, controls }: { recovery: Recovery; requestId: string; controls: RemoteInteractionControls }) {
  const [open, setOpen] = useState(true), [sending, setSending] = useState<Action | null>(null), [error, setError] = useState("");
  const translate = useComposerTranslation(controls.locale ?? "en");
  const matches = (payload: RemoteAction) => "retryToken" in payload && payload.requestId === requestId && payload.retryToken === recovery.retryToken;
  const entries = controls.entries.filter(entry => matches(entry.input.payload)), latest = entries.at(-1), receipt = latest?.receipt;
  const done = receipt?.state === "done", failed = latest?.rejected || receipt && ["rejected", "expired", "error"].includes(receipt.state);
  const pending = !failed && latest && !done ? Object.entries(kinds).find(([, kind]) => kind === latest.input.payload.kind)?.[0] as Action : null;
  const run = async (action: Action) => {
    if (controls.disabled || sending || pending || done) return;
    setSending(action); setError("");
    try { if (!await controls.submit({ kind: kinds[action], requestId, retryToken: recovery.retryToken, generation: recovery.generation })) setError(controls.copy.requestFailed); }
    catch { setError(controls.copy.requestFailed); }
    finally { setSending(null); }
  };
  if (done) return <p role="status">{controls.copy.alreadyResolved}</p>;
  const allowed = Object.fromEntries(Object.entries(recovery.allowedActions).map(([key, value]) => [key, value && !controls.disabled])) as Recovery["allowedActions"];
  return <ResumeFailureDialog translate={(key, values) => translate(key.replace(/^chat\./, ""), values)} controller={{
    resumeFailure: { retried: recovery.generation > 1, allowedActions: allowed }, resumeFailureOpen: open, resumeFailurePending: sending ?? pending ?? null,
    resumeFailureError: error || (failed ? controls.copy.requestFailed : ""), selectedBackend: { displayName: controls.backendName ?? "Agent" },
    setResumeFailureOpen: setOpen, retrySameSession: () => run("sameSession"), retryWithoutSession: () => run("freshSession"), abandonResumeFailure: () => run("abandon"),
  }} />;
}
