/**
 * [INPUT]: Native-format fences, exact-owner workspace/lease ports, shared presentation lifetime/quota, Button controls and the RefreshCw icon.
 * [OUTPUT]: Source-built Canvas, Slides, System and Dashboard view with authenticated messages, current revision status, stable editor geometry with one host-owned System document toolbar, header-owned external-source reload, exact-frame user-activated browser fullscreen and nonce-bound closing saves, confirmed recovery status clearing, exact own-save identity with external-head reload/closing reconciliation and generation reacquisition.
 * [POS]: Lazy native editor consumer; source writes remain in the main-owned journal.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { artifactFenceSchema } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { useArtifactHost, useArtifactPresentation, type ArtifactLease } from "../context";
import { nativeThemedLease, useNativeTheme } from "./appearance";
import { saveNativeDownload, type NativeDownloadLease } from "./download";
import { Dialog, DialogContent, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { systemCopy } from "../system/copy";
import type { NativeInputPort } from "./input";
import { systemBrowserCopy } from "../system/display/browser/copy";
import { nativeCopy } from "./copy";
import { NativeReview } from "./review";
import { registerHistoryNavigation } from "../history/navigation";
import { NativeHistory } from "../history/view";
import { ArtifactHeader } from "../presentation/header";
import { requestArtifactFrame } from "../quota";
import { ArtifactDirectory } from "../presentation/directory";
import { workspaceCopy } from "../system/display/copy";
const SystemBrowser = lazy(() => import("../system/display/browser/view").then(module => ({default:module.SystemBrowser})));
const SystemSourceInspector = lazy(() => import("../system/workspace").then(module => ({ default: module.SystemSourceInspector })));
type NativeLease = NativeDownloadLease;
export function NativeArtifactWorkspace({ fence }: { fence: ArtifactFence }) {
  const host = useArtifactHost()!, presentation = useArtifactPresentation(), copy = workspaceCopy(host.locale), nativeText = nativeCopy(host.locale);
  const frame = useRef<HTMLIFrameElement>(null), flush = useRef<(nonce?: string) => Promise<void>>(async () => {});
  const sender = useRef<(message: unknown) => void>(() => {}), reviewFlush = useRef<(target?: WorkspaceRead, external?: boolean) => Promise<void>>(async () => {}), sourceFlush = useRef<() => Promise<void>>(async () => {});
  const listeners = useRef(new Set<(event: MessageEvent) => void>()), newest = useRef(0);
  const send = useCallback((message: unknown) => sender.current(message), []);
  const subscribe = useCallback((listener: (event: MessageEvent) => void) => { listeners.current.add(listener); return () => { listeners.current.delete(listener); }; }, []);
  const onFlush = useCallback((handler: (target?: WorkspaceRead, external?: boolean) => Promise<void>) => { reviewFlush.current = handler; return () => { if (reviewFlush.current === handler) reviewFlush.current = async () => {}; }; }, []);
  const [historyRequest, setHistoryRequest] = useState<{ revision?: number; nonce: string }>();
  const historyDocumentId = fence.design!.documentId;
  useEffect(() => registerHistoryNavigation(host.scope, historyDocumentId, setHistoryRequest), [host.scope, historyDocumentId]);
  const [systemBrowser,setSystemBrowser]=useState(false), nativeInput = useRef<NativeInputPort | null>(null);
  const getInput = useCallback(() => nativeInput.current, []);
  const attachInput = useCallback((port: NativeInputPort | null) => {nativeInput.current=port},[]);
  const [sources, setSources] = useState(false), inspectorFlush = useRef<() => Promise<void>>(async () => {});
  const inspectFlush = useCallback((handler: () => Promise<void>) => { inspectorFlush.current = handler; return () => { if (inspectorFlush.current === handler) inspectorFlush.current = async () => {}; }; }, []);
  const [externalRevision, setExternalRevision] = useState(0), [reloading, setReloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false), [flushFailed, setFlushFailed] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null), [reload, setReload] = useState(0);
  const [state, setState] = useState<WorkspaceRead | null>(null);
  const [lease, setLease] = useState<NativeLease | null>(null), [saved, setSaved] = useState(fence), [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const onThemeLoad = useNativeTheme(frame, lease);
  const beforeClose = presentation?.beforeClose;
  useEffect(() => beforeClose?.(() => flush.current()), [beforeClose]);
  useEffect(() => {
    let disposed = false, owned: NativeLease | null = null, acquired = false, generation = "";
    const viewId = crypto.randomUUID();
    let nativeFullscreen = false, fullscreenFrame: HTMLIFrameElement | null = null;
    let observedSave = 0, observedExternal = 0;
    let loaded = false, headRead: Promise<void> = Promise.resolve(), ownHead: WorkspaceRead | undefined;
    const queued = new Map<string, unknown>();
    const controller = new AbortController(), pending = new Map<string, { resolve(): void; reject(cause: Error): void; timer: ReturnType<typeof setTimeout> }>();
    const documentId = fence.design!.documentId;
    const release = () => { if (owned) { host.release(owned); owned = null; } setLease(null); };
    const send = (value: unknown) => { if (!loaded && value && typeof value === "object" && "type" in value) { queued.set(String(value.type), value); return; } if (!owned || !frame.current?.contentWindow) throw new Error("Native editor is unavailable"); frame.current.contentWindow.postMessage(typeof value === "object" && value ? { ...value, token: owned.nativeToken } : value, owned.origin === "null" ? "*" : owned.origin); };
    sender.current = value => {
      if (value && typeof value === "object" && "type" in value && value.type === "bottega:native:loaded") { loaded = true; for (const message of queued.values()) send(message); queued.clear(); send({ type: "bottega:native:get-content-ready" }); return; }
      send(value);
    };
    const doFlush = async (nonce?: string) => {
      if (!owned || !acquired) return;
      const requestId = crypto.randomUUID();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("Native save did not finish")); }, 10_000);
        pending.set(requestId, { resolve, reject, timer }); send({ type: "editor:flush", requestId, ...(nonce ? { nonce } : {}) });
      });
    };
    sourceFlush.current = doFlush;
    flush.current = async nonce => {
      if (!owned || !acquired) return;
      await reviewFlush.current(); await doFlush(nonce);
      if (observedExternal > newest.current) {
        const read = await host.workspace!({ action: "native-head", artifactId: fence.id }) as WorkspaceRead;
        if (read.documentId !== documentId || read.generation !== generation || read.revision < observedExternal) throw new Error("Current input owner changed before closing");
        await reviewFlush.current(read, true);
      } else if (ownHead) await reviewFlush.current(ownHead);
    };
    const onMessage = (event: MessageEvent) => {
      if (!event.isTrusted || disposed || !owned || event.source !== frame.current?.contentWindow || event.origin !== owned.origin) return;
      const message = event.data;
      if (!message || typeof message !== "object") return;
      if (typeof message.type === "string" && message.type.startsWith("bottega:native:") && message.token !== owned.nativeToken) return;
      if (message.type === "bottega:native:presentation-fullscreen" && typeof message.requestId === "string" && /^[a-f0-9-]{36}$/.test(message.requestId)) {
        const element = frame.current;
        const reply = (fullscreen: boolean) => { if (!disposed && owned) send({ type: "bottega:native:presentation-fullscreen-result", requestId: message.requestId, fullscreen }); };
        if (!element || !navigator.userActivation?.isActive || !document.fullscreenEnabled) { reply(false); return; }
        void element.requestFullscreen().then(() => { nativeFullscreen = document.fullscreenElement === element; if (nativeFullscreen) fullscreenFrame = element; reply(nativeFullscreen); }, () => reply(false)); return;
      }
      if (message.type === "bottega:native:system-browser") { setSystemBrowser(true); return; }
      if (message.type === "bottega:native:history") { setHistoryRequest({ nonce: crypto.randomUUID() }); return; }
      if (message.type === "bottega:native:presentation-exit") { if (document.fullscreenElement === frame.current) void document.exitFullscreen().catch(() => {}); return; }
      if (message.type === "bottega:native:download") { void saveNativeDownload(host, owned, event).then(() => setDownloadFailed(false)).catch(() => setDownloadFailed(true)); return; }
      for (const listener of listeners.current) listener(event);
      if (message.type === "bottega:native:error" && message.token === owned.nativeToken) { setFailed(true); return; }
      if (message.type === "bottega:native:content-ready" && message.token === owned.nativeToken) setReady(true);

      if (message.type === "editor:flushed" && typeof message.requestId === "string") {
        const work = pending.get(message.requestId); if (!work) return;
        pending.delete(message.requestId); clearTimeout(work.timer);
        if (message.saved === true) void headRead.then(work.resolve, cause => work.reject(cause instanceof Error ? cause : new Error("Native head was not confirmed"))); else work.reject(new Error("Native editor has unsaved changes"));
      }
      if (["bottega:native:saved", "bottega:native:adopted-chat"].includes(message.type) && message.token === owned.nativeToken) {
        const result = artifactFenceSchema.safeParse(message.result?.fence);
        if (result.success && result.data.design?.documentId === documentId && result.data.design.contentFormat === fence.design?.contentFormat) {
          const next = result.data, revision = next.design!.revision; host.remember?.(next);
          if (revision <= observedSave) return; observedSave = revision;
          headRead = headRead.catch(() => {}).then(async () => {
            if (disposed || !owned || revision <= newest.current) return;
            const read = await host.workspace!({ action: "read", artifactId: next.id }, controller.signal) as WorkspaceRead;
            if (disposed || !owned || read.documentId !== documentId || read.revision < revision || read.revision < newest.current || !read.fence) return;
            if (read.revision > revision) { observedExternal = Math.max(observedExternal, read.revision); setExternalRevision(value => Math.max(value, read.revision)); setSaved(next); return; }
            if (read.snapshotRef !== next.design!.snapshotRef || read.fence.id !== next.id) throw new Error("Native save identity changed");
            newest.current = read.revision; ownHead = read; await reviewFlush.current(read).catch(() => {});
            if (disposed || !owned || read.revision < newest.current) return; setSaved(read.fence); setState(read); host.remember?.(read.fence);
          }).catch(cause => { if (!disposed) setFailed(true); throw cause; });
          void headRead.catch(() => {});
        }
      }
    };
    const onFullscreen = () => { if (nativeFullscreen && document.fullscreenElement !== fullscreenFrame) { nativeFullscreen = false; if (!disposed && owned) send({ type: "bottega:native:presentation-ended" }); } };
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("message", onMessage);
    const unsubscribe = host.workspaceEvents?.(event => { void (async () => {
      if (disposed) return;
      if (event.type === "source-pending") {
        if (event.scope === viewId && event.generation === generation && event.documentId === documentId)
          setState(value => value ? { ...value, pendingChatEdit: event.pending } : value);
        return;
      }
      if (event.type === "source-changed") {
        if (event.scope === viewId && event.generation === generation && event.documentId === documentId) setState(value => value ? { ...value, pendingChatEdit: undefined } : value);
        if (event.scope === viewId && event.generation === generation && event.documentId === documentId) { observedExternal = Math.max(observedExternal, event.revision); setExternalRevision(value => Math.max(value, event.revision)); if (event.revision > newest.current) send({ type: "bottega:native:adopt-chat", revision: event.revision, snapshotRef: event.snapshotRef }); }
        return;
      }
      if (event.type === "changed") {
        if (event.enabled) setReload(value => value + 1);
        else { setState(value => value ? { ...value, enabled: false, generation: event.generation } : value); release(); }
        return;
      }
      if (event.type !== "before-disable" || event.scope !== viewId) return;
      await flush.current(event.nonce);
      await host.workspace!({ action: "ack-disable", artifactId: fence.id, documentId, generation, viewId, nonce: event.nonce }); setFlushFailed(false); release();
    })().catch(() => setFlushFailed(true)); });
    const quota = requestArtifactFrame(() => { void (async () => {
      try {
        const read = await host.workspace!({ action: "native-head", artifactId: fence.id }, controller.signal) as WorkspaceRead;
        if (disposed) return; setExternalRevision(0); setReady(false); setFailed(false); setFlushFailed(false); setViewId(null); generation = read.generation; newest.current = read.revision; setState(read); if (read.fence) { setSaved(read.fence); host.remember?.(read.fence); }
        await host.workspace!({ action: "acquire-view", artifactId: fence.id, documentId, viewId, generation }, controller.signal); acquired = true; setViewId(viewId);
        const result = await host.workspace!({ action: "native-editor", artifactId: read.fence?.id ?? fence.id, documentId, viewId, generation, expectedRevision: read.revision, readSetDigest: read.readSetDigest }, controller.signal) as ArtifactLease & { nativeToken: string };
        if (disposed) { host.release(result); return; }
        owned = nativeThemedLease({ ...result, artifactId: read.fence?.id ?? fence.id }, host.locale); setLease(owned);
      } catch { if (!disposed) { setFailed(true); release(); } }
    })(); }, () => { if (!disposed) release(); }, 3);
    return () => {
      disposed = true; controller.abort(); quota(); unsubscribe?.(); window.removeEventListener("message", onMessage); document.removeEventListener("fullscreenchange", onFullscreen);
      if (nativeFullscreen && document.fullscreenElement === fullscreenFrame) void document.exitFullscreen().catch(() => {});
      for (const work of pending.values()) { clearTimeout(work.timer); work.reject(new Error("Native editor closed")); }
      pending.clear(); release(); flush.current = async () => {}; sourceFlush.current = async () => {}; sender.current = () => {};
      if (acquired) void host.workspace!({ action: "release-view", artifactId: fence.id, documentId, viewId, generation }).catch(() => {});
    };
    // Keep the mounted editor and its original callbacks until its exact owner or explicit reload changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host.scope, fence.id, reload]);
  const sourceUpdated = Boolean(state?.enabled && externalRevision > state.revision);
  return <div data-native-artifact="" data-native-view={viewId ?? undefined} className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <ArtifactHeader title={saved.title} status={state && !state.enabled ? copy.off : failed ? copy.failed : sourceUpdated ? nativeText.updated : ready ? copy.saved : copy.loading} titleMenu={state ? content => <ArtifactDirectory state={state} artifactId={saved.id} onVersion={id => { void (async () => {
      await flush.current(); const read = await host.workspace!({ action: "read", artifactId: id }) as WorkspaceRead;
      if (read.fence) await host.open(read.fence, host.followUp);
    })().catch(() => setFailed(true)); }}>{content}</ArtifactDirectory> : undefined}>
    {state?.manifest.system && <Button variant="ghost" size="sm" onClick={() => { void sourceFlush.current().then(() => setSources(true)).catch(() => setFlushFailed(true)); }}>{systemCopy(host.locale).sources}</Button>}
    {state && ["canvas-dc/v3","slides/v4"].includes(state.manifest.contentFormat??"") && <Button type="button" variant="ghost" size="sm" onClick={()=>setSystemBrowser(true)}>{systemBrowserCopy(host.locale).theme}</Button>}
    {state && <NativeHistory request={historyRequest} host={host} state={state} viewId={viewId ?? undefined} flush={() => flush.current()} applied={() => { setFlushFailed(false); setReload(value => value + 1); }} />}
    {state?.manifest.system && state.enabled && state.editable && <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11 shrink-0" disabled={!ready} aria-label={nativeText.export} title={nativeText.export} onClick={() => send({ type: "bottega:native:project-export" })}><Download className="size-4" /></Button>}
    {sourceUpdated && state && <Button type="button" variant="ghost" size="sm" onClick={() => setHistoryRequest({ revision: state.revision, nonce: crypto.randomUUID() })}>{nativeText.compare}</Button>}
    {sourceUpdated && state && <Button type="button" variant="ghost" size="icon" disabled={reloading} aria-label={nativeText.reload} title={nativeText.updated + "\n" + nativeText.reload}
      className="min-h-11 min-w-11 shrink-0 cursor-pointer text-blue-600 [-webkit-app-region:no-drag] dark:text-blue-400" onClick={() => { void (async () => {
        setReloading(true);
        try {
          await sourceFlush.current();
          const read = await host.workspace!({ action: "native-head", artifactId: fence.id }) as WorkspaceRead;
          if (!read.enabled || read.dirty || read.generation !== state.generation || read.revision < externalRevision) throw new Error("Current source is unavailable");
          await reviewFlush.current(read, true); setFlushFailed(false); setReload(value => value + 1);
        } catch { setFlushFailed(true); }
        finally { setReloading(false); }
      })(); }}><RefreshCw className="size-4" /></Button>}
    </ArtifactHeader>
    {state?.manifest.system && <Dialog open={sources} onOpenChange={open => { if (open) setSources(true); else void inspectorFlush.current().then(() => setSources(false)).catch(() => setFlushFailed(true)); }}>
      <DialogContent className="flex h-[85dvh] max-w-[min(1000px,95vw)] flex-col overflow-hidden">
        <DialogTitle>{systemCopy(host.locale).sources}</DialogTitle>
        <Suspense fallback={<p>{copy.loading}</p>}><SystemSourceInspector fence={saved} previewViewId={viewId ?? undefined} input={getInput} onFlush={inspectFlush} /></Suspense>
      </DialogContent>
    </Dialog>}
    <div className="relative flex min-h-0 flex-1">
    {(downloadFailed || flushFailed) && <p role="alert" className="pointer-events-none absolute right-3 bottom-20 z-40 rounded-md border bg-background p-3 text-sm">{copy.failed}</p>}
    {state && !state.enabled ? <p role="status" className="p-4 text-sm">{copy.off}</p> : failed ? <p role="alert" className="p-4 text-sm">{copy.failed}</p> : lease && <iframe key={lease.id} ref={frame} title={saved.title} src={lease.url} sandbox={lease.sandbox} allow="fullscreen" referrerPolicy="no-referrer" className="min-h-0 w-full flex-1 border-0" onLoad={() => { if (frame.current?.contentWindow) lease.mount?.(frame.current.contentWindow); onThemeLoad(); send({ type: "bottega:native:loaded" }); }} />}
    {lease && state && viewId && !failed && <NativeReview sourceChecked={read=>{
      if (!state || read.documentId!==state.documentId || read.generation!==state.generation || read.revision<state.revision) throw new Error("The original source query changed ownership");
      setState(value=>value?{...value,pendingChatEdit:undefined}:value);setExternalRevision(value=>Math.max(value,read.revision));
      sender.current({type:"bottega:native:adopt-chat",revision:read.revision,snapshotRef:read.snapshotRef});
    }} onInput={attachInput} key={viewId} reloading={reloading} host={host} state={state} viewId={viewId} send={send} subscribe={subscribe} onFlush={onFlush}
      openHistory={revision => setHistoryRequest({ revision, nonce: crypto.randomUUID() })} flushSource={() => sourceFlush.current()} applied={() => { setFlushFailed(false); setReload(value => value + 1); }} />}
    </div>
    {state && systemBrowser && <Suspense fallback={null}><SystemBrowser host={host} state={state} viewId={viewId??undefined} open={systemBrowser} onOpenChange={setSystemBrowser} input={()=>nativeInput.current} flushSource={()=>sourceFlush.current()} onBound={async()=>{
      const read=await host.workspace!({action:"native-head",artifactId:saved.id}) as WorkspaceRead, port=nativeInput.current;
      if(!port)throw new Error("The original native input closed");await port.update({...port.current.current,pending:undefined});await reviewFlush.current(read);setSystemBrowser(false);setReload(value=>value+1);
    }}/></Suspense>}
  </div>;
}
