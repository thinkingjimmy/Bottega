/**
 * [INPUT]: Actual selected values, available control space, fixed font choices, source capabilities, durable draft/refresh/close callbacks and raw-field close protection; catalog-owned labels use the shared formatCopy formatter.
 * [OUTPUT]: Readable font choices, staged typography, space-bound controls that retain hidden input, explicit close/settlement and actionable read-only recovery.
 * [POS]: Floating Canvas text controls; temporary values are saved only by the original journal on Done.
 */
import { useState } from "react";
import { AlignLeft, AlignCenter, AlignRight, AlignJustify, Bold, Italic, Underline, MoreHorizontal, Pencil, Check, X } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { formatCopy } from "@ai-chat/ui/lib/workbench-copy/format";
import { Popover, PopoverContent, PopoverTrigger } from "@ai-chat/ui/components/ui/popover";
import { validDesignProperty, type CanvasStyle } from "@ai-chat/cloud-protocol/artifacts/design/canvas/model";
import { useArtifactHost } from "../../../../../context";
import { canvasCopy } from "../../copy";
export type TypographyValues = Partial<Record<keyof CanvasStyle, string>>;
export function colorHex(value: string) {
  if (/^#[a-f0-9]{6}$/i.test(value)) return value;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext("2d");
    if (context && CSS.supports("color", value)) { context.fillStyle = value; context.fillRect(0, 0, 1, 1); const pixel = context.getImageData(0, 0, 1, 1).data; return "#" + [...pixel].slice(0, 3).map(value => value.toString(16).padStart(2, "0")).join(""); }
  }
  const match = value.match(/^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/i);
  return match ? "#" + match.slice(1, 4).map(value => Math.max(0, Math.min(255, Number(value))).toString(16).padStart(2, "0")).join("") : /^#[a-f0-9]{3}$/i.test(value) ? "#" + value.slice(1).split("").map(value => value + value).join("") : "#000000";
}
function ValueInput({ value, label, numeric = false, change }: { value: string; label: string; numeric?: boolean; change(value: string): void }) {
  const [draft, setDraft] = useState({ base: value, value });
  const shown = draft.base === value ? draft.value : value;
  return <input aria-label={label} title={label} value={shown} inputMode={numeric ? "decimal" : undefined} className="min-h-[44px] min-w-0 w-full rounded-md border bg-background px-2 text-sm" onChange={event => { setDraft({ base: value, value: event.target.value }); change(event.target.value); }} />;
}
export function CanvasTypography({ values, fonts, visible, editable, textEditable, linkEditable, listEditable, reason, href = "", list = "none", dirty, busy, change, editText, done, close, refresh, onUncheckpointed }: {
  values: TypographyValues; fonts: string[]; visible: boolean; editable: boolean; textEditable: boolean; linkEditable: boolean; listEditable: boolean; reason?: string;
  href?: string; list?: "none" | "ordered" | "unordered"; dirty: boolean; busy: boolean;
  onUncheckpointed(value: boolean): void; change(style: CanvasStyle, extras?: { href?: string | null; list?: "none" | "ordered" | "unordered" }): void; editText(): void; done(): void; close(): void; refresh(): Promise<unknown>;
}) {
  const copy = canvasCopy(useArtifactHost()!.locale), [more, setMore] = useState(false), [refreshing, setRefreshing] = useState(false), [refreshError, setRefreshError] = useState(false), [invalidFields, setInvalidFields] = useState<Partial<Record<keyof CanvasStyle, string>>>({});
  const family = values["font-family"] || fonts[0] || "system-ui", size = String(parseFloat(values["font-size"] || "16")), decoration = values["text-decoration"] ?? "none";
  const primaryMatch = family.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/), primary = (primaryMatch?.[1] ?? primaryMatch?.[2] ?? primaryMatch?.[3] ?? family).trim();
  const systemFamily = /^(?:-apple-system|BlinkMacSystemFont|Segoe UI)$/i.test(primary) ? "system-ui" : primary.toLowerCase().replace(/^ui-/, "");
  const selectedFamily = fonts.find(font => font.toLowerCase() === primary.toLowerCase()) ?? (fonts.includes(systemFamily) ? systemFamily : family), blocked = !editable && !busy;
  const fontLabel = (font: string) => font === "system-ui" ? copy.systemFont : font;
  const invalidMessage = Object.values(invalidFields)[0] ?? "";
  const invalid = (key: keyof CanvasStyle, message: string) => { const next = { ...invalidFields }; if (message) next[key] = message; else delete next[key]; setInvalidFields(next); onUncheckpointed(Object.keys(next).length > 0); };
  const apply = (key: keyof CanvasStyle, value: string) => { if (!validDesignProperty(key, value)) { invalid(key, copy.unsupported); return; } invalid(key, ""); change({ [key]: value }); };
  const action = (label: string, Icon: typeof Bold, click: () => void, pressed = false, disabled = false) => <Button type="button" variant={pressed ? "secondary" : "ghost"} size="icon" aria-label={label} title={disabled ? reason ?? copy.unsupported : label} aria-pressed={pressed} disabled={!editable || busy || disabled} className="min-h-[44px] min-w-[44px] shrink-0" onClick={click}><Icon className="size-4" /></Button>;
  const checkSource = async () => { setMore(false); setRefreshing(true); setRefreshError(false); try { await refresh(); } catch { setRefreshError(true); } finally { setRefreshing(false); } };
  return <div data-canvas-typography="" data-canvas-chrome="" hidden={!visible} className="max-w-full rounded-lg border bg-background p-1 shadow-lg" role="toolbar" aria-label={copy.properties}>
    {blocked && <div data-canvas-typography-blocked="" className="space-y-2 p-2"><p role={refreshError ? "alert" : "status"} className="text-sm">{refreshError ? copy.failed : reason ?? copy.unavailable}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-[44px]" disabled={refreshing} onClick={() => void checkSource()}>{refreshing ? copy.loading : copy.refresh}</Button><Button type="button" variant="ghost" className="min-h-[44px]" onClick={close}>{dirty || invalidMessage ? copy.cancel : copy.closePanel}</Button></div></div>}
    <div className={blocked ? "hidden" : undefined}>
    <fieldset disabled={!editable || busy} className="space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
      <select aria-label={copy.font} title={copy.font} value={selectedFamily} className="min-h-[44px] min-w-0 max-w-full basis-[140px] grow rounded-md border bg-background px-2 text-sm" onChange={event => apply("font-family", event.target.value)}>{!fonts.includes(selectedFamily) && <option value={selectedFamily} disabled>{primary}</option>}{fonts.map(family => <option key={family} value={family}>{fontLabel(family)}</option>)}</select>
      <div className="flex shrink-0 items-center gap-1"><span className="w-16"><ValueInput label={formatCopy(copy.pixelLabel, { label: copy.fontSize })} value={size} numeric change={value => { if (value.trim() && Number(value) > 0 && Number(value) <= 8000) apply("font-size", `${Number(value)}px`); else invalid("font-size", copy.unsupported); }} /></span>
      <input type="color" aria-label={copy.color} title={`${copy.color}: ${values.color ?? ""}`} value={colorHex(values.color ?? "#000000")} className="size-11 shrink-0 cursor-pointer rounded border bg-background p-1" onChange={event => apply("color", event.target.value)} />
      </div></div><div className="flex flex-wrap items-center">
      {action(copy.bold, Bold, () => apply("font-weight", Number.parseInt(values["font-weight"] ?? "400", 10) >= 600 || values["font-weight"] === "bold" ? "400" : "700"), Number.parseInt(values["font-weight"] ?? "400", 10) >= 600 || values["font-weight"] === "bold")}
      {action(copy.italic, Italic, () => apply("font-style", ["italic", "oblique"].includes(values["font-style"] ?? "") ? "normal" : "italic"), ["italic", "oblique"].includes(values["font-style"] ?? ""))}
      {action(copy.underline, Underline, () => apply("text-decoration", [decoration.includes("underline") ? "" : "underline", decoration.includes("line-through") ? "line-through" : ""].filter(Boolean).join(" ") || "none"), decoration.includes("underline"))}
      <Popover open={more && !blocked && visible} onOpenChange={setMore}><PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={copy.more} title={copy.more} className="min-h-[44px] min-w-[44px]"><MoreHorizontal className="size-4" /></Button></PopoverTrigger><PopoverContent className="w-72 max-w-[calc(100vw-24px)] space-y-3 p-3" data-canvas-chrome="">
        <div className="flex" role="group" aria-label={copy.align}>{([["start", copy.start, AlignLeft], ["center", copy.center, AlignCenter], ["end", copy.end, AlignRight], ["justify", copy.justify, AlignJustify]] as const).map(([value, label, Icon]) => <Button key={value} type="button" variant={values["text-align"] === value || value === "start" && values["text-align"] === "left" || value === "end" && values["text-align"] === "right" ? "secondary" : "ghost"} aria-pressed={values["text-align"] === value || value === "start" && values["text-align"] === "left" || value === "end" && values["text-align"] === "right"} size="icon" aria-label={label} className="min-h-[44px] min-w-[44px]" disabled={!editable || busy} onClick={() => apply("text-align", value)}><Icon className="size-4" /></Button>)}</div>
        <label className="block space-y-1 text-sm"><span>{copy.lineHeight}</span><ValueInput label={copy.lineHeight} value={values["line-height"] ?? "normal"} numeric change={value => apply("line-height", value)} /></label>
        <label className="block space-y-1 text-sm"><span>{copy.letterSpacing}</span><ValueInput label={copy.letterSpacing} value={values["letter-spacing"] ?? "0px"} numeric change={value => apply("letter-spacing", /^-?[\d.]+$/.test(value) ? `${value}px` : value)} /></label>
        <label className="block space-y-1 text-sm"><span>{copy.link}</span><fieldset disabled={!editable || !linkEditable || busy}><ValueInput label={copy.link} value={href} change={value => change({}, { href: value || null })} /></fieldset></label>
        <label className="block space-y-1 text-sm"><span>{copy.list}</span><select aria-label={copy.list} value={list} disabled={!editable || !listEditable || busy} title={!listEditable ? reason ?? copy.unsupported : undefined} className="min-h-[44px] w-full rounded-md border bg-background px-2" onChange={event => change({}, { list: event.target.value as typeof list })}>{(["none", "ordered", "unordered"] as const).map(value => <option key={value} value={value}>{copy[value]}</option>)}</select></label>
        {(!linkEditable || !listEditable) && <p className="text-xs text-muted-foreground">{copy.unsupported}</p>}
      </PopoverContent></Popover>
      </div>
    </fieldset>
    {!fonts.includes(selectedFamily) && <p role="status" className="px-2 py-1 text-xs text-muted-foreground">{copy.fontUnavailable}</p>}
    <div className="mt-1 flex items-center gap-1 border-t pt-1">{action(copy.editText, Pencil, editText, false, !textEditable)}<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" role="status">{invalidMessage || (busy ? copy.loading : dirty ? copy.unsavedInput : "")}</span><Button type="button" variant="ghost" size="icon" aria-label={dirty || invalidMessage ? copy.cancel : copy.closePanel} className="min-h-[44px] min-w-[44px]" disabled={busy} onClick={close}><X className="size-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label={copy.done} className="min-h-[44px] min-w-[44px]" disabled={!editable || busy || Boolean(invalidMessage)} onClick={done}><Check className="size-4" /></Button></div>
    </div>
  </div>;
}
