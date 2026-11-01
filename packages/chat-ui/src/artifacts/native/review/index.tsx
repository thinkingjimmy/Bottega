/**
 * [INPUT]: Authenticated native compose messages, upstream comments.json threads and existing revision-bound recovery input.
 * [OUTPUT]: NativeReview provides compact native-style adaptive review toolbar, nearby compose, stable save confirmation and latest-input-owned validation feedback and recovered-error clearing, additive comment/native prompt drafts, replies, resolve/reopen/reveal and explicit isolated candidate actions.
 * [POS]: Trusted review adapter around the maintained editor; comment saves use its same journaled backend.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MessageSquare, Sparkles, X } from "lucide-react";
import { nativeComposeSchema, type NativeComments, type NativeInput } from "@ai-chat/cloud-protocol/artifacts/design/native/comments";
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { ArtifactHost } from "../../context";
import { NativeInputRecovery } from "../recovery";
import { useNativeInput } from "../input";
import { NativeCandidate } from "../candidate";
import { nativeCopy } from "../copy";
import { useNativeCommentSave } from "./save";
import { useNativeSuggestions } from "./suggestion";
const emptyComments: NativeComments = { version: 1, threads: [] };
function nativeCommentTarget(detail: unknown, state: WorkspaceRead) {
  if (typeof detail !== "string") return {};
  const candidates = state.manifest.boards.filter(board => [board.file + ":", "project/" + board.file + ":"].some(prefix => detail.startsWith(prefix)));
  return candidates.length === 1 ? { file: candidates[0]!.file, snapshotRef: state.snapshotRef, readSetDigest: state.readSetDigest, revision: state.revision } : {};
}

export function NativeReview({ host, state, viewId, send, subscribe, onFlush, flushSource, applied, reloading = false }: { host: ArtifactHost; state: WorkspaceRead; viewId: string;
  send(message: unknown): void; subscribe(listener: (event: MessageEvent) => void): () => void; onFlush(handler: (target?: WorkspaceRead, external?: boolean) => Promise<void>): () => void;
  flushSource(): Promise<void>; applied(): void; reloading?: boolean }) {
  const copy = nativeCopy(host.locale), recovery = useNativeInput(host, state, state.fence!.id, viewId), [panel, setPanel] = useState<"comments" | "ai" | null>(null);
  const [point, setPoint] = useState({ x: 20, y: 100 }), [mode, setMode] = useState(false), [inputFailed, setInputFailed] = useState(false), [failed, setFailed] = useState(false), root = useRef<HTMLDivElement>(null), inputSequence = useRef(0);
  const [confirmed, setConfirmed] = useState<{ revision: number; document: NativeComments } | null>(null);
  const comments = confirmed && confirmed.revision >= state.revision ? confirmed.document : state.nativeComments ?? emptyComments;
  const document = useRef(comments);
  const savingComments = useNativeCommentSave({ send, subscribe, recovery, read: () => document.current,
    confirmed: (next, revision) => { setFailed(false); document.current = next; setConfirmed({ revision, document: next }); feed(next); } });
  const saving = savingComments.saving, busy = saving || Boolean(recovery.input.commentSave);
  const input = recovery.input, persistInput = recovery.update, currentInput = recovery.current, flushInput = recovery.flush, carryInput = recovery.carry;
  const updateInput = useCallback(async (next: NativeInput) => {
    const sequence = ++inputSequence.current;
    try { await persistInput(next); if (sequence === inputSequence.current) setInputFailed(false); }
    catch (cause) { if (sequence === inputSequence.current) setInputFailed(true); throw cause; }
  }, [persistInput]);
  const openInstructions = useCallback(() => setPanel("ai"), []);
  useNativeSuggestions({ state, subscribe, send, read: currentInput, update: updateInput, open: openInstructions });
  const feed = useCallback((next: NativeComments) => send({ type: "editor:threads", threads: next.threads.flatMap((thread, index) => thread.status === "open" ? [{ id: thread.id, anchor: thread.anchor, n: index + 1, ...(typeof thread.location.section === "string" ? { section: thread.location.section } : {}) }] : []) }), [send]);
  useLayoutEffect(() => { document.current = comments; feed(comments); }, [comments, feed]);
  useEffect(() => subscribe(event => {
    const message = event.data;
    if (message.type === "editor:mode" && typeof message.on === "boolean") { setMode(message.on); return; }
    if (["editor:ready", "bottega:native:content-ready"].includes(message.type)) { feed(document.current); return; }
    if (message.type !== "editor:compose") return;
    const parsed = nativeComposeSchema.safeParse({ ...nativeCommentTarget(message.detail, state), requestId: message.requestId, anchor: message.anchor, label: message.label,
      ...(typeof message.detail === "string" ? { detail: message.detail } : {}), ...(typeof message.section === "string" ? { section: message.section } : {}), ...(message.area === true ? { area: true } : {}) });
    if (!parsed.success || !Number.isFinite(message.point?.x) || !Number.isFinite(message.point?.y)) return;
    if (currentInput.current.commentSave || currentInput.current.compose?.text.trim()) {
      send({ type: "editor:compose-result", requestId: parsed.data.requestId, opened: false }); return;
    }
    const width = root.current?.clientWidth ?? 360, height = root.current?.clientHeight ?? 500;
    setPoint({ x: Math.max(8, Math.min(width - 312, message.point.x)), y: Math.max(8, Math.min(height - 240, message.point.y)) });
    void updateInput({ ...currentInput.current, compose: parsed.data }).then(() => send({ type: "editor:compose-result", requestId: parsed.data.requestId, opened: true }))
      .catch(() => { setFailed(true); send({ type: "editor:compose-result", requestId: parsed.data.requestId, opened: false }); });
  }), [subscribe, feed, updateInput, currentInput, send, state]);
  useEffect(() => onFlush(async (target, external) => { await savingComments.writes.current.catch(() => {}); if (target) await carryInput(target, external); else await flushInput(); }), [onFlush, flushInput, carryInput, savingComments.writes]);
  const closeCompose = async () => {
    const draft = currentInput.current.compose; if (!draft || currentInput.current.commentSave) return;
    await updateInput({ ...currentInput.current, compose: undefined }); send({ type: "editor:composer-closed", requestId: draft.requestId });
  };
  const add = async () => {
    const draft = currentInput.current.compose; if (!draft?.text.trim()) return;
    await savingComments.save("create", "c_" + draft.requestId);
    send({ type: "editor:composer-closed", requestId: draft.requestId }); setPanel("comments");
  };
  const button = "min-h-[44px] rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50";
  const launcher = "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-foreground/80 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-blue-100 aria-pressed:text-blue-700 dark:aria-pressed:bg-blue-950 dark:aria-pressed:text-blue-200 pointer-coarse:size-11";
  return <div ref={root} className="pointer-events-none absolute inset-0 z-30">
    <div data-native-review-toolbar="" role="group" aria-label={copy.comments + " / " + copy.ai} className="pointer-events-auto absolute right-3 bottom-3 z-10 inline-flex items-center gap-0.5 rounded-xl border bg-background p-1 shadow-sm">
      <button type="button" aria-label={copy.comments} title={copy.comments} aria-pressed={mode} className={launcher} onClick={() => { setPanel(!mode && document.current.threads.length ? "comments" : null); send({ type: "editor:set-mode", on: !mode }); }}><MessageSquare className="size-4" strokeWidth={1.8} /></button>
      <button type="button" aria-label={copy.ai} title={copy.ai} aria-pressed={panel === "ai"} className={launcher} onClick={() => setPanel(value => value === "ai" ? null : "ai")}><Sparkles className="size-4" strokeWidth={1.8} /></button>
    </div>
    {panel && <aside aria-label={panel === "ai" ? copy.ai : copy.comments} className="pointer-events-auto absolute inset-y-2 right-2 flex w-[min(420px,calc(100%_-_16px))] flex-col gap-3 overflow-auto rounded-lg border bg-background p-3 pb-16 shadow-lg">
      <div className="flex items-center justify-between text-sm font-medium"><span>{panel === "ai" ? copy.ai : copy.comments}</span><button type="button" aria-label={copy.close} className="min-h-[44px] min-w-[44px]" onClick={() => setPanel(null)}><X className="mx-auto size-4" /></button></div>
      {panel === "ai" ? <NativeCandidate host={host} state={state} viewId={viewId} input={input} read={() => currentInput.current} update={updateInput} flush={async () => { await savingComments.flush(); await flushSource(); }} applied={async () => { const head = await host.workspace!({ action: "native-head", artifactId: state.fence!.id }) as WorkspaceRead; await carryInput(head); applied(); }} /> : comments.threads.map((thread, index) => <article key={thread.id} data-native-comment={thread.id} className="rounded-md border p-2 text-sm">
        <button type="button" className="min-h-[44px] text-left font-medium" onClick={() => { feed(document.current); send({ type: "editor:reveal", id: thread.id }); }}>{index + 1}. {thread.label}</button>
        {thread.messages.map(message => <p key={message.id} className="whitespace-pre-wrap py-1">{message.text}</p>)}
        <div className="flex flex-wrap gap-1"><button type="button" className={button} disabled={busy} onClick={() => { if (currentInput.current.reply?.text.trim()) { setFailed(true); return; } void updateInput({ ...currentInput.current, reply: { threadId: thread.id, text: "" } }).catch(() => setFailed(true)); }}>{copy.reply}</button>
          <button type="button" className={button} disabled={busy} onClick={() => void savingComments.save(thread.status === "open" ? "resolve" : "reopen", thread.id).catch(() => {})}>{thread.status === "open" ? copy.resolve : copy.reopen}</button>
          <button type="button" className={button} disabled={busy} onClick={() => { const directive = `Apply comment ${thread.id} in comments.json. Do not resolve threads automatically.`; const previous = currentInput.current.instruction; const instruction = previous.includes(directive) ? previous : [previous, directive].filter(Boolean).join("\n\n"); void updateInput({ ...currentInput.current, instruction }).then(() => setPanel("ai")).catch(() => setFailed(true)); }}>{copy.ai}</button></div>
        {input.reply?.threadId === thread.id && <form onSubmit={event => { event.preventDefault(); const reply = currentInput.current.reply; if (!reply?.text.trim()) return;
          void savingComments.save("reply", reply.threadId).catch(() => {});
        }}><textarea aria-label={copy.reply} disabled={busy} value={input.reply.text} maxLength={10000} className="my-2 w-full rounded-md border bg-background p-2" onChange={event => { void updateInput({ ...currentInput.current, reply: { threadId: thread.id, text: event.target.value } }).catch(() => {}); }} /><button type="submit" className={button} disabled={busy || !input.reply.text.trim()}>{copy.reply}</button></form>}
      </article>)}
    </aside>}
    {input.compose && <form data-native-comment-compose="" className="pointer-events-auto absolute flex w-[min(304px,calc(100%_-_16px))] flex-col gap-2 rounded-lg border bg-background p-3 shadow-lg" style={{ left: point.x, top: point.y }} onSubmit={event => { event.preventDefault(); void add().catch(() => setFailed(true)); }}>
      <p className="truncate text-sm font-medium">{input.compose.label}</p><textarea autoFocus aria-label={copy.comments} maxLength={10000} disabled={busy} value={input.compose.text} className="min-h-24 rounded-md border bg-background p-2 text-sm" onChange={event => { const draft = currentInput.current.compose; if (draft) void updateInput({ ...currentInput.current, compose: { ...draft, text: event.target.value } }).catch(() => {}); }} />
      <div className="flex justify-end gap-2"><button type="button" className={button} disabled={busy} onClick={() => void closeCompose().catch(() => setFailed(true))}>{copy.cancel}</button><button type="submit" className={button} disabled={busy || !input.compose.text.trim()}>{copy.save}</button></div>
    </form>}
    {input.commentSave && <div role="status" className="pointer-events-auto absolute right-3 bottom-20 max-w-80 rounded-md border bg-background p-3 text-sm">
      <p>{copy.pending}</p><button type="button" className={button} disabled={saving} onClick={() => void savingComments.save().catch(() => {})}>{copy.check}</button>
    </div>}
    {recovery.failed && recovery.conflict && <NativeInputRecovery blocked={reloading} locale={host.locale} input={input} conflict={recovery.conflict} recover={async next => {
      const external = recovery.conflict!.revision > state.revision;
      if (external) await flushSource();
      await recovery.recover(next); setInputFailed(false); if (external) applied();
    }} />}
    {(failed || inputFailed || savingComments.failed || recovery.failed) && !recovery.conflict && <p role="alert" className="pointer-events-auto absolute left-3 bottom-20 max-w-80 rounded-md border bg-background p-3 text-sm">{copy.failed}</p>}
  </div>;
}
