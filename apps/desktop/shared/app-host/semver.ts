/**
 * [INPUT]: Depends only on complete SemVer strings.
 * [OUTPUT]: Provides strict parsing and precedence comparison without numeric precision loss.
 * [POS]: Shared minimum-host version algebra for Apps and the existing updater.
 */

export type SemVer = Readonly<{ core: readonly string[]; prerelease: readonly string[] }>;
const numeric = /^(0|[1-9][0-9]*)$/;
const pattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseSemVer(value: unknown): SemVer | null {
  if (typeof value !== "string" || value.length > 256) return null;
  const match = pattern.exec(value);
  if (!match || match[0] !== value) return null;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((id) => /^\d+$/.test(id) && !numeric.test(id))) return null;
  return { core: match.slice(1, 4), prerelease };
}

function compareNumber(left: string, right: string) {
  return Math.sign(left.length - right.length) || (left === right ? 0 : left < right ? -1 : 1);
}

export function compareSemVer(left: string, right: string): number {
  const a = parseSemVer(left);
  const b = parseSemVer(right);
  if (!a || !b) throw new Error("INVALID_SEMVER");
  for (let i = 0; i < 3; i++) {
    const order = compareNumber(a.core[i]!, b.core[i]!);
    if (order) return order;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = numeric.test(x);
    const yn = numeric.test(y);
    return xn && yn ? compareNumber(x, y) : xn !== yn ? xn ? -1 : 1 : x < y ? -1 : 1;
  }
  return 0;
}

export function meetsMinimum(version: string | null, minimum: string) {
  return Boolean(parseSemVer(version) && parseSemVer(minimum) && compareSemVer(version!, minimum) >= 0);
}
