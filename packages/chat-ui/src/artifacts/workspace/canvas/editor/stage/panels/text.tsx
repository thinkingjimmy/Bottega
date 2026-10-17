/**
 * [INPUT]: Exact verified text, visible screen geometry, computed typography and durable input callbacks.
 * [OUTPUT]: Original-position plain-text input with native undo/IME, explicit Done/Cancel and retained failure values.
 * [POS]: Trusted host text editor; the child receives reversible display instructions, never save authority.
 */
import { useEffect, useRef, type CSSProperties } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useArtifactHost } from "../../../../../context";
import { canvasCopy } from "../../copy";
import type { CanvasBox } from "../../camera";
import type { TypographyValues } from "./typography";
const scaled = (value: string | undefined, zoom: number) => value && /^-?[\d.]+px$/.test(value) ? `${parseFloat(value) * zoom}px` : value;
export function CanvasTextEditor({ value, box, zoom, style, editable, busy, autofocus = false, change, done, cancel }: { value: string; box: CanvasBox; zoom: number; style: TypographyValues; editable: boolean; busy: boolean; autofocus?: boolean; change(value: string): void; done(): void; cancel(): void }) {
  const copy = canvasCopy(useArtifactHost()!.locale), input = useRef<HTMLTextAreaElement>(null), initialLength = useRef(value.length);
  useEffect(() => { if (autofocus) { input.current?.focus(); input.current?.setSelectionRange(initialLength.current, initialLength.current); } }, [autofocus]);
  const typography: CSSProperties = { fontFamily: style["font-family"], fontSize: scaled(style["font-size"], zoom), color: style.color, background: style["background-color"] || "transparent", fontWeight: style["font-weight"], fontStyle: style["font-style"], textDecoration: style["text-decoration"], textAlign: style["text-align"] as CSSProperties["textAlign"], lineHeight: scaled(style["line-height"], zoom), letterSpacing: scaled(style["letter-spacing"], zoom) };
  return <div data-canvas-text-editor="" data-canvas-chrome="" className="absolute z-40" style={{ left: box.x, top: box.y, width: Math.max(44, box.width), minHeight: Math.max(44, box.height) }}>
    <textarea ref={input} aria-label={copy.editText} value={value} maxLength={4096} readOnly={!editable || busy} className="block w-full resize-none rounded-none border-0 p-0 outline-2 outline-primary" style={{ ...typography, height: Math.max(44, box.height), boxSizing: "border-box", overflow: "auto" }} onChange={event => change(event.target.value)} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) cancel(); }
      else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); if (editable && !busy) done(); }
    }} />
    <div className="mt-1 flex w-fit max-w-full gap-1 rounded-md border bg-background p-1 shadow-sm"><Button type="button" variant="ghost" className="min-h-[44px]" disabled={busy} onClick={cancel}>{copy.cancel}</Button><Button type="button" className="min-h-[44px]" disabled={!editable || busy} onClick={done}>{copy.done}</Button></div>
  </div>;
}
