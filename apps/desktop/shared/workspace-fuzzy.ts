/**
 * [INPUT]: Accepts workspace relative path to user queries, without relying on platform API or module status
 * [OUTPUT]: Provides a linear boundary forwards/backwards with a more optimum linear boundary fuzzyScore
 * [POS]: The Workspace candidate blur matches the pure core of shared; Main Current consumption, renderer can be used as a replacement when ordered down
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
