/**
 * [INPUT]: Depends on @noble/hashes SHA-256 and hex encoding only.
 * [OUTPUT]: Provides canonicalJson (object keys sorted by UTF-16 code unit, `undefined` members dropped, no whitespace) and hashCanonical (hex SHA-256 of its UTF-8 bytes).
 * [POS]: The single implementation behind every operation ID, commitment and E2EE content hash; the private encryption layer re-exports it and keeps no copy. The byte vectors in tests/canonical/canonical-json.test.ts pin its output.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const utf8 = new TextEncoder();

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
