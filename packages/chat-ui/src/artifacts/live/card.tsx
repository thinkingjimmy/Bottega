/**
 * [INPUT]: A canonical live-app fence and a host's explicit preview actions.
 * [OUTPUT]: LivePreviewCard with expiring credentials, cancelable connection progress, ordered status/action results, persistent failure/reopen and draining states, actionable restart and development origin repair drafts.
 * [POS]: Shared UI; no hostname or credential is stored beyond the current component lifetime.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { PreviewView } from "@ai-chat/cloud-protocol/resources/preview";
import { useArtifactHost, type ArtifactHost } from "../context";
import { livePreviewCopy, livePreviewRecovery, livePreviewLifecycle, previewFailure, previewErrorCode } from "./copy";
export function LivePreviewCard({ fence }: { fence: ArtifactFence }) {
  const host = useArtifactHost()!;
  return <PreviewCard key={`${host.scope}:${fence.id}`} fence={fence} host={host} />;
}
type PreviewAction = "preview-start" | "preview-stop" | "preview-issue-code" | "preview-keep-running";
function PreviewCard({ fence, host }: { fence: ArtifactFence; host: ArtifactHost }) {
  const copy = livePreviewCopy(host.locale), epoch = useRef(0), previousPending = useRef<PreviewAction | null>(null);
  const recovery = livePreviewRecovery(host.locale), lifecycle = livePreviewLifecycle(host.locale);
  const [view, setView] = useState<PreviewView | null>(null), [pending, setPending] = useState<PreviewAction | null>(null), [error, setError] = useState<Error | null>(null);
  const [entry, setEntry] = useState<{ url: string; sessionId: string } | null>(null);
  const url = entry && view?.state === "open" && entry.sessionId === view.sessionId ? entry.url : null;
  const busy = pending !== null, connecting = view?.state === "registering" || view?.state === "edge";
  const [qr, setQr] = useState<string | null>(null);
  const failure = error?.message ?? view?.failure;
  const errorCode = previewErrorCode(failure ?? "");
  const blocked = errorCode === "tunnel-platform-unsupported" || errorCode === "tunnel-plugin-disabled";
  const managed = fence.service?.lifecycle === "managed" || !!view && view.state !== "captured", available = !!host.preview && (!!host.keepPreview || fence.service?.lifecycle === "managed");
  useEffect(() => () => { epoch.current++; }, [host.scope, host.preview, fence]);
  useEffect(() => {
    let closed = false, reading = false;
    const read = async () => {
      if (reading || !available || document.visibilityState === "hidden") return;
      reading = true; const generation = epoch.current;
      try {
        const next = await host.preview!(fence, "preview-status");
        if (!closed && generation === epoch.current) {
          setError(null); setView(next);
          setEntry(prior => next.state === "open" && prior?.sessionId === next.sessionId ? prior : null);
        }
      } catch (cause) {
        if (!closed && generation === epoch.current) { setError(cause instanceof Error ? cause : new Error()); setEntry(null); }
      } finally { reading = false; }
    };
    // Preserve the normal post-action interval so a refusal remains readable before the next status poll.
    const completed = previousPending.current !== null && pending === null;
    previousPending.current = pending;
    if (!completed) void read();
    const timer = setInterval(() => void read(), pending || connecting ? 500 : 15_000);
    return () => { closed = true; clearInterval(timer); };
  }, [host.scope, host.preview, fence, available, pending, connecting]);
  useEffect(() => { if (!url) return; const timer = setTimeout(() => setEntry(null), 60_000); return () => clearTimeout(timer); }, [url]);
  useEffect(() => {
    let disposed = false;
    if (url) void import("qrcode").then(module => module.toDataURL(url, { width: 224, margin: 2, errorCorrectionLevel: "M" }))
      .then(value => { if (!disposed) setQr(value); }).catch(() => undefined);
    return () => { disposed = true; };
  }, [url]);
  const action = async (name: PreviewAction) => {
    if (!host.preview || busy && (name !== "preview-stop" || pending === "preview-stop")) return;
    // A newer intent supersedes both pending actions and status reads begun before it.
    const generation = ++epoch.current;
    setPending(name); setError(null); setEntry(null); setQr(null);
    try {
      const next = name === "preview-keep-running" ? await host.keepPreview!(fence) : await host.preview(fence, name);
      if (generation === epoch.current) {
        setView(next);
        setEntry(next.state === "open" && next.sessionId && next.entryUrl ? { url: next.entryUrl, sessionId: next.sessionId } : null);
      }
    } catch (cause) { if (generation === epoch.current) setError(cause instanceof Error ? cause : new Error()); }
    finally { if (generation === epoch.current) { epoch.current++; setPending(null); } }
  };
  return <div className="space-y-3">
    <p className="font-mono">127.0.0.1:{fence.service?.port}</p>
    <p className="text-sm text-muted-foreground">{copy[4]}</p>
    {view?.state === "captured" && <p>{recovery[1]}</p>}
    {(view || pending) && <p role="status">{pending === "preview-stop" ? lifecycle.closing : view?.state === "registering" ? copy[8] : view?.state === "edge" ? copy[9] : view?.state === "open" ? copy[10] : view?.state === "draining" ? lifecycle.draining : view?.state === "closed" ? copy[20] : pending === "preview-start" ? lifecycle.connecting : null}</p>}
    <div className="flex flex-wrap gap-2">
      {!blocked && view?.state === "captured" && host.keepPreview && <Button type="button" size="sm" className="min-h-11" disabled={busy} onClick={() => void action("preview-keep-running")}>{recovery[0]}</Button>}
      {!blocked && view && available && managed && <Button type="button" size="sm" className="min-h-11" disabled={busy || connecting || view.state === "draining"} onClick={() => void action(view?.state === "open" ? "preview-issue-code" : "preview-start")}>{view?.state === "open" ? copy[13] : view?.state === "failed" && view.failure === "preview-tunnel-unavailable" ? lifecycle.reopen : copy[0]}</Button>}
      {(view?.sessionId || pending === "preview-start") && <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={pending === "preview-stop"} onClick={() => void action("preview-stop")}>{copy[1]}</Button>}
      {url && <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => { const link = url; setEntry(null); setQr(null); void host.openPreview?.(link); }}>{copy[2]}</Button>}
      {host.followUp && (!managed || failure) && <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => host.followUp!({ prompt: copy[19] })}>{copy[3]}</Button>}
      {host.managePreviews && <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={host.managePreviews}>{copy[18]}</Button>}
    </div>
    {url && <p className="text-sm text-muted-foreground">{copy[12]}</p>}
    {url && qr && <img src={qr} width={224} height={224} alt={copy[12]} className="rounded-md" />}
    {view?.streaming && <p role="status">{copy[11]}</p>}
    {view?.devOriginBlocked && <div>
      <p role="status" className="text-sm text-muted-foreground">{recovery[5]}</p>
      {host.followUp && <Button type="button" variant="link" className="min-h-11 px-0" onClick={() => host.followUp!({ prompt: recovery[6] })}>{recovery[4]}</Button>}
    </div>}
    {view?.slowLoad && host.followUp && <Button type="button" variant="link" className="min-h-11 px-0" onClick={() => host.followUp!({ prompt: recovery[3] })}>{recovery[2]}</Button>}
    {failure && <p role="alert">{previewFailure(failure, host.locale)}</p>}
  </div>;
}
