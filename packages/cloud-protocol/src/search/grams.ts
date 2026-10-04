/**
 * [INPUT]: Depends on the shared Unicode normalization and standard UTF-8 encoding.
 * [OUTPUT]: Produces stable document/query grams identical to the existing SQLite codec version.
 * [POS]: Candidate-index encoding; matching still requires the full normalized tokens.
 */
import { normalizeSearchText } from "./text";
const encoder = new TextEncoder();
function gram(points: string[], index: number, width: number) {
  const bytes = encoder.encode(points.slice(index, index + width).join(""));
  let hex = ""; for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `g${width}${hex}`;
}
export function gramTokens(value: string) {
  const result = new Set<string>();
  for (const token of normalizeSearchText(value).split(" ")) {
    const points = Array.from(token);
    for (const width of [1, 2, 3]) for (let index = 0; index + width <= points.length; index++) result.add(gram(points, index, width));
  }
  return [...result].sort();
}
export function queryGramTokens(tokens: readonly string[]) {
  const result = new Set<string>();
  for (const token of tokens) {
    const points = Array.from(normalizeSearchText(token)), width = Math.min(3, points.length);
    if (!width) continue;
    for (let index = 0; index + width <= points.length; index++) result.add(gram(points, index, width));
  }
  return [...result].sort();
}
