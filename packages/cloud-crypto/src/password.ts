/**
 * [INPUT]: Shared scalar validation and safe encrypted sync errors.
 * [OUTPUT]: Shared eight-scalar minimum, letter-and-digit creation admission, exact unlock encoding and confirmation comparison.
 * [POS]: Cheap client-only validation; never performs password derivation.
 */
import { assertCrypto, scalarCount, sameBytes } from "@ai-chat/cloud-protocol/encryption";

export const MIN_PASSWORD_CODE_POINTS = 8;

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

export function validateNewPassword(password: string): { codePoints: number; utf8Bytes: number } {
  const result = validatePassword(password);
  assertCrypto(/[A-Za-z]/.test(password) && /[0-9]/.test(password), "sync-password-weak");
  return result;
}

export function passwordsMatch(password: string, confirmation: string): boolean {
  const bytes = encodePassword(password);
  let confirmed: Uint8Array | undefined;
  try { confirmed = encodePassword(confirmation); return sameBytes(bytes, confirmed); }
  finally { bytes.fill(0); confirmed?.fill(0); }
}
