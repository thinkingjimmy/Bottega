/**
 * [INPUT]: Original Chat-bound import/workspace ports, one selected File or immutable ZIP fence and explicit activation.
 * [OUTPUT]: Bounded project selection, same-request retry, truthful pending state and opening the new canonical work.
 * [POS]: Shared desktop/Web import UI; binary transfer and journal admission stay with the existing hosts.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { artifactFenceSchema, type ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { ArtifactHost } from "../context";
import { projectImportCopy } from "./copy";
export function ProjectImportDialog({ host, fence, close }: { host: ArtifactHost; fence?: ArtifactFence; close(): void }) {
  const copy = projectImportCopy(host.locale), [file, setFile] = useState<File>(), [busy, setBusy] = useState(false), [error, setError] = useState(false), [pending, setPending] = useState(false);
  const lifetime = useRef<AbortController | null>(null), request = useRef(crypto.randomUUID()), active = useRef(false), picker = useRef<HTMLInputElement>(null);
  useEffect(() => { const owner = new AbortController(); lifetime.current = owner; return () => { owner.abort(); if (lifetime.current === owner) lifetime.current = null; }; }, []);
  const nativePicker = host.desktop && !host.remoteReader && !fence;
  const perform = async () => {
    if (!host.importProject || active.current) return;
    const signal = lifetime.current?.signal; if (!signal || signal.aborted) return;
    active.current = true; setBusy(true); setError(false);
    try {
      signal.throwIfAborted();
      if (file && (!file.size || file.size > 50_000_000 || !/\.zip$/i.test(file.name))) throw new Error("Invalid project ZIP selection");
      const result = await host.importProject({ requestId: request.current, file, fence }, signal) as { canceled?: boolean; status?: string; artifactId?: string; artifactRef?: { artifactId: string } };
      signal.throwIfAborted();
      if (result.canceled) return;
      if (result.status !== "committed") { setPending(true); return; }
      const artifactId = result.artifactRef?.artifactId ?? result.artifactId;
      if (!artifactId || !host.workspace) throw new Error("The imported project is unavailable");
      const read = await host.workspace({ action: "read", artifactId }, signal) as WorkspaceRead, imported = artifactFenceSchema.parse(read.fence);
      signal.throwIfAborted(); await host.open(imported, host.followUp); close();
    } catch { if (!signal.aborted) setError(true); }
    finally { active.current = false; if (!signal.aborted) setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}><DialogContent aria-busy={busy} className="max-w-[min(480px,calc(100vw-24px))]">
    <DialogHeader><DialogTitle>{copy.title}</DialogTitle><DialogDescription>{copy.description}</DialogDescription></DialogHeader>
    {!nativePicker && !fence && <><input ref={picker} hidden style={{display:"none"}} type="file" accept=".zip,application/zip" aria-label={copy.choose} disabled={busy || pending} onChange={event => { const selected = event.target.files?.[0]; if (selected) { request.current = crypto.randomUUID(); setFile(selected); setError(false); } }} /><Button type="button" variant="outline" disabled={busy || pending} onClick={()=>picker.current?.click()}>{copy.choose}</Button><p className="text-xs text-muted-foreground">{copy.limit}</p></>}
    {(fence || file) && <p className="truncate text-sm">{fence?.title ?? file?.name}</p>}
    {busy && <div role="status" className="space-y-2 text-sm"><p>{copy.busy}</p><progress aria-label={copy.busy} className="w-full" /></div>}
    {pending && <p role="status" className="text-sm">{copy.pending}</p>}{error && <p role="alert" className="text-sm text-destructive">{copy.failed}</p>}
    <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>{copy.cancel}</Button><Button type="button" disabled={busy || !nativePicker && !fence && !file} onClick={() => void perform()}>{pending ? copy.retry : nativePicker ? copy.choose : copy.import}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
