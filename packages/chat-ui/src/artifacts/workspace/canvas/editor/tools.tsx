/**
 * [INPUT]: Current editor mode, genuine action availability and tool callbacks.
 * [OUTPUT]: Select/Hand/Text/Artboard/Note/Draw/Shapes/image controls with coarse-pointer grouping.
 * [POS]: Left Canvas tool group; the workspace supplies verified capability and mutation ports.
 */
import { useState } from "react";
import { MousePointer2, Hand, Type, Frame, StickyNote, Pencil, Shapes, Square, Circle, Minus, MoveUpRight, ImagePlus, ChevronDown } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@ai-chat/ui/components/ui/popover";
import { useArtifactHost } from "../../../context";
import { canvasCopy } from "./copy";
export type CanvasTool = "preview" | "select" | "annotate" | "hand" | "text" | "artboard" | "note" | "draw" | "rectangle" | "ellipse" | "line" | "arrow" | "image";
export type ToolAvailability = Partial<Record<CanvasTool, { available: boolean; reason?: string }>>;
export const toolForKey = (key: string, shift = false): CanvasTool | undefined => ({ v: "select", h: "hand", t: "text", a: "artboard", n: "note", p: "draw", r: "rectangle", o: "ellipse", l: shift ? "arrow" : "line" } as const)[key.toLowerCase() as "v"];
const tools = ["select", "hand", "text", "artboard", "note", "draw", "rectangle", "ellipse", "line", "arrow", "image"] as const;
const glyphs = { select: MousePointer2, hand: Hand, text: Type, artboard: Frame, note: StickyNote, draw: Pencil, rectangle: Square, ellipse: Circle, line: Minus, arrow: MoveUpRight, image: ImagePlus };
const shortcuts = { select: "V", hand: "H", text: "T", artboard: "A", note: "N", draw: "P", rectangle: "R", ellipse: "O", line: "L", arrow: "Shift+L", image: undefined };
export function CanvasTools({ tool, availability, onTool }: { tool: CanvasTool; availability: ToolAvailability; onTool(tool: CanvasTool): void }) {
  const copy = canvasCopy(useArtifactHost()!.locale), [open, setOpen] = useState(false);
  const action = (item: typeof tools[number], menu = false) => {
    const Icon = glyphs[item], capability = availability[item], disabled = capability?.available !== true, label = copy[item];
    return <Button key={item} type="button" variant={tool === item ? "secondary" : "ghost"} size={menu ? "default" : "icon"} className={menu ? "min-h-[44px] w-full justify-start" : "min-h-[44px] min-w-[44px] shrink-0"} aria-label={label} title={disabled ? capability?.reason ?? copy.unavailable : `${label}${shortcuts[item] ? ` (${shortcuts[item]})` : ""}`} aria-pressed={tool === item} aria-keyshortcuts={shortcuts[item]} disabled={disabled} data-canvas-tool={item} onClick={() => { setOpen(false); onTool(item); }}><Icon className="size-4" />{menu && <><span className="min-w-0 flex-1 truncate">{label}</span><span className="text-xs text-muted-foreground">{shortcuts[item]}</span></>}</Button>;
  };
  return <div className="flex shrink-0 items-center" role="group" aria-label={copy.tools}>
    {action("select")}{action("hand")}
    <span className="artifact-canvas-desktop-tools">{tools.slice(2, 6).map(item => action(item))}</span>
    <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button type="button" variant={tools.slice(6).includes(tool as typeof tools[number]) ? "secondary" : "ghost"} className="min-h-[44px] min-w-[44px] gap-0 px-2" aria-label={copy.shapes} title={copy.shapes}><Shapes className="size-4" /><ChevronDown className="size-3" /></Button></PopoverTrigger><PopoverContent align="start" className="w-60 p-1" data-canvas-chrome="">
      <div className="artifact-canvas-mobile-tools">{tools.slice(2, 6).map(item => action(item, true))}<div className="my-1 border-t" /></div>
      {tools.slice(6).map(item => action(item, true))}
      {availability.text?.reason && !availability.text.available && <p role="status" className="px-3 py-2 text-xs text-muted-foreground">{availability.text.reason}</p>}
      {availability.image?.reason && !availability.image.available && <p role="status" className="px-3 py-2 text-xs text-muted-foreground">{availability.image.reason}</p>}
    </PopoverContent></Popover>
  </div>;
}
