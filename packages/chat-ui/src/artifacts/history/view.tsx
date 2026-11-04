/**
 * [INPUT]: Original owner workspace ports, fixed current source and on-demand journal History pages.
 * [OUTPUT]: Native-style History, isolated preview, CAS restore and query-first paused recovery using the original request.
 * [POS]: Shared trusted History panel for all Artifact editors; never mounts an editable historical runtime.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { History, X, ArrowLeft, RotateCcw, Flag } from "lucide-react";
import type { WorkspaceCommand, WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { nativeHistoryResultSchema, type HistoryVersion, type HistoryChange, type NativeHistoryResult } from "@ai-chat/cloud-protocol/artifacts/design/history/model";
import type { ArtifactHost, ArtifactLease } from "../context";
import { nativeThemedLease, useNativeTheme } from "../native/appearance";
import { historyCopy } from "./copy";
import "./style.css";
type Content = Extract<NativeHistoryResult, { kind: "content" }>;
function historyBounds(trigger: HTMLButtonElement | null) {
  const anchor = trigger?.closest("[data-native-artifact], [data-testid=chat-side-panel]") as HTMLElement | null;
  const area = anchor?.getBoundingClientRect(), button = trigger?.getBoundingClientRect();
  const width = Math.min(480, (area?.width ?? innerWidth) - 24, innerWidth - 24), top = Math.max(12, Math.min((button?.bottom ?? area?.top ?? 38) + 10, innerHeight - 160));
  const left = Math.max((area?.left ?? 0) + 12, Math.min((button?.right ?? area?.right ?? innerWidth) - width, (area?.right ?? innerWidth) - width - 12));
  return { left, top, width, maxHeight: Math.max(120, Math.min(area?.bottom ?? innerHeight, innerHeight) - top - 12) };
}
export function NativeHistory({ host, state, flush, applied, viewId, request }: { request?: { revision?: number; nonce: string }; viewId?: string; host: ArtifactHost; state: WorkspaceRead; flush(): Promise<void>; applied(): void }) {
  const copy = historyCopy(host.locale), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [current, setCurrent] = useState(state), [entries, setEntries] = useState<HistoryVersion[]>([]), [cursor, setCursor] = useState<number | null>(null);
  const [selected, setSelected] = useState<HistoryVersion | null>(null), [tab, setTab] = useState<"changes" | "preview">("changes"), [changes, setChanges] = useState<HistoryChange[]>([]), [nextChanges, setNextChanges] = useState<number | null>(null);
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const previewArea = useRef<HTMLDivElement>(null), [previewViewport, setPreviewViewport] = useState({ width: 800, height: 500 }), [previewScale, setPreviewScale] = useState(1);
  const [content, setContent] = useState<Content | null>(null), [preview, setPreview] = useState<ArtifactLease | null>(null);
  const nativePreview = preview && "nativeToken" in preview && typeof preview.nativeToken === "string" ? preview as ArtifactLease & {nativeToken:string} : null;
  const onPreviewLoad = useNativeTheme(previewFrame, nativePreview);
  const pending = useRef<Omit<WorkspaceCommand, "chatId" | "incarnationId"> | null>(null), [unknown, setUnknown] = useState(false), [paused, setPaused] = useState(false), active = useRef(false);
  const panel = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), lifetime = useRef(0);
  const [bounds, setBounds] = useState({ left: 12, top: 48, width: 480, maxHeight: 700 });
  useLayoutEffect(() => {
    if (!open) return; const update = () => setBounds(historyBounds(trigger.current)); update();
    const anchor = trigger.current?.closest("[data-native-artifact], [data-testid=chat-side-panel]"), observer = new ResizeObserver(update);
    if (anchor) observer.observe(anchor); window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, [open]);
  const query = async (action: "native-history-list" | "native-history-detail" | "native-history-diff", history: WorkspaceCommand["history"], source = current) =>
    nativeHistoryResultSchema.parse(await host.workspace!({ action, artifactId: source.fence!.id, documentId: source.documentId, viewId, history }));
  const run = async (work: () => Promise<void>) => {
    if (active.current) return; active.current = true; setBusy(true); setError("");
    try { await work(); } catch (cause) { setError(/conflict|changed after/i.test(String(cause)) ? copy.conflict : copy.failed); }
    finally { active.current = false; setBusy(false); }
  };
  const close = useCallback(() => { lifetime.current++; setPreview(null); setOpen(false); }, []);
  useEffect(() => { if (!open) return; const previous = document.activeElement;
    panel.current?.focus(); const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === "Tab") {
        const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],iframe,[tabindex="0"]') ?? [])];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }; document.addEventListener("keydown", keyboard, true);
    return () => { document.removeEventListener("keydown", keyboard, true); if (previous instanceof HTMLElement) previous.focus(); };
  }, [open, close]);
  useEffect(() => { if (!preview) return; return () => host.release(preview); }, [host, preview]);
  useEffect(() => () => { lifetime.current++; }, []);
  useEffect(() => {
    const area = previewArea.current; if (!preview || !area) return;
    const measure = () => setPreviewScale(Math.min(1, area.clientWidth / previewViewport.width, area.clientHeight / previewViewport.height));
    measure(); const observer = new ResizeObserver(measure); observer.observe(area); return () => observer.disconnect();
  }, [preview, previewViewport]);
  const show = (revision?: number) => run(async () => {
    const sequence = ++lifetime.current; setBounds(historyBounds(trigger.current)); setEntries([]); setSelected(null); setOpen(true);
    const source = await host.workspace!({ action: "native-head", artifactId: state.fence!.id }) as WorkspaceRead;
    if (lifetime.current !== sequence) return;
    setCurrent(source); const result = await query("native-history-list", { cursor: 0 }, source);
    if (lifetime.current !== sequence) return;
    if (result.kind !== "list") throw new Error("Invalid History page");
    setEntries(result.entries); setCursor(result.nextCursor); setContent(null); setPreview(null); setTab("changes");
    if (revision) {
      const detail = await query("native-history-detail", { revision }, source);
      const difference = await query("native-history-diff", { revision, compareRevision: source.revision, cursor: 0 }, source);
      if (lifetime.current !== sequence) return;
      if (detail.kind !== "detail" || difference.kind !== "difference") throw new Error("The applied version is unavailable");
      setSelected(detail.version); setChanges(difference.changes); setNextChanges(difference.nextCursor);
    } else setSelected(null);
  });
  useEffect(() => { let mounted = true; queueMicrotask(() => { if (mounted && request) void show(request.revision); }); return () => { mounted = false; }; }, [request?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const select = (entry: HistoryVersion) => run(async () => {
    lifetime.current++; setPreview(null); setContent(null); setSelected(entry); setTab("changes");
    const result = await query("native-history-diff", { revision: entry.revision, compareRevision: current.revision, cursor: 0 });
    if (result.kind !== "difference") throw new Error("Invalid History difference"); setChanges(result.changes); setNextChanges(result.nextCursor);
  });
  const previewVersion = () => run(async () => {
    if (!selected) return; setTab("preview"); if (preview) return;
    const sequence = ++lifetime.current, read = await host.workspace!({ action: "read", artifactId: selected.artifactId }) as WorkspaceRead;
    const lease = await host.workspace!({ action: "preview", artifactId: selected.artifactId, boardId: read.manifest.launchBoard, targetRevision: selected.revision, documentId: current.documentId, viewId, generation: current.generation }) as ArtifactLease;
    if (lifetime.current !== sequence) { host.release(lease); return; }
    setPreviewViewport(read.manifest.boards.find(board => board.id === read.manifest.launchBoard)!.viewport); setPreview("nativeToken" in lease && typeof lease.nativeToken === "string" ? nativeThemedLease(lease as ArtifactLease & {nativeToken:string}, host.locale) : lease);
  });
  const readContent = (change: HistoryChange, offset = 0) => run(async () => {
    const result = await query("native-history-diff", { revision: selected!.revision, compareRevision: current.revision, selection: { path: change.path, ...(change.unit ? { unit: change.unit } : {}) }, offset });
    if (result.kind !== "content") throw new Error("Invalid History text");
    setContent(previous => offset && previous ? { ...result, before: (previous.before ?? "") + (result.before ?? ""), after: (previous.after ?? "") + (result.after ?? "") } : result);
  });
  const restored = async (result: { status?: string; recovery?: { status?: string } }) => {
    if (result.status !== "committed") { const stopped = result.recovery?.status === "paused"; setUnknown(true); setPaused(stopped); setError(stopped ? copy.paused : copy.unknown); return; }
    pending.current = null; setUnknown(false); setPaused(false); close(); applied();
  };
  const recover = (resume = false) => run(async () => {
    const input = pending.current; if (!input || resume && !paused) return;
    await restored(await host.workspace!({ ...input, action: resume ? "resume-edit" : "operation-status", history: undefined }) as { status?: string; recovery?: { status?: string } });
  });
  const restore = (change?: HistoryChange) => run(async () => {
    if (!selected || pending.current) return; await flush();
    const request: Omit<WorkspaceCommand, "chatId" | "incarnationId"> = { action: "native-history-restore", artifactId: current.fence!.id, documentId: current.documentId, expectedRevision: current.revision, readSetDigest: current.readSetDigest,
      generation: current.generation, viewId, requestId: crypto.randomUUID(), history: { revision: selected.revision, compareRevision: current.revision, ...(change ? { items: [{ path: change.path, ...(change.unit ? { unit: change.unit } : {}) }] } : {}) } };
    pending.current = request;
    try { await restored(await host.workspace!(request) as { status?: string }); }
    catch (cause) {
      if (/conflict|changed|REVISION|SOURCE_CHANGED|INVALID|PATH_DENIED/i.test(String(cause))) pending.current = null;
      else setUnknown(true); throw cause;
    }
  });
  const button = "min-h-11 rounded-md px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
  const author = (entry: HistoryVersion) => entry.author.kind === "user" ? entry.operation === "project-import" ? entry.author.name : copy.local : entry.author.kind === "restore" ? copy.restored : entry.author.kind === "agent" ? copy.agent + " · " + entry.author.name : copy.external;
  const day = (time: number) => new Date(time).toDateString() === new Date().toDateString() ? copy.today : new Intl.DateTimeFormat(host.locale, { dateStyle: "medium" }).format(time);
  return <>
    <button ref={trigger} type="button" aria-label={copy.title} title={copy.title} disabled={busy || !host.workspace} className={button + " min-w-11 [-webkit-app-region:no-drag]"} onClick={() => void show()}><History className="size-4" /></button>
    {open && <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={copy.title} data-native-history="" style={bounds} className="native-history fixed z-[90] flex flex-col overflow-hidden rounded-2xl border bg-background text-foreground shadow-xl outline-none">
      <header className="flex min-h-[60px] shrink-0 items-center gap-2 px-5">{selected && <button type="button" aria-label={copy.title} className={button} onClick={() => { lifetime.current++; setSelected(null); setPreview(null); setContent(null); }}><ArrowLeft className="size-4" /></button>}<h2 className="flex-1 text-base font-semibold">{copy.title}</h2><button type="button" aria-label={copy.close} className={button} onClick={close}><X className="size-4" /></button></header>
      <div className="min-h-0 flex-1 overflow-auto px-2.5 pb-4">
      {!selected ? <>{entries.map((entry, index) => <div key={entry.revision}>{(!index || day(entry.createdAt) !== day(entries[index - 1]!.createdAt)) && <p className="px-2.5 py-2.5 text-xs text-muted-foreground">{day(entry.createdAt)}</p>}
        <button type="button" data-history-revision={entry.revision} disabled={busy} className="flex min-h-[60px] w-full gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void select(entry)}>
          <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-muted text-xs">{entry.revision === 1 ? <Flag className="size-3" /> : entry.author.kind === "restore" ? <RotateCcw className="size-3" /> : author(entry).slice(0, 1).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2 text-sm"><strong className="truncate font-medium">{entry.revision === 1 ? copy.start : author(entry)}</strong><time className="text-xs text-muted-foreground">{new Intl.DateTimeFormat(host.locale, { timeStyle: "short" }).format(entry.createdAt)}</time></span><span className="mt-1 block text-xs text-muted-foreground">{entry.revision === 1 ? copy.empty : `v${entry.revision} · ${entry.author.kind === "restore" ? copy.restored : entry.operation === "project-import" ? copy.imported : copy.changes}`}</span>{entry.revision === current.revision && <span className="mt-1 inline-block rounded-full bg-emerald-600/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">{copy.current}</span>}</span></button></div>)}
        {cursor !== null && <button type="button" disabled={busy} className={button + " w-full"} onClick={() => void run(async () => { const result = await query("native-history-list", { cursor }); if (result.kind !== "list") return; setEntries(value => [...value, ...result.entries]); setCursor(result.nextCursor); })}>{copy.more}</button>}<p className="px-2 py-4 text-xs text-muted-foreground">{copy.author}</p></> : <>
        <div className="mb-3 flex items-center justify-between text-sm"><span>{author(selected)} · v{selected.revision}</span><span className="text-xs text-muted-foreground">{day(selected.createdAt)}</span></div>
        <div role="tablist" className="mb-3 flex border-b"><button type="button" role="tab" aria-selected={tab === "changes"} className={button} onClick={() => { setTab("changes"); setPreview(null); }}>{copy.changes}</button><button type="button" role="tab" aria-selected={tab === "preview"} className={button} onClick={() => void previewVersion()}>{copy.preview}</button></div>
        {tab === "preview" ? preview && <div ref={previewArea} data-history-preview="" className="relative h-[55vh] w-full overflow-hidden rounded-md border bg-muted/30"><iframe ref={previewFrame} title={copy.preview} src={preview.url} sandbox={preview.sandbox ?? "allow-scripts"} referrerPolicy="no-referrer" style={nativePreview ? {width:"100%",height:"100%"} : { width: previewViewport.width, height: previewViewport.height, transform: `scale(${previewScale})`, transformOrigin: "top left" }} className="absolute left-0 top-0 border-0" onLoad={event => { const frame = event.currentTarget.contentWindow; if (frame) preview.mount?.(frame); onPreviewLoad(); }} /></div> : <>
          {!changes.length && !busy && <p className="p-3 text-sm text-muted-foreground">{copy.noChanges}</p>}
          {changes.map(change => <article key={change.path + ":" + change.unit} className="mb-2 rounded-lg border p-2"><div className="flex items-center gap-2"><button type="button" className={button + " min-w-0 flex-1 truncate text-left"} disabled={busy} onClick={() => void readContent(change)}><span className="block truncate">{change.path}</span>{change.unit && <span className="block truncate text-xs text-muted-foreground">{change.unit}</span>}</button><span className="text-xs text-muted-foreground">{change.kind}</span><button type="button" className={button} disabled={busy || unknown || !current.enabled || selected.revision === current.revision} onClick={() => void restore(change)}>{copy.bringBack}</button></div></article>)}
          {nextChanges !== null && <button type="button" className={button} disabled={busy} onClick={() => void run(async () => { const result = await query("native-history-diff", { revision: selected.revision, compareRevision: current.revision, cursor: nextChanges }); if (result.kind !== "difference") return; setChanges(value => [...value, ...result.changes]); setNextChanges(result.nextCursor); })}>{copy.more}</button>}
          {content && <div className="my-3 space-y-2 text-xs"><p>{copy.before}</p><pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-red-50 p-2 text-red-950 dark:bg-red-950 dark:text-red-100">{content.before ?? "∅"}</pre><p>{copy.after}</p><pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-green-50 p-2 text-green-950 dark:bg-green-950 dark:text-green-100">{content.after ?? "∅"}</pre>{content.nextOffset !== null && <button className={button} disabled={busy} onClick={() => void readContent({ ...content, family: "file", kind: "changed", before: null, after: null }, content.nextOffset!)}>{copy.textMore}</button>}</div>}
        </>}
        <p className="my-3 text-xs text-muted-foreground">{copy.whole}</p><button type="button" className={button + " w-full border"} disabled={busy || unknown || !current.enabled || selected.revision === current.revision} onClick={() => void restore()}>{copy.restore}</button>
      </>}
      </div>
      {(busy || error || unknown) && <div className="shrink-0 border-t p-3 text-sm" role={error ? "alert" : "status"}>{busy ? copy.busy : error}{unknown && <><button type="button" className={button} disabled={busy} onClick={() => void recover()}>{copy.check}</button>{paused && <button type="button" className={button} disabled={busy} onClick={() => void recover(true)}>{copy.resume}</button>}</>}</div>}
    </div>}
  </>;
}
