/**
 * [INPUT]: A current design-system fence, original host, shared native checkpoint owner and exact mounted-view lifecycle.
 * [OUTPUT]: Supplemental source/compile/update inspector, saved revisions, previews and durable input recovery.
 * [POS]: Supplemental System form; it shares the native writer and never loads a second editor.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { NativeInputPort } from "../native/input";
import { useArtifactHost, useArtifactPresentation } from "../context";
import { ArtifactHeader } from "../presentation/header";
import { ArtifactDirectory } from "../presentation/directory";
import { DesignSystemView } from "./view";
import { committedSystemSelection, emptySystemDraft, type SystemDraft } from "./model";
import { DesignExports } from "./display/exports";
import { SystemPreview } from "./display/preview";
import { workspaceCopy } from "./display/copy";
type Owner = { artifactId: string; state: WorkspaceRead; viewId: string; saved: string };
export function SystemSourceInspector({ fence, onFlush, input: nativeInput, previewViewId }: { fence: ArtifactFence; previewViewId?: string; input(): NativeInputPort | null; onFlush?(handler: () => Promise<void>): () => void }) {
  const host = useArtifactHost()!, presentation = useArtifactPresentation(), copy = workspaceCopy(host.locale);
  const [artifactId, setArtifactId] = useState(fence.id), [epoch, setEpoch] = useState(0);
  const [state, setState] = useState<WorkspaceRead | null>(null), [draft, setDraft] = useState<SystemDraft>(emptySystemDraft);
  const [boardId, setBoardId] = useState(""), [failed, setFailed] = useState(false);
  const owner = useRef<Owner | null>(null), input = useRef(draft), savedInput = useRef(JSON.stringify(draft)), flight = useRef<Promise<unknown>>(Promise.resolve());
  const persist = useCallback((value = input.current) => {
    input.current = value; setDraft(value);
    const target = owner.current;
    const serialized = JSON.stringify(value);
    if (!target) return serialized === savedInput.current ? Promise.resolve() : Promise.reject(new Error("The system input owner is unavailable"));
    const next = flight.current.catch(() => {}).then(async () => {
      if (serialized === target.saved) return;
      if (owner.current !== target) throw new Error("The system input owner changed");
      const port = nativeInput();
      if (!port) throw new Error("The original native input owner is unavailable");
      await port.saveSystem(value, target.state, target.artifactId);
      target.saved = serialized; savedInput.current = serialized;
    });
    flight.current = next; return next;
  }, [nativeInput]);
  useEffect(() => onFlush?.(() => persist()), [onFlush, persist]);
  const beforeClose = presentation?.beforeClose;
  useEffect(() => beforeClose?.(() => persist()), [beforeClose, persist]);
  useEffect(() => {
    const controller = new AbortController(), viewId = crypto.randomUUID(); let active = true, acquired = false;
    const unsubscribe = host.workspaceEvents?.(async event => {
      const target = owner.current;
      if (!active || !target || target.viewId !== viewId) return;
      if (event.type === "changed") {
        setState(value => value ? { ...value, enabled: event.enabled, previewEnabled: event.enabled } : value);
        if (event.enabled && event.generation !== target.state.generation) { await persist(); setEpoch(value => value + 1); }
      }
      if (event.type === "before-disable" && event.scope === viewId && event.generation === target.state.generation) {
        await persist(); await host.workspace!({ action: "ack-disable", artifactId, documentId: target.state.documentId, viewId, nonce: event.nonce, generation: event.generation });
      }
    });
    void (async () => {
      const read = await host.workspace!({ action: "read", artifactId }, controller.signal) as WorkspaceRead;
      if (!active) return;
      if (read.manifest.format !== "bottega-design-system") throw new Error("Choose a design system");
      const selection = read.documentId === fence.design?.documentId ? committedSystemSelection(read.system, input.current) : undefined;
      const restored = read.checkpoint?.system ?? selection ?? emptySystemDraft();
      owner.current = { artifactId, state: read, viewId, saved: JSON.stringify(restored) };
      input.current = restored; savedInput.current = JSON.stringify(restored); setDraft(restored); setState(read); setBoardId(read.manifest.launchBoard); setFailed(false);
      if (!host.remoteReader && read.enabled) {
        await host.workspace!({ action: "acquire-view", artifactId, documentId: read.documentId, generation: read.generation, viewId }, controller.signal);
        acquired = true;
        if (!active) await host.workspace!({ action: "release-view", artifactId, documentId: read.documentId, generation: read.generation, viewId });
      }
    })().catch(() => { if (active) setFailed(true); });
    return () => {
      active = false; controller.abort(); unsubscribe?.();
      const target = owner.current;
      if (target?.viewId === viewId) { owner.current = null; if (acquired) void host.workspace!({ action: "release-view", artifactId, documentId: target.state.documentId, generation: target.state.generation, viewId }).catch(() => {}); }
    };
  }, [host, artifactId, epoch, persist, fence.design?.documentId]);
  const navigate = (id: string) => { void persist().then(() => { setState(null); setArtifactId(id); }).catch(() => setFailed(true)); };
  const navigateBoard = useCallback((id: string) => { if (state?.manifest.boards.some(board => board.id === id)) setBoardId(id); }, [state?.manifest]);
  return <div data-artifact-system="" className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <ArtifactHeader title={state?.title ?? fence.title} status={state ? state.dirty ? copy.dirty : copy.saved : copy.loading}
      titleMenu={state ? content => <ArtifactDirectory state={state} artifactId={artifactId} onVersion={navigate}>{content}</ArtifactDirectory> : undefined} />
    {failed && <div role="alert" className="p-4"><p>{copy.failed}</p><button type="button" className="min-h-[44px] rounded border px-3" onClick={() => { void (owner.current ? persist() : Promise.resolve()).then(() => { setFailed(false); setEpoch(value => value + 1); }).catch(() => setFailed(true)); }}>{copy.retry}</button></div>}
    {state && <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
      <DesignSystemView artifactId={artifactId} state={state} draft={draft} onDraft={persist} onCommitted={navigate} onConflict={async () => { await flight.current; setEpoch(value => value + 1); }} />
      <label>{copy.board}<select aria-label={copy.board} value={boardId} className="ml-2 min-h-[44px] max-w-full rounded border bg-background" onChange={event => setBoardId(event.target.value)}>{state.manifest.boards.map(board => <option key={board.id} value={board.id}>{board.title}</option>)}</select></label>
      <DesignExports artifactId={artifactId} state={state} boardId={boardId} />
      <SystemPreview key={`${artifactId}:${boardId}:${state.generation}`} artifactId={artifactId} boardId={boardId} generation={state.generation} revision={state.revision} viewId={previewViewId} title={state.title} enabled={state.previewEnabled !== false} onNavigate={navigateBoard} />
    </div>}
  </div>;
}
