/**
 * [INPUT]: Depends on native CSS text layout, grapheme boundaries, and structured text elements.
 * [OUTPUT]: Provides shared editor typography and cached native line/run positions, including tab stops and wrapping.
 * [POS]: Sole text layout authority; Canvas drawing, selection, and PNG consume native editor-compatible positions.
 */
import type { TextElement } from "../model/document";
import type { Bounds } from "../model/geometry/transform";

export const SKETCH_FONT = "system-ui, sans-serif";
export const textStyle = (element: TextElement) => ({
  font: element.fontSize + "px " + SKETCH_FONT,
  lineHeight: element.fontSize * element.lineHeight + "px",
  fontKerning: "normal" as const,
  letterSpacing: "normal",
  textAlign: "left" as const,
  whiteSpace: "pre-wrap" as const,
  wordBreak: "break-all" as const,
  overflowWrap: "anywhere" as const,
  tabSize: 8,
});
type TextRun = { text: string; x: number };
type TextLine = { y: number; runs: TextRun[] };
type TextLayout = { lines: TextLine[]; bounds: Bounds };
const cache = new WeakMap<TextElement, TextLayout>();
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function layoutText(element: TextElement): TextLayout {
  const known = cache.get(element);
  if (known) return known;
  const ruler = document.createElement("div");
  ruler.setAttribute("aria-hidden", "true");
  Object.assign(ruler.style, textStyle(element), {
    position: "fixed", left: "0", top: "0", visibility: "hidden",
    width: element.boxWidth + "px", padding: "0", margin: "0", border: "0",
    pointerEvents: "none",
  });
  // The zero-width sentinel gives a trailing newline its native empty final line.
  ruler.textContent = element.text + "\u200b";
  document.body.append(ruler);
  try {
    const node = ruler.firstChild!;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 1);
    const top = range.getBoundingClientRect().top;
    const left = ruler.getBoundingClientRect().left;
    const lineHeight = element.fontSize * element.lineHeight;
    const maximumLines = Math.ceil(1600 / (lineHeight * element.transform.scaleY)) + 1;
    const lines: TextLine[] = [];
    let width = 1, lastRow = 0, run: TextRun | undefined;
    for (const { segment, index } of segmenter.segment(ruler.textContent)) {
      range.setStart(node, index);
      range.setEnd(node, index + segment.length);
      const rect = range.getBoundingClientRect();
      const row = Math.max(0, Math.round((rect.top - top) / lineHeight));
      lastRow = Math.max(lastRow, row);
      // One overflowing line rejects the draft while its full native editing copy remains intact.
      if (row >= maximumLines) break;
      if (index >= element.text.length || /[\t\r\n]/.test(segment)) {
        run = undefined;
        continue;
      }
      let line = lines.at(-1);
      if (!line || line.y !== row * lineHeight) {
        line = { y: row * lineHeight, runs: [] };
        lines.push(line);
        run = undefined;
      }
      if (!run) {
        run = { text: "", x: rect.left - left };
        line.runs.push(run);
      }
      run.text += segment;
      if (!/^\s+$/.test(segment)) width = Math.max(width, rect.right - left);
    }
    const result = { lines, bounds: { x: 0, y: 0, width, height: (lastRow + 1) * lineHeight } };
    cache.set(element, result);
    return result;
  } finally {
    ruler.remove();
  }
}
