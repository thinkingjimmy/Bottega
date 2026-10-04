/**
 * [INPUT]: Shared scalar validation and safe encrypted sync errors.
 * [OUTPUT]: Eight-scalar unlock minimum, structured twelve-scalar creation assessment (assessNewPassword), throwing creation admission, exact unlock encoding and confirmation comparison.
 * [POS]: Cheap client-only validation; never performs password derivation. Creation rules never apply to unlocking existing packages.
 */
import { assertCrypto, scalarCount, sameBytes } from "@ai-chat/cloud-protocol/encryption";

export const MIN_PASSWORD_CODE_POINTS = 8;
export const MIN_NEW_PASSWORD_CODE_POINTS = 12;
const MIN_DISTINCT_CODE_POINTS = 5, MIN_PATTERN_RUN = 4, MIN_EMAIL_LOCAL_CODE_POINTS = 4;
// Matched as case-insensitive substrings; keyboard walks and digit runs are here because they are not code-point sequences.
const COMMON_FRAGMENTS = ["bottega", "password", "qwerty", "123456", "iloveyou", "admin", "letmein", "welcome", "asdfgh", "zxcvbn", "111111", "abc123"];

/** Display order of every creation requirement; the first three are positive requirements, the rest are prohibitions. */
export const NEW_PASSWORD_REASONS = ["too-short", "needs-letter", "needs-digit", "too-simple", "contains-email", "common"] as const;
export type NewPasswordReason = typeof NEW_PASSWORD_REASONS[number];
export type NewPasswordAssessment = { ok: true } | { ok: false; reasons: NewPasswordReason[] };
export interface NewPasswordContext { email?: string | null }

/** Same-character or ±1 code-point runs of four or more covering over half the scalars. */
function isSimplePattern(scalars: readonly number[]): boolean {
  const covered = new Uint8Array(scalars.length);
  for (const step of [0, 1, -1]) {
    let start = 0;
    for (let i = 1; i <= scalars.length; i++) {
      if (i < scalars.length && scalars[i] - scalars[i - 1] === step) continue;
      if (i - start >= MIN_PATTERN_RUN) covered.fill(1, start, i);
      start = i;
    }
  }
  return covered.reduce((sum, value) => sum + value, 0) * 2 > scalars.length;
}

/** Pure creation-strength check for live hints; encoding limits stay with validatePassword. */
export function assessNewPassword(password: string, context: NewPasswordContext = {}): NewPasswordAssessment {
  const lower = password.toLowerCase(), reasons: NewPasswordReason[] = [];
  // Per-scalar folding keeps sequence positions aligned even where lowercasing changes length.
  const scalars = Array.from(password, char => { const folded = char.toLowerCase(); return (folded.length === char.length ? folded : char).codePointAt(0)!; });
  if (scalars.length < MIN_NEW_PASSWORD_CODE_POINTS) reasons.push("too-short");
  if (!/\p{L}/u.test(password)) reasons.push("needs-letter");
  if (!/\p{Nd}/u.test(password)) reasons.push("needs-digit");
  if (new Set(scalars).size < MIN_DISTINCT_CODE_POINTS || isSimplePattern(scalars)) reasons.push("too-simple");
  const local = context.email?.split("@")[0]?.toLowerCase() ?? "";
  if (Array.from(local).length >= MIN_EMAIL_LOCAL_CODE_POINTS && lower.includes(local)) reasons.push("contains-email");
  if (COMMON_FRAGMENTS.some(fragment => lower.includes(fragment))) reasons.push("common");
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

export function encodePassword(password: string): Uint8Array {
  assertCrypto(typeof password === "string" && password.length <= 1024, "sync-password-invalid");
  assertCrypto(scalarCount(password) >= MIN_PASSWORD_CODE_POINTS, "sync-password-invalid");
  const bytes = new TextEncoder().encode(password);
  if (bytes.byteLength > 1024) {
    bytes.fill(0);
    assertCrypto(false, "sync-password-invalid");
  }
  return bytes;
}

export function validatePassword(password: string): { codePoints: number; utf8Bytes: number } {
  const bytes = encodePassword(password);
  try { return { codePoints: scalarCount(password), utf8Bytes: bytes.byteLength }; }
  finally { bytes.fill(0); }
}

/** Creation admission: any unmet strength rule is `sync-password-weak`; only encoding limits are `sync-password-invalid`. */
export function validateNewPassword(password: string, context: NewPasswordContext = {}): { codePoints: number; utf8Bytes: number } {
  assertCrypto(typeof password === "string", "sync-password-invalid");
  assertCrypto(assessNewPassword(password, context).ok, "sync-password-weak");
  return validatePassword(password);
}

export function passwordsMatch(password: string, confirmation: string): boolean {
  const bytes = encodePassword(password);
  let confirmed: Uint8Array | undefined;
  try { confirmed = encodePassword(confirmation); return sameBytes(bytes, confirmed); }
  finally { bytes.fill(0); confirmed?.fill(0); }
}
