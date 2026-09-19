/**
 * [INPUT]: Host width persistence, current preview identity and the shared panel geometry policy.
 * [OUTPUT]: One measured container, normal/preview width custody and bounded per-preview sizing.
 * [POS]: Shared panel layout owner for local and cloud ChatPage adapters.
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { resolveSidePanelGeometry, SIDE_PANEL_MIN_WIDTH } from "@ai-chat/ui/lib/side-panel-layout";
export type PanelWidths = { read(preview?: string): number; write(width: number, preview?: string): number };
export function usePanelLayout(widths: PanelWidths, preview?: string | null) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(() => window.innerWidth);
  const [normal, setNormal] = useState(() => widths.read());
  const [previews, setPreviews] = useState<ReadonlyMap<string, number>>(() => new Map());
  useLayoutEffect(() => {
    const element = containerRef.current; if (!element) return;
    const measure = () => setContainerWidth(element.getBoundingClientRect().width);
    const frame = requestAnimationFrame(measure);
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", measure); };
    }
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);
  const widthChange = useCallback((width: number) => {
    if (width < SIDE_PANEL_MIN_WIDTH) return;
    const saved = widths.write(width, preview ?? undefined);
    if (!preview) { setNormal(saved); return; }
    setPreviews(previous => {
      const next = new Map(previous); next.delete(preview); next.set(preview, saved);
      if (next.size > 64) next.delete(next.keys().next().value!);
      return next;
    });
  }, [preview, widths]);
  const preferred = preview ? previews.get(preview) ?? widths.read(preview) : normal;
  return { containerRef, geometry: resolveSidePanelGeometry(containerWidth, preferred), widthChange };
}
