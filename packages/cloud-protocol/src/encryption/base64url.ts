/**
 * [INPUT]: Browser-standard btoa/atob only.
 * [OUTPUT]: encodeBase64url and parseBase64url: the product's one strict unpadded base64url (canonical form, bounded length; null on anything else).
 * [POS]: Import-free leaf. encoding.ts wraps it with its CryptoError and the Base GUI query kernel with its own refusal, so both share this tiny
 *        module without a query-only worker pulling encoding.ts (and its crypto limits) into a chunk shared with the crypto worker.
 */
export function encodeBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 16_384) binary += String.fromCharCode(...bytes.subarray(i, i + 16_384));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** The bytes of a canonical unpadded base64url string of `min`–`max` bytes, or null. */
export function parseBase64url(value: unknown, min: number, max = min): Uint8Array | null {
  if (typeof value !== "string" || value.length > Math.ceil(max * 4 / 3) || value.length % 4 === 1 || !/^[A-Za-z0-9_-]*$/.test(value)) return null;
  let binary: string;
  try { binary = atob(value.replaceAll("-", "+").replaceAll("_", "/")); } catch { return null; }
  if (binary.length < min || binary.length > max) return null;
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return encodeBase64url(bytes) === value ? bytes : null;
}
