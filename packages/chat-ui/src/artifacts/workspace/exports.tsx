/**
 * [INPUT]: Fixed revision, explicit document/page/board scope and host export/save ports; only desktop commands carry the local save option.
 * [OUTPUT]: Explicit PNG/HTML/fixed/flow PDF export with localized paper labels, retained errors and cancelled-save handling.
 * [POS]: Workspace export controls; exports cannot alter source or history.
 */
import { useState } from "react";
import { isSaveCancelled, saveBlob } from "@ai-chat/ui/lib/save-blob";
import type { WorkspaceCommand, WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { useArtifactHost } from "../context";
import { canvasCopy } from "./canvas/editor/copy";
export function DesignExports({ artifactId, state, boardId, pageId }: { artifactId: string; state: WorkspaceRead; boardId: string; pageId?: string }) {
  const host = useArtifactHost()!, copy = canvasCopy(host.locale), [scope, setScope] = useState<"document" | "page" | "board">("board"), [format, setFormat] = useState<WorkspaceCommand["format"]>("png"), [paper, setPaper] = useState<"a4" | "letter">("a4"), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const run = async () => {
    setBusy(true); setFailed(false);
    try {
      const result = await host.workspace!({ action: "export", artifactId, requestId: crypto.randomUUID(), generation: state.generation, boardId, pageId, scope, format, paper, ...(host.desktop ? { save: true } : {}) }) as { data?: string; blob?: Blob; mime: string; filename: string; canceled?: boolean };
      if (!result.canceled && result.blob) await saveBlob(result.blob, result.filename);
      else if (!result.canceled && result.data) { const binary = atob(result.data), bytes = Uint8Array.from(binary, char => char.charCodeAt(0)); await saveBlob(new Blob([bytes], { type: result.mime }), result.filename); }
    } catch (error) { if (!isSaveCancelled(error)) setFailed(true); }
    finally { setBusy(false); }
  };
  return <div className="flex flex-wrap items-center gap-2"><label className="w-full text-sm">{copy.scope}<select aria-label={copy.scope} value={scope} className="ml-2 min-h-[44px] rounded border bg-background" onChange={event => setScope(event.target.value as typeof scope)}><option value="board">{copy.artboard}</option><option value="page" disabled={!pageId}>{copy.page}</option><option value="document">{state.title}</option></select></label><label>{copy.export}<select aria-label={copy.export} value={format} className="ml-2 min-h-[44px] rounded border bg-background" onChange={event => setFormat(event.target.value as WorkspaceCommand["format"])}>
    <option value="png">{copy.png}</option><option value="html">{copy.html}</option><option value="pdf-fixed">{copy.fixed}</option><option value="pdf-flow">{copy.flow}</option></select></label>
    {format === "pdf-flow" && <select aria-label={copy.flow} value={paper} className="min-h-[44px] rounded border bg-background" onChange={event => setPaper(event.target.value as "a4" | "letter")}><option value="a4">{copy.paperA4}</option><option value="letter">{copy.paperLetter}</option></select>}
    <button type="button" className="relative min-h-[44px] touch-target-44 rounded border px-3" disabled={busy || !state.enabled} onClick={() => void run()}>{copy.export}</button>{failed && <p role="alert">{copy.failed}</p>}
  </div>;
}
