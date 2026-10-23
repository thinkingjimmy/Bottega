/**
 * [INPUT]: Single model selection, projected bounds, physical stage size, measured chrome-safe rectangle and original journal action callbacks.
 * [OUTPUT]: Duplicate/delete controls for targets visible in the physical stage, with chrome-safe position clamping and explicit destructive confirmation.
 * [POS]: Floating nontext actions; no source deletion or local undo log exists here.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@ai-chat/ui/components/ui/dialog";
import { useArtifactHost } from "../../../../../context";
import { canvasCopy } from "../../copy";
import type { CanvasBox } from "../../motion/camera";
export function CanvasObjectActions({ box, viewport, safeArea, editable, busy, duplicateAvailable, dirty, confirm, onConfirm, duplicate, remove }: { box: CanvasBox; viewport: Pick<CanvasBox, "width" | "height">; safeArea: CanvasBox; editable: boolean; busy: boolean; duplicateAvailable: boolean; dirty: boolean; confirm: boolean; onConfirm(value: boolean): void; duplicate(): void; remove(): Promise<boolean> }) {
  const copy = canvasCopy(useArtifactHost()!.locale), setConfirm = onConfirm, surface = useRef<HTMLDivElement>(null), [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = surface.current; if (!node) return;
    const measure = () => { const { width, height } = node.getBoundingClientRect(); setSize(current => current.width === width && current.height === height ? current : { width, height }); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(node); return () => observer.disconnect();
  }, []);
  const right = safeArea.x + safeArea.width, bottom = safeArea.y + safeArea.height;
  const above = box.y - size.height - 8, top = above >= safeArea.y + 8 ? above : box.y + 8;
  const visible = viewport.width > 0 && viewport.height > 0 && box.x + box.width > 0 && box.y + box.height > 0 && box.x < viewport.width && box.y < viewport.height;
  return <div ref={surface} data-canvas-object-actions="" data-canvas-chrome="" aria-hidden={!visible || undefined} className="absolute z-40 flex w-max flex-wrap items-center gap-1 overflow-auto rounded-lg border bg-background p-1 shadow-lg"
    style={{ visibility: visible ? undefined : "hidden", left: Math.max(safeArea.x + 8, Math.min(box.x + box.width - size.width, right - size.width - 8)), top: Math.max(safeArea.y + 8, Math.min(top, bottom - size.height - 8)), maxWidth: Math.max(0, safeArea.width - 16), maxHeight: Math.max(0, safeArea.height - 16) }}>
    <Button type="button" variant="ghost" size="icon" aria-label={copy.duplicateObject} title={!duplicateAvailable ? copy.objectLimit : copy.duplicateObject} className="min-h-[44px] min-w-[44px]" disabled={!editable || busy || !duplicateAvailable || dirty} onClick={duplicate}><Copy className="size-4" /></Button>
    <Button type="button" variant="ghost" size="icon" aria-label={copy.deleteObject} title={copy.deleteObject} className="min-h-[44px] min-w-[44px]" disabled={!editable || busy || dirty} onClick={() => setConfirm(true)}><Trash2 className="size-4" /></Button>
    <Dialog open={confirm} onOpenChange={value => { if (!busy) setConfirm(value); }}><DialogContent className="max-w-sm" data-canvas-chrome=""><DialogTitle>{copy.deleteConfirm}</DialogTitle><DialogDescription>{copy.restoreHint}</DialogDescription><div className="flex justify-end gap-2"><Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => setConfirm(false)}>{copy.cancel}</Button><Button type="button" variant="destructive" className="min-h-[44px]" disabled={busy || !editable} onClick={() => void remove().then(value => { if (value) setConfirm(false); })}>{copy.deleteObject}</Button></div></DialogContent></Dialog>
  </div>;
}
