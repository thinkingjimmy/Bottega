/**
 * [INPUT]: Type-only closed domain binding definitions.
 * [OUTPUT]: Closed source scopes, eight subkey purposes, authenticated contexts, envelopes and distinct hash types.
 * [POS]: Server-safe encryption contract shared with the isolated client crypto package.
 */

import type { DomainContext } from "./domains";
export type CryptoPurpose = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface CryptoScope {
  sourceEnvironment: string;
  sourceAccountId: string;
  vaultId: string;
  keyId: string;
}

export type CryptoContext = DomainContext;

export interface CipherEnvelope {
  version: 2;
  suite: "xchacha20poly1305-ietf";
  context: CryptoContext;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

export interface VaultKeyPackage {
  version: 1;
  suite: "xchacha20poly1305-ietf";
  scope: CryptoScope;
  createOperationId: string;
  kdf: { algorithm: "argon2id13"; operations: 3; memoryBytes: 67108864; keyBytes: 32; salt: Uint8Array };
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

declare const ciphertextHash: unique symbol;
declare const keyPackageFingerprint: unique symbol;
export type CiphertextHash = string & { readonly [ciphertextHash]: true };
export type KeyPackageFingerprint = string & { readonly [keyPackageFingerprint]: true };
