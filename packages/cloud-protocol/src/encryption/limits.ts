/**
 * [INPUT]: The encrypted sync candidate protocol and its disjoint subkey purposes (seven ciphertext purposes plus the purpose-seven HMAC key).
 * [OUTPUT]: Immutable algorithm/allocation bounds and safe closed failure codes.
 * [POS]: Server-safe limits checked before base64 decoding, KDF or decryption.
 */
import type { CryptoPurpose } from "./model";

export const ENCRYPTION_VERSION = 2 as const;
export const KEY_PACKAGE_VERSION = 1 as const;
export const ENCRYPTION_SUITE = "xchacha20poly1305-ietf" as const;
export const KDF_PARAMETERS = Object.freeze({ algorithm: "argon2id13", operations: 3, memoryBytes: 67108864, keyBytes: 32 } as const);
export const SUBKEY_CONTEXT = "BTSYNC01";
export const NONCE_BYTES = 24;
export const AUTH_TAG_BYTES = 16;
export const SALT_BYTES = 16;
export const VAULT_KEY_BYTES = 32;
export const MAX_KEY_PACKAGE_BYTES = 4096;
export const MAX_CONTEXT_BYTES = 4096;
export const MAX_ENVELOPE_BYTES = 1_405_952;
export const MAX_CHUNKS = 16_384;
export const PLAINTEXT_LIMITS: Readonly<Record<CryptoPurpose, number>> = Object.freeze({
  1: 65_536,
  2: 262_144,
  3: 1_048_576,
  4: 131_072,
  5: 65_536,
  6: 1_048_576,
  7: 0, // Reserved for Skill identity HMAC; no ciphertext context uses this key.
  /* Account configuration (the Dock layout). The whole record, its ciphertext and the base64url packet must stay far below
     Convex's 1 MiB document limit: 384 KiB of plaintext becomes a ~705,000-character packet. */
  8: 393_216,
});

export const CRYPTO_ERROR_CODES = [
  "sync-password-invalid", "sync-password-weak", "sync-unlock-failed", "sync-integrity-failed", "sync-encryption-unsupported",
  "sync-space-changed", "sync-operation-cancelled", "sync-operation-busy", "sync-locked",
] as const;
export type CryptoErrorCode = typeof CRYPTO_ERROR_CODES[number];

export class CryptoError extends Error {
  constructor(readonly code: CryptoErrorCode) { super(code); this.name = "CryptoError"; }
}

export function cryptoFailure(error: unknown): CryptoErrorCode {
  return error instanceof CryptoError ? error.code : "sync-encryption-unsupported";
}

export function assertCrypto(condition: unknown, code: CryptoErrorCode = "sync-integrity-failed"): asserts condition {
  if (!condition) throw new CryptoError(code);
}
