/**
 * [INPUT]: Browser-standard UTF-8/base64 primitives, the public contract's canonical JSON and closed CryptoError assertions.
 * [OUTPUT]: Re-exports canonicalJson/hashCanonical from @bottega/contracts (no copy here), and bounded scalar-safe string/tuple validation.
 * [POS]: Allocation guard used by the pure envelope parsers before client crypto work.
 */
import { assertCrypto, CryptoError } from "./limits";
import { parseBase64url } from "./base64url";

export const utf8 = new TextEncoder();

/* canonicalJson/hashCanonical are the public contract's single implementation; this module keeps no copy. */
export { canonicalJson, hashCanonical } from "@bottega/contracts/core/canonical-json";
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function scalarCount(value: string): number {
  let count = 0;
  for (let i = 0; i < value.length; i++, count++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      assertCrypto(next >= 0xdc00 && next <= 0xdfff, "sync-password-invalid");
    } else assertCrypto(code < 0xdc00 || code > 0xdfff, "sync-password-invalid");
  }
  return count;
}

export function opaqueId(value: unknown): string {
  assertCrypto(typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value));
  return value;
}

export function tuple(value: unknown, size: number): unknown[] {
  assertCrypto(Array.isArray(value) && value.length === size);
  return value;
}

export function exactKeys(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  assertCrypto(value !== null && typeof value === "object" && !Array.isArray(value));
  const found = Object.keys(value);
  assertCrypto(found.length === keys.length && found.every(key => keys.includes(key)));
}

export { encodeBase64url } from "./base64url";

export function decodeBase64url(value: unknown, min: number, max = min): Uint8Array {
  const bytes = parseBase64url(value, min, max);
  assertCrypto(bytes);
  return bytes;
}

export function parseCanonical(input: Uint8Array, limit: number): unknown {
  assertCrypto(input instanceof Uint8Array && input.byteLength > 0 && input.byteLength <= limit);
  try {
    const text = decoder.decode(input), value: unknown = JSON.parse(text);
    assertCrypto(JSON.stringify(value) === text);
    return value;
  } catch { throw new CryptoError("sync-integrity-failed"); }
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let i = 0; i < a.byteLength; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
