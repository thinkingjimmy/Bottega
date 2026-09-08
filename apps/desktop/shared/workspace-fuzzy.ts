/**
 * [INPUT]: Accepts a workspace-relative path and a user query string; has no dependency on any platform API or module state
 * [OUTPUT]: Provides fuzzyScore, taking the better of a forward and backward greedy character match to produce a rank-comparable score, or null when the query doesn't match
 * [POS]: Shared pure core for fuzzy-matching workspace path candidates; main currently consumes it, kept dependency-free so the renderer can reuse it for local re-ranking if needed
 */

const normalized = (value: string) => value.normalize("NFKC").toLowerCase();

const boundary = (value: readonly string[], index: number) =>
  index === 0 || /[/_.\-\s]/u.test(value[index - 1] ?? "");

const CONSECUTIVE_BONUS = 16;

const characterScore = (target: readonly string[], index: number) =>
  1 +
  (boundary(target, index) ? 12 : 0) +
  Math.max(0, 4 - Math.floor(index / 8));

function greedyScore(
  target: readonly string[],
  needle: readonly string[],
  backwards: boolean
) {
  let targetIndex = backwards ? target.length - 1 : 0;
  let previousIndex: number | null = null;
  let score = 0;
  for (
    let queryIndex = backwards ? needle.length - 1 : 0;
    backwards ? queryIndex >= 0 : queryIndex < needle.length;
    queryIndex += backwards ? -1 : 1
  ) {
    while (
      targetIndex >= 0 &&
      targetIndex < target.length &&
      target[targetIndex] !== needle[queryIndex]
    ) {
      targetIndex += backwards ? -1 : 1;
    }
    if (targetIndex < 0 || targetIndex >= target.length) return null;
    score += characterScore(target, targetIndex);
    if (
      previousIndex !== null &&
      (backwards
        ? targetIndex + 1 === previousIndex
        : targetIndex - 1 === previousIndex)
    ) {
      score += CONSECUTIVE_BONUS;
    }
    previousIndex = targetIndex;
    targetIndex += backwards ? -1 : 1;
  }
  return score;
}

/** 分数只在同一 rank 内比较；越高表示字符越紧凑、越靠近词或路径边界。 */
export function fuzzyScore(path: string, query: string): number | null {
  const target = Array.from(normalized(path));
  const needle = Array.from(normalized(query));
  if (needle.length === 0) return 0;
  if (needle.length > target.length) return null;

  const score = Math.max(
    greedyScore(target, needle, false) ?? Number.NEGATIVE_INFINITY,
    greedyScore(target, needle, true) ?? Number.NEGATIVE_INFINITY
  );
  if (!Number.isFinite(score)) return null;
  return score - Math.max(0, target.length - needle.length) / 100;
}
