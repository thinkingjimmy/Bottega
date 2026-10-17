/**
 * [INPUT]: Actual camera scale, fit capabilities and viewport-only callbacks.
 * [OUTPUT]: Bounded percent input, scale presets, fit page/board/selection and 100% controls.
 * [POS]: Right Canvas tool group; zoom never calls a source mutation port.
 */
import { useState } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@ai-chat/ui/components/ui/popover";
import { useArtifactHost } from "../../../context";
import { canvasCopy } from "./copy";
import { MAX_ZOOM, MIN_ZOOM, clampZoom } from "./camera";
export function CanvasZoom({ zoom, onZoom, onFitPage, onFitBoard, onFitSelection, selectionAvailable = false }: { zoom: number; onZoom(zoom: number): void; onFitPage(): void; onFitBoard(): void; onFitSelection(): void; selectionAvailable?: boolean }) {
  const copy = canvasCopy(useArtifactHost()!.locale), [open, setOpen] = useState(false), [percent, setPercent] = useState("100");
  const choose = (value: number) => { onZoom(clampZoom(value)); setOpen(false); };
  const valid = Number.isFinite(Number(percent)) && Number(percent) >= MIN_ZOOM * 100 && Number(percent) <= MAX_ZOOM * 100;
  const fit = (callback: () => void) => { callback(); setOpen(false); };
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (value) setPercent(String(Math.round(zoom * 100))); }}><PopoverTrigger asChild><Button variant="ghost" type="button" className="min-h-[44px] min-w-[76px] px-2 tabular-nums" aria-label={`${copy.zoom}: ${Math.round(zoom * 100)}%`} data-canvas-zoom=""><span>{Math.round(zoom * 100)}%</span><ChevronDown className="size-3" /></Button></PopoverTrigger>
    <PopoverContent align="end" className="w-60 p-2" data-canvas-chrome="">
      <form className="mb-2 flex items-center gap-2" onSubmit={event => { event.preventDefault(); if (valid) choose(Number(percent) / 100); }}><label className="flex min-w-0 flex-1 items-center gap-1"><span className="sr-only">{copy.zoom}</span><input type="number" inputMode="decimal" min={5} max={300} value={percent} onChange={event => setPercent(event.target.value)} aria-label={copy.zoom} className="min-h-[44px] w-full rounded-md border bg-background px-2" /><span>%</span></label><Button type="submit" className="min-h-[44px]" disabled={!valid}>{copy.done}</Button></form>
      <div className="mb-1 flex gap-1"><Button variant="ghost" type="button" className="min-h-[44px] flex-1" aria-label={copy.zoomOut} disabled={zoom <= MIN_ZOOM} onClick={() => choose(zoom / 1.25)}><Minus className="size-4" /></Button><Button variant="ghost" type="button" className="min-h-[44px] flex-1" aria-label={copy.zoomIn} disabled={zoom >= MAX_ZOOM} onClick={() => choose(zoom * 1.25)}><Plus className="size-4" /></Button></div>
      {[[copy.fitPage, onFitPage, false], [copy.fitBoard, onFitBoard, false], [copy.fitSelection, onFitSelection, !selectionAvailable]].map(([label, callback, disabled]) => <Button type="button" key={String(label)} variant="ghost" className="min-h-[44px] w-full justify-start" disabled={Boolean(disabled)} onClick={() => fit(callback as () => void)}>{String(label)}</Button>)}
      <div className="mt-1 border-t pt-1">{[.05, .1, .25, .5, 1, 1.5, 2, 3].map(value => <Button key={value} type="button" variant={Math.abs(zoom - value) < .001 ? "secondary" : "ghost"} className="min-h-[44px] w-1/2 justify-start tabular-nums" onClick={() => choose(value)}>{Math.round(value * 100)}%</Button>)}</div>
    </PopoverContent>
  </Popover>;
}
