/**
 * [INPUT]: Host-authorized workbook inspection, import receipts and explicit user choices.
 * [OUTPUT]: Accessible sheet selection and row-merge confirmation with retryable failure.
 * [POS]: Shared XLSX card interaction; no file parsing or Base mutation occurs in the renderer.
 */
import { useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@ai-chat/ui/components/ui/dialog";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { useArtifactHost, type ArtifactWorkbook } from "./context";
import { artifactCopy } from "./copy";
export function ArtifactImport({ fence }: { fence: ArtifactFence }) {
  const host = useArtifactHost(), copy = artifactCopy(host?.locale ?? "en");
  const [workbook, setWorkbook] = useState<ArtifactWorkbook | null>(null), [sheet, setSheet] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(false), [done, setDone] = useState(false);
  const perform = async (name: string, confirmed: boolean) => {
    if (!host?.importBase) return;
    setBusy(true); setError(false);
    try { await host.importBase(fence, name, confirmed); setWorkbook(null); const remaining = await host.workbook?.(fence); setDone(Boolean(remaining?.sheets.every(value => value.imported))); }
    catch { setError(true); } finally { setBusy(false); }
  };
  const inspect = async () => {
    if (!host?.workbook || busy) return;
    setBusy(true); setError(false);
    try {
      const result = await host.workbook(fence), first = result.sheets.find(sheet => !sheet.imported);
      if (!first) { setDone(true); return; }
      if (result.sheets.length === 1 && !result.exists && first.hasId) await perform(first.name, false);
      else { setWorkbook(result); setSheet(first.name); }
    } catch { setError(true); } finally { setBusy(false); }
  };
  if (!host?.importBase) return null;
  const selected = workbook?.sheets.find(value => value.name === sheet);
  return <>
    <Button variant="ghost" size="sm" type="button" className="relative touch-target-44" disabled={busy || done} onClick={() => void inspect()}>{done ? copy.imported : copy.import}</Button>
    {error && !workbook && <p role="alert">{copy.failed}</p>}
    <Dialog open={workbook !== null} onOpenChange={open => { if (!open && !busy) setWorkbook(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{copy.import}</DialogTitle><DialogDescription>{workbook?.exists ? copy.merge : copy.sheet}</DialogDescription></DialogHeader>
        <label className="flex flex-col gap-1 text-sm">{copy.sheet}<select className="h-10 w-full rounded-md border border-input bg-input/20 px-2 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50" value={sheet} onChange={event => setSheet(event.target.value)} disabled={busy}>
          {workbook?.sheets.map(value => <option key={value.name} value={value.name} disabled={value.imported}>{value.name}{value.imported ? ` (${copy.imported})` : ""}</option>)}
        </select></label>
        {selected && !selected.hasId && <p className="text-sm text-muted-foreground">{copy.noId}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{copy.failed}</p>}
        <DialogFooter className="mt-2 flex-row justify-end gap-3">
          <Button variant="outline" size="pill" type="button" disabled={busy} onClick={() => setWorkbook(null)}>{copy.cancel}</Button>
          <Button size="pill" type="button" disabled={busy || !selected || selected.imported} onClick={() => void perform(sheet, true)}>{copy.confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
