/**
 * [INPUT]: Source text and typed ranges from the HTML, CSS and JavaScript scanners.
 * [OUTPUT]: Loading/navigation spans, safe literal decoding and bounded range-only rewrites.
 * [POS]: Shared source-position contract; unrelated bytes are never rewritten.
 */
import { DESIGN_LIMITS, DesignDocumentError } from "../model";
export type DesignReference = Readonly<{ kind: "load" | "navigation"; url: string; start: number; end: number }>;
export type Literal = { value: string; start: number; end: number; next: number };
export function quoted(text: string, start: number, css = false): Literal {
  const quote = text[start]; let cursor = start + 1, last = cursor;
  const parts: string[] = [];
  while (cursor < text.length && text[cursor] !== quote) {
    const character = text[cursor++]!;
    if (character !== "\\") continue;
    parts.push(text.slice(last, cursor - 1));
    const next = text[cursor++]; if (next === undefined) break;
    if (next === "\n" || next === "\r") { if (next === "\r" && text[cursor] === "\n") cursor++; last = cursor; continue; }
    const match = (css ? /^[a-f0-9]{1,6}/i : next === "x" ? /^[a-f0-9]{2}/i : next === "u" ? /^[a-f0-9]{4}/i : /$a/).exec(css ? text.slice(cursor - 1) : text.slice(cursor));
    if (match) {
      const code = Number.parseInt(match[0], 16); parts.push(code <= 0x10ffff && code > 0 ? String.fromCodePoint(code) : "\ufffd");
      cursor += match[0].length - (css ? 1 : 0);
      if (css && /\s/.test(text[cursor] ?? "")) cursor++;
    } else parts.push(css ? next : ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" } as Record<string, string>)[next] ?? next);
    last = cursor;
  }
  parts.push(text.slice(last, cursor));
  return { value: parts.join(""), start: start + 1, end: cursor, next: Math.min(text.length, cursor + 1) };
}
export function decodedHtml(text: string, decode: (value: string) => string) {
  if (!/[&\r\0]/.test(text)) return { value: text, offsets: null };
  const offsets: number[] = []; let value = "";
  for (let cursor = 0; cursor < text.length;) {
    const match = /^&(?:#x[\da-f]+;?|#\d+;?|[a-z][a-z\d]*;?)/i.exec(text.slice(cursor));
    let decoded = text[cursor]!, consumed = 1;
    if (decoded === "\r") { decoded = "\n"; consumed = text[cursor + 1] === "\n" ? 2 : 1; }
    else if (decoded === "\0") decoded = "\ufffd";
    if (match) {
      const next = text[cursor + match[0].length] ?? "";
      decoded = decode(match[0] + next).slice(0, next ? -next.length : undefined); consumed = match[0].length;
      if (decoded === match[0]) {
        for (let i = 0; i < consumed; i++) offsets.push(cursor + i);
        value += decoded; cursor += consumed; continue;
      }
    }
    for (let i = 0; i < decoded.length; i++) offsets.push(cursor);
    value += decoded; cursor += consumed;
  }
  offsets.push(text.length); return { value, offsets };
}
export function mappedReferences(references: readonly DesignReference[], offsets: readonly number[] | null, base: number) {
  return references.map(reference => ({ ...reference, start: base + (offsets?.[reference.start] ?? reference.start), end: base + (offsets?.[reference.end] ?? reference.end) }));
}
export function rewriteReferences(text: string, references: readonly DesignReference[], replace: (reference: DesignReference) => string | null) {
  const parts: string[] = []; let cursor = 0, bytes = Buffer.byteLength(text);
  for (const reference of [...references].sort((a, b) => a.start - b.start)) {
    const replacement = replace(reference); if (replacement === null) continue;
    if (reference.start < cursor || reference.end < reference.start) throw new DesignDocumentError("INVALID_DOCUMENT", "Resource spans overlap");
    bytes += Buffer.byteLength(replacement) - Buffer.byteLength(text.slice(reference.start, reference.end));
    if (bytes > DESIGN_LIMITS.archive) throw new DesignDocumentError("BUDGET_EXCEEDED", "Prepared resources exceed the render budget");
    parts.push(text.slice(cursor, reference.start), replacement); cursor = reference.end;
  }
  parts.push(text.slice(cursor)); return parts.join("");
}
