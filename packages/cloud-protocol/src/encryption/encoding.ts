/**
 * [INPUT]: Browser-standard UTF-8/base64 primitives, @noble SHA-256 and closed CryptoError assertions.
 * [OUTPUT]: Canonical JSON, the single canonical-value digest, and bounded scalar-safe string/tuple validation.
 * [POS]: Allocation guard used by the pure envelope parsers before client crypto work.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { assertCrypto, CryptoError } from "./limits";

export const utf8 = new TextEncoder();

/** Deterministic JSON: object keys sorted, `undefined` members dropped, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const result = JSON.stringify(value); if (result === undefined) throw new Error("Values must be JSON"); return result;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}
/** The one digest every operation ID, commitment and content hash is derived from. */
export const hashCanonical = (value: unknown) => bytesToHex(sha256(utf8.encode(canonicalJson(value))));
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

export function integer(value: unknown, nullable = false): number | null {
  if (nullable && value === null) return null;
  assertCrypto(typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0));
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

export function encodeBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 16_384) binary += String.fromCharCode(...bytes.subarray(i, i + 16_384));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeBase64url(value: unknown, min: number, max = min): Uint8Array {
  assertCrypto(typeof value === "string" && value.length <= Math.ceil(max * 4 / 3) && value.length % 4 !== 1 && /^[A-Za-z0-9_-]*$/.test(value));
  let binary: string;
  try { binary = atob(value.replaceAll("-", "+").replaceAll("_", "/")); } catch { throw new CryptoError("sync-integrity-failed"); }
  assertCrypto(binary.length >= min && binary.length <= max);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  assertCrypto(encodeBase64url(bytes) === value);
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
