/**
 * [INPUT]: Exact native file or page identity and stable SHA-256.
 * [OUTPUT]: Deterministic host metadata identifiers without changing native source.
 * [POS]: Shared scalar for Canvas and Slides source projection.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
export const nativeSourceId = (prefix: string, value: string) => prefix + bytesToHex(sha256(new TextEncoder().encode(value))).slice(0, 24);
