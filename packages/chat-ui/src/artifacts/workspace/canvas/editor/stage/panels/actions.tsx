/**
 * [INPUT]: Verified model selection, literal fill/stroke values and original journal action callbacks.
 * [OUTPUT]: Genuine object recolor/duplicate/delete controls with explicit destructive confirmation.
 * [POS]: Floating nontext actions; no source deletion or local undo log exists here.
 */
import { Check, Copy, Trash2, X } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@ai-chat/ui/components/ui/dialog";
import { useArtifactHost } from "../../../../../context";
import { canvasCopy } from "../../copy";
import { colorHex } from "./typography";
export function CanvasObjectActions({ editable, busy, fill, stroke, count, duplicateAvailable, dirty, confirm, onConfirm, done, cancel, change, duplicate, remove }: { editable: boolean; busy: boolean; fill?: string; stroke?: string; count: number; duplicateAvailable: boolean; dirty: boolean; confirm: boolean; onConfirm(value: boolean): void; done(): void; cancel(): void; change(key: "fill" | "stroke", value: string): void; duplicate(): void; remove(): Promise<boolean> }) {
  const copy = canvasCopy(useArtifactHost()!.locale), setConfirm = onConfirm;
  return <div data-canvas-object-actions="" data-canvas-chrome="" className="flex max-w-full items-center gap-1 rounded-lg border bg-background p-1 shadow-lg">
    <span className="px-2 text-xs">{copy.multiple} · {count}</span>
    {fill !== undefined && <input type="color" aria-label={copy.background} title={copy.background} value={colorHex(fill)} disabled={!editable || busy} className="size-11 rounded border bg-background p-1" onChange={event => change("fill", event.target.value)} />}
    {stroke !== undefined && <input type="color" aria-label={copy.stroke} title={copy.stroke} value={colorHex(stroke)} disabled={!editable || busy} className="size-11 rounded border bg-background p-1" onChange={event => change("stroke", event.target.value)} />}
    <Button type="button" variant="ghost" size="icon" aria-label={copy.duplicateObject} title={!duplicateAvailable ? copy.objectLimit : copy.duplicateObject} className="min-h-[44px] min-w-[44px]" disabled={!editable || busy || !duplicateAvailable || dirty} onClick={duplicate}><Copy className="size-4" /></Button>
    <Button type="button" variant="ghost" size="icon" aria-label={copy.deleteObject} title={copy.deleteObject} className="min-h-[44px] min-w-[44px]" disabled={!editable || busy || dirty} onClick={() => setConfirm(true)}><Trash2 className="size-4" /></Button>
    {dirty && <><Button type="button" variant="ghost" size="icon" aria-label={copy.cancel} className="min-h-[44px] min-w-[44px]" disabled={busy} onClick={cancel}><X className="size-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label={copy.done} className="min-h-[44px] min-w-[44px]" disabled={!editable || busy} onClick={done}><Check className="size-4" /></Button></>}
    <Dialog open={confirm} onOpenChange={value => { if (!busy) setConfirm(value); }}><DialogContent className="max-w-sm" data-canvas-chrome=""><DialogTitle>{copy.deleteConfirm}</DialogTitle><DialogDescription>{copy.restoreHint}</DialogDescription><div className="flex justify-end gap-2"><Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => setConfirm(false)}>{copy.cancel}</Button><Button type="button" variant="destructive" className="min-h-[44px]" disabled={busy || !editable} onClick={() => void remove().then(value => { if (value) setConfirm(false); })}>{copy.deleteObject}</Button></div></DialogContent></Dialog>
  </div>;
}
