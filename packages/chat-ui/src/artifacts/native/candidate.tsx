/**
 * [INPUT]: Exact native work/view baseline, saved recovery input and immutable candidate/preview workspace ports.
 * [OUTPUT]: NativeCandidate controls same-Provider generation, authenticated rendered preview, visible preview before bounded response details, recoverable status/input feedback, exact acceptance, discard and existing-only original-operation recovery through the current authenticated read view.
 * [POS]: Trusted candidate UI; only the main-owned journal can apply or roll back source.
 */
import { nativeOperationReference } from "@ai-chat/cloud-protocol/artifacts/design/native/operation";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceCommand, WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { ArtifactHost, ArtifactLease } from "../context";
import type { NativeInput } from "@ai-chat/cloud-protocol/artifacts/design/native/comments";
import { nativeThemedLease, useNativeTheme } from "./appearance";
import { saveNativeDownload, type NativeDownloadLease } from "./download";
import { nativeCopy } from "./copy";
type Command = Omit<WorkspaceCommand, "chatId" | "incarnationId">;
type Baseline = Pick<Command, "artifactId" | "documentId" | "viewId" | "generation" | "expectedRevision" | "readSetDigest">;
type Candidate = { candidateId?: string; candidateDigest?: string; requestId?: string; phase: string; previewFile?: string; baseline?: Baseline; error?: string; provider?: string; model?: string; answer?: string };
export function NativeCandidate({ host, state, viewId, input, read, update, flush, applied }: { host: ArtifactHost; state: WorkspaceRead; viewId: string;
  input: NativeInput; read(): NativeInput; update(value: NativeInput): Promise<unknown>; flush(): Promise<void>; applied(): void | Promise<void> }) {
  const copy = nativeCopy(host.locale), [candidate, setCandidate] = useState<Candidate>({ phase: "idle" }), [busy, setBusy] = useState(false), [statusFailed, setStatusFailed] = useState(false), [failed, setFailed] = useState(false);
  const [lease, setLease] = useState<NativeDownloadLease | null>(null), [readyLease, setReadyLease] = useState<string | null>(null), frame = useRef<HTMLIFrameElement>(null);
  const onThemeLoad = useNativeTheme(frame, lease);
  const workspace = host.workspace!, release = host.release;
  const current = { artifactId: state.fence!.id, documentId: state.documentId, generation: state.generation, viewId };
  const currentKey = JSON.stringify(current), baselineKey = JSON.stringify(candidate.baseline ?? null);
  useEffect(() => {
    const current = JSON.parse(currentKey) as Baseline;
    let alive = true, reading = false;
    const read = async () => { if (reading || !alive) return; reading = true; try { const next = await workspace({ ...current, action: "native-candidate-status" }) as Candidate; if (alive) { setCandidate(next); setStatusFailed(false); } } catch { if (alive) setStatusFailed(true); } finally { reading = false; } };
    void read(); const timer = setInterval(() => { void read(); }, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [workspace, currentKey]);
  useEffect(() => {
    if (candidate.phase !== "candidate" || !candidate.candidateId || !candidate.candidateDigest || baselineKey === "null") return;
    const baseline = JSON.parse(baselineKey) as Baseline;
    let alive = true, owned: ArtifactLease | null = null;
    const identity = { ...baseline, candidateId: candidate.candidateId, candidateDigest: candidate.candidateDigest };
    void workspace({ ...identity, action: "native-candidate-preview" }).then(value => {
      const result = value as ArtifactLease & { nativeToken: string };
      if (!alive) { release(result); return; } const themed = nativeThemedLease({ ...result, artifactId: baseline.artifactId! }); owned = themed; setLease(themed);
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (owned) release(owned); setLease(null); };
  }, [workspace, release, candidate.candidateId, candidate.candidateDigest, candidate.phase, baselineKey]);
  useEffect(() => {
    const message = (event: MessageEvent) => {
      if (!event.isTrusted || !lease || event.origin !== lease.origin || event.source !== frame.current?.contentWindow || event.data?.token !== lease.nativeToken) return;
      if (event.data.type === "bottega:native:download") { void saveNativeDownload(host, lease, event).catch(() => setFailed(true)); return; }
      if (event.data.type === "bottega:native:error") { setFailed(true); setReadyLease(null); return; }
      if (event.data.type !== "bottega:native:content-ready" || event.data.file !== candidate.previewFile || baselineKey === "null") return;
      void workspace({ ...JSON.parse(baselineKey) as Baseline, action: "native-candidate-ready", candidateId: candidate.candidateId, candidateDigest: candidate.candidateDigest, nonce: lease.id })
        .then(() => setReadyLease(lease.id)).catch(() => setFailed(true));
    };
    window.addEventListener("message", message); return () => window.removeEventListener("message", message);
  }, [host, workspace, lease, candidate.candidateId, candidate.candidateDigest, candidate.previewFile, baselineKey]);
  const perform = async (command: Command, statusOnly = false) => {
    setBusy(true); setFailed(false);
    try {
      if (!statusOnly) await update({ ...read(), pending: JSON.stringify(command) });
      const query: Command = statusOnly ? { ...current, action: "operation-status", artifactId: command.artifactId, documentId: command.documentId,
        requestId: command.requestId, nativeOperation: nativeOperationReference(command) } : command;
      const result = await host.workspace!(query) as { status?: string; phase?: string };
      if (result.status === "committed") { await update({ ...read(), pending: undefined }); await applied(); }
      else if (result.status === "pending") setCandidate(value => ({ ...value, phase: "pending" }));
      else if (result.phase) { setCandidate(result as Candidate); await update({ ...read(), pending: undefined }); }
      else throw new Error("Original operation could not complete");
    } catch { setFailed(true); } finally { setBusy(false); }
  };
  const generate = async (continuing: boolean) => {
    setBusy(true); setFailed(false);
    try {
      await flush();
      const head = await host.workspace!({ action: "native-head", artifactId: state.fence!.id }) as WorkspaceRead;
      const command: Command = { action: "native-candidate", artifactId: head.fence!.id, documentId: head.documentId, viewId,
        generation: head.generation, expectedRevision: head.revision, readSetDigest: head.readSetDigest, requestId: crypto.randomUUID(),
        value: input.instruction.trim() || "Apply the open comments in comments.json. Preserve resolved comments and do not resolve threads automatically.",
        ...(continuing ? { candidateId: candidate.candidateId, candidateDigest: candidate.candidateDigest } : {}) };
      await perform(command);
    } catch { setFailed(true); setBusy(false); }
  };
  const identity = { ...candidate.baseline, candidateId: candidate.candidateId, candidateDigest: candidate.candidateDigest };
  const generating = ["queued", "generating"].includes(candidate.phase);
  const button = "min-h-[44px] rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50";
  return <section data-native-candidate="" aria-label={copy.ai} className="flex min-h-0 flex-1 flex-col gap-3">
    <label className="text-sm">{copy.instructions}<textarea aria-label={copy.instructions} value={input.instruction} maxLength={4096} className="mt-1 min-h-20 w-full rounded-md border bg-background p-2" onChange={event => { void update({ ...read(), instruction: event.target.value }).catch(() => {}); }} /></label>
    <div className="flex flex-wrap gap-2">
      {generating ? <button type="button" className={button} disabled={busy} onClick={() => void perform({ ...identity, action: "native-candidate-cancel", requestId: candidate.requestId })}>{copy.stop}</button>
        : <button type="button" className={button} disabled={busy || ["accepting", "pending"].includes(candidate.phase)} onClick={() => void generate(candidate.phase === "candidate")}>{candidate.phase === "candidate" ? copy.continue : copy.generate}</button>}
      {candidate.phase === "candidate" && <><button type="button" className={button} disabled={busy || !lease || readyLease !== lease.id} onClick={() => void perform({ ...identity, action: "native-candidate-accept", requestId: crypto.randomUUID() })}>{copy.accept}</button>
        <button type="button" className={button} disabled={busy} onClick={() => void perform({ ...identity, action: "native-candidate-discard" })}>{copy.discard}</button></>}
      {state.aiRollback && <button type="button" className={button} disabled={busy || generating} onClick={() => void (async () => {
        await flush(); const head = await host.workspace!({ action: "native-head", artifactId: state.fence!.id }) as WorkspaceRead;
        await perform({ ...current, artifactId: head.fence!.id, action: "native-ai-rollback", requestId: crypto.randomUUID(), rollbackOf: state.aiRollback!.requestId, expectedRevision: head.revision, readSetDigest: head.readSetDigest });
      })().catch(() => setFailed(true))}>{copy.rollback}</button>}
    </div>
    {generating && <p role="status" className="text-sm">{copy.generating}</p>}
    {candidate.phase === "pending" && <p role="status" className="text-sm">{copy.pending}</p>}
    {input.pending && <button type="button" className={button} disabled={busy} onClick={() => { try {
      const command = JSON.parse(input.pending!) as Command;
      if (["native-candidate-accept", "native-ai-rollback"].includes(command.action)) void perform(command, true).catch(() => setFailed(true));
      else if (command.action === "native-candidate") void (async () => {
        setBusy(true);
        try {
          const result = await workspace({ ...current, action: "native-candidate-status" }) as Candidate;
          setCandidate(result);
          await update({ ...read(), pending: undefined });
          setFailed(result.requestId !== command.requestId);
        } catch { setFailed(true); } finally { setBusy(false); }
      })();
      else setFailed(true);
    } catch { setFailed(true); } }}>{copy.check}</button>}
    {(failed || statusFailed || candidate.phase === "failed") && <p role="alert" className="text-sm">{candidate.error?.includes("Provider") ? copy.unavailable : copy.failed}</p>}
    {lease && <iframe ref={frame} data-native-candidate-frame="" title={copy.candidate} src={lease.url} sandbox={lease.sandbox} referrerPolicy="no-referrer" onLoad={() => { if (frame.current?.contentWindow) lease.mount?.(frame.current.contentWindow); onThemeLoad(); if (lease) frame.current?.contentWindow?.postMessage({ type: "bottega:native:get-content-ready", token: lease.nativeToken }, lease.origin === "null" ? "*" : lease.origin); }} className="min-h-64 w-full flex-1 rounded-md border" />}
    {candidate.answer && <details className="shrink-0 text-sm"><summary className="cursor-pointer font-medium">{copy.response}</summary><p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{candidate.answer}</p></details>}
  </section>;
}
