/**
 * [INPUT]: No dependencies; only deals with Unicode strings
 * [OUTPUT]: Provides normalize/tokenize/AND matcher/snippet with normalizedMatch
 * [POS]: The only implementation of shared full text matching; Main Global search and renderer Transcript Find bar must be consumable from the same source
 */

export function normalizeSearchText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

export function tokenizeSearchQuery(query: string) {
  const normalized = normalizeSearchText(query);
  if (!normalized) throw statusError(400, "搜索 query 不能为空");
  const tokens = normalized.split(" ");
  if (tokens.length > 16) throw statusError(400, "搜索 token 不能超过 16 个");
  return tokens;
}

export function matchSearchTokens(
  normalizedText: string,
  tokens: readonly string[]
) {
  let offset = Number.POSITIVE_INFINITY;
  for (const token of tokens) {
    const index = normalizedText.indexOf(token);
    if (index < 0) return null;
    offset = Math.min(offset, index);
  }
  return Number.isFinite(offset) ? offset : null;
}

export function normalizedSearchMatch(value: string, tokens: readonly string[]) {
  const normalizedText = normalizeSearchText(value);
  const offset = matchSearchTokens(normalizedText, tokens);
  return offset === null ? null : { normalizedText, offset };
}

export function makeSearchSnippet(normalizedText: string, offset: number) {
  const start = Math.max(0, offset - 60);
  const end = Math.min(normalizedText.length, start + 180);
  return `${start ? "…" : ""}${normalizedText.slice(start, end)}${
    end < normalizedText.length ? "…" : ""
  }`;
}

const statusError = (status: number, message: string) =>
  Object.assign(new Error(message), { status });
