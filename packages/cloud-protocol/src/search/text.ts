/**
 * [INPUT]: Depends only on Unicode strings.
 * [OUTPUT]: Provides common NFKC normalization, tokenization, exact unordered AND matching and bounded snippets.
 * [POS]: Shared search semantics used by local SQLite, renderer Find and authorized cloud search.
 */
export function normalizeSearchText(value: string) { return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim(); }
export function tokenizeSearchQuery(query: string) {
  const normalized = normalizeSearchText(query);
  if (!normalized) throw Object.assign(new Error("Search query must not be empty"), { status: 400 });
  const tokens = normalized.split(" ");
  if (tokens.length > 16) throw Object.assign(new Error("Search query must not exceed 16 tokens"), { status: 400 });
  return tokens;
}
export function matchSearchTokens(normalizedText: string, tokens: readonly string[]) {
  let offset = Number.POSITIVE_INFINITY;
  for (const token of tokens) { const index = normalizedText.indexOf(token); if (index < 0) return null; offset = Math.min(offset, index); }
  return Number.isFinite(offset) ? offset : null;
}
export function normalizedSearchMatch(value: string, tokens: readonly string[]) {
  const normalizedText = normalizeSearchText(value), offset = matchSearchTokens(normalizedText, tokens);
  return offset === null ? null : { normalizedText, offset };
}
export function makeSearchSnippet(normalizedText: string, offset: number) {
  const start = Math.max(0, offset - 60), end = Math.min(normalizedText.length, start + 180);
  return `${start ? "…" : ""}${normalizedText.slice(start, end)}${end < normalizedText.length ? "…" : ""}`;
}
