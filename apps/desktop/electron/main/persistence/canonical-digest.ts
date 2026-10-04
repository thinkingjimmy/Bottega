/**
 * [INPUT]: Depends on the protocol canonicalJson (@ai-chat/cloud-protocol/encryption) and Node crypto
 * [OUTPUT]: Provides canonicalText and canonicalSha256Hex, the one locale-independent form every main-process digest is minted from; digests an older build wrote with localeCompare are never recomputed
 * [POS]: Main-process digest leaf shared by Memory receipts, the history snapshot store, the manual MCP store and Base read cursors; nothing may sort keys by locale again
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "@ai-chat/cloud-protocol/encryption";

/**
 * JSON first round-trips through JSON.stringify so `toJSON`, `undefined` members and `undefined` array items
 * behave exactly as they did for the digests this replaces; key order is then UTF-16 code units, never locale.
 */
export function canonicalText(value: unknown): string {
  const plain = JSON.stringify(value);
  return plain === undefined ? "null" : canonicalJson(JSON.parse(plain));
}

export const canonicalSha256Hex = (value: unknown) => createHash("sha256").update(canonicalText(value)).digest("hex");
