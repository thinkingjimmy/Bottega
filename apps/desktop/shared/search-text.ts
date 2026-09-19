/**
 * [INPUT]: Depends on the shared protocol search text core.
 * [OUTPUT]: Re-exports normalization, tokenization, exact matching and snippets for existing desktop callers.
 * [POS]: Desktop search compatibility surface; SQLite, global search and renderer Find share the cloud matcher.
 */
export { normalizeSearchText, tokenizeSearchQuery, matchSearchTokens, normalizedSearchMatch, makeSearchSnippet } from "@ai-chat/cloud-protocol/search/text";
