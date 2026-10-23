/**
 * [INPUT]: Actual camera scale, fit capabilities and viewport-only callbacks.
 * [OUTPUT]: One bounded percent input with Enter/blur commit and three page/board/selection fit actions.
 * [POS]: Right Canvas tool group; zoom never calls a source mutation port.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@ai-chat/ui/components/ui/popover";
import { useArtifactHost } from "../../../context";
import { canvasCopy } from "./copy";
import { useProjectedZoom } from "./motion/controller";
import { MAX_ZOOM, MIN_ZOOM, clampZoom } from "./motion/camera";
export function CanvasZoom({ zoom, onZoom, onFitPage, onFitBoard, onFitSelection, selectionAvailable = false }: { zoom: number; onZoom(zoom: number): void; onFitPage(): void; onFitBoard(): void; onFitSelection(): void; selectionAvailable?: boolean }) {
  const copy = canvasCopy(useArtifactHost()!.locale), [open, setOpen] = useState(false), [percent, setPercent] = useState("100"), [edited, setEdited] = useState(false);
  const valid = Number.isFinite(Number(percent)) && Number(percent) >= MIN_ZOOM * 100 && Number(percent) <= MAX_ZOOM * 100;
  const commit = () => {
    if (valid && edited) onZoom(clampZoom(Number(percent) / 100));
    if (!valid) setPercent(String(Math.round(zoom * 100)));
    setEdited(false);
  };
  const fit = (callback: () => void) => { callback(); setOpen(false); };
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (value) { setPercent(String(Math.round(zoom * 100))); setEdited(false); } }}><PopoverTrigger asChild><Button variant="ghost" type="button" className="min-h-[44px] min-w-[76px] px-2 tabular-nums" aria-label={`${copy.zoom}: ${Math.round(zoom * 100)}%`} data-canvas-zoom=""><span>{Math.round(zoom * 100)}%</span><ChevronDown className="size-3" /></Button></PopoverTrigger>
    <PopoverContent align="end" className="w-56 max-w-[calc(100vw-24px)] p-2" data-canvas-zoom-menu="" data-canvas-chrome="">
      <form className="mb-2" noValidate onSubmit={event => { event.preventDefault(); if (valid) { commit(); setOpen(false); } }}><label className="flex min-h-[44px] items-center gap-2 rounded-md border bg-background px-2 focus-within:ring-2 focus-within:ring-ring/50"><span className="sr-only">{copy.zoom}</span><input type="number" inputMode="decimal" min={MIN_ZOOM * 100} max={MAX_ZOOM * 100} step="any" value={percent} onChange={event => { setPercent(event.target.value); setEdited(true); }} onBlur={commit} onFocus={event => event.currentTarget.select()} aria-label={copy.zoom} aria-invalid={!valid} className="min-h-[42px] w-full min-w-0 bg-transparent outline-none tabular-nums [appearance:textfield] aria-invalid:text-destructive [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" /><span aria-hidden="true" className="text-sm text-muted-foreground">%</span></label></form>
      {[[copy.fitPage, onFitPage, false], [copy.fitBoard, onFitBoard, false], [copy.fitSelection, onFitSelection, !selectionAvailable]].map(([label, callback, disabled]) => <Button type="button" key={String(label)} variant="ghost" className="min-h-[44px] w-full justify-start" disabled={Boolean(disabled)} onClick={() => fit(callback as () => void)}>{String(label)}</Button>)}
    </PopoverContent>
  </Popover>;
}

export function ProjectedCanvasZoom({ controller, ...props }: Omit<Parameters<typeof CanvasZoom>[0], "zoom"> & { controller: import("./motion/controller").CanvasCameraController }) {
  const zoom = useProjectedZoom(controller);
  return <CanvasZoom {...props} zoom={zoom} />;
}
