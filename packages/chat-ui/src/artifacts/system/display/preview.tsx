/**
 * [INPUT]: An immutable system board, original mounted owner and authenticated immutable board preview lease.
 * [OUTPUT]: Quota-bound read-only system preview with authenticated readiness, local board navigation and terminal cleanup.
 * [POS]: System overview/component display independent of Canvas editing or camera state.
 */
import { useEffect, useRef, useState } from "react";
import { useArtifactHost, type ArtifactLease } from "../../context";
import { PreviewLifetime } from "../../lifecycle/lease";
import { requestArtifactFrame } from "../../quota";
import { workspaceCopy } from "./copy";
type Lease = ArtifactLease & { nonce: string; generation: string; boardId: string; boardDigest: string };
export function SystemPreview({ artifactId, boardId, generation, revision, viewId, title, enabled, onNavigate }: { artifactId: string; boardId: string; generation: string; revision: number; viewId?: string; title: string; enabled: boolean; onNavigate(id: string): void }) {
  const host = useArtifactHost()!, copy = workspaceCopy(host.locale), frame = useRef<HTMLIFrameElement>(null);
  const mounted = useRef(new WeakSet<HTMLIFrameElement>());
  const [lease, setLease] = useState<Lease | null>(null), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled || failed) return;
    const controller = new AbortController();
    const lifetime = new PreviewLifetime<Lease>(value => host.release(value), () => setFailed(true));
    let owned: Lease | null = null;
    const quota = requestArtifactFrame(() => {
      lifetime.acquiring();
      void host.workspace!({ action: "preview", scope: "board", artifactId, boardId, generation, targetRevision: revision, viewId }, controller.signal).then(value => {
        const next = value as Lease;
        if (lifetime.accept(next)) { owned = next; setLease(next); }
      }).catch(() => lifetime.fail());
    }, () => { lifetime.dispose(); setLease(null); }, 2);
    const receive = (event: MessageEvent) => {
      const value = event.data;
      if (!owned || event.source !== frame.current?.contentWindow || event.origin !== (owned.sandbox.includes("allow-same-origin") ? owned.origin : "null") ||
        value?.id !== owned.id || value.nonce !== owned.nonce || value.generation !== generation || value.boardId !== boardId || value.boardDigest !== owned.boardDigest) return;
      if (value.type === "bottega:design:geometry") lifetime.ready();
      if (value.type === "bottega:design:navigate" && typeof value.targetBoardId === "string") onNavigate(value.targetBoardId);
    };
    addEventListener("message", receive);
    return () => { controller.abort(); removeEventListener("message", receive); quota(); lifetime.dispose(); };
  }, [host, artifactId, boardId, generation, revision, viewId, enabled, retry, failed, onNavigate]);
  return <div aria-busy={enabled && !lease && !failed || undefined} className="flex min-h-64 min-w-0 flex-1 flex-col">
    {!enabled ? <p role="status">{copy.off}</p> : !lease && !failed ? <p role="status">{copy.loading}</p> : null}
    {failed ? <div role="alert"><p>{copy.failed}</p><button type="button" className="min-h-[44px] rounded border px-3" onClick={() => { setFailed(false); setRetry(value => value + 1); }}>{copy.retry}</button></div> :
      <iframe key={lease?.id ?? "waiting"} ref={frame} title={title} src={enabled ? lease?.url : undefined} sandbox={lease?.sandbox ?? "allow-scripts"} referrerPolicy="no-referrer" className="min-h-64 w-full flex-1 border-0" onLoad={() => {
        const node = frame.current;
        if (!lease || !node?.contentWindow) return;
        if (mounted.current.has(node)) { setFailed(true); return; }
        mounted.current.add(node); lease.mount?.(node.contentWindow);
      }} />}
  </div>;
}
