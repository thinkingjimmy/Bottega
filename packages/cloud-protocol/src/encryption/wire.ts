/**
 * [INPUT]: Noble SHA-256, canonical tuples and strict encrypted synchronization bounds.
 * [OUTPUT]: Canonical envelope/key-package bytes, AAD and separately typed ciphertext identities.
 * [POS]: Server-safe wire format; contains no decryption, password derivation or secrets.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { contextTuple, parseContextTuple, parseScopeTuple, scopeTuple } from "./context";
import { assertCrypto } from "./limits";
import { decodeBase64url, encodeBase64url, exactKeys, opaqueId, parseCanonical, tuple, utf8 } from "./encoding";
import { AUTH_TAG_BYTES, ENCRYPTION_SUITE, ENCRYPTION_VERSION, KEY_PACKAGE_VERSION, KDF_PARAMETERS, MAX_ENVELOPE_BYTES, MAX_KEY_PACKAGE_BYTES, NONCE_BYTES, PLAINTEXT_LIMITS, SALT_BYTES, VAULT_KEY_BYTES } from "./limits";
import type { CipherEnvelope, CiphertextHash, CryptoContext, KeyPackageFingerprint, VaultKeyPackage } from "./model";

function suite(version: unknown, algorithm: unknown, expectedVersion: number): void {
  assertCrypto(version === expectedVersion && algorithm === ENCRYPTION_SUITE, "sync-encryption-unsupported");
}

function validateBytes(value: unknown, min: number, max = min): asserts value is Uint8Array {
  assertCrypto(value instanceof Uint8Array && value.byteLength >= min && value.byteLength <= max);
}

export function envelopeAad(context: CryptoContext): Uint8Array {
  return utf8.encode(JSON.stringify([ENCRYPTION_VERSION, "bottega-sync-payload", ENCRYPTION_SUITE, contextTuple(context)]));
}

export function encodeEnvelope(envelope: CipherEnvelope): Uint8Array {
  exactKeys(envelope, ["version", "suite", "context", "nonce", "ciphertext"]);
  suite(envelope.version, envelope.suite, ENCRYPTION_VERSION);
  const context = contextTuple(envelope.context);
  validateBytes(envelope.nonce, NONCE_BYTES);
  validateBytes(envelope.ciphertext, AUTH_TAG_BYTES, PLAINTEXT_LIMITS[envelope.context.purpose] + AUTH_TAG_BYTES);
  const bytes = utf8.encode(JSON.stringify([ENCRYPTION_VERSION, "bottega-sync-payload", ENCRYPTION_SUITE, context, encodeBase64url(envelope.nonce), encodeBase64url(envelope.ciphertext)]));
  assertCrypto(bytes.byteLength <= MAX_ENVELOPE_BYTES);
  return bytes;
}

export function parseEnvelope(bytes: Uint8Array): CipherEnvelope {
  const t = tuple(parseCanonical(bytes, MAX_ENVELOPE_BYTES), 6);
  suite(t[0], t[2], ENCRYPTION_VERSION);
  assertCrypto(t[1] === "bottega-sync-payload");
  const context = parseContextTuple(t[3]);
  return { version: ENCRYPTION_VERSION, suite: ENCRYPTION_SUITE, context, nonce: decodeBase64url(t[4], NONCE_BYTES),
    ciphertext: decodeBase64url(t[5], AUTH_TAG_BYTES, PLAINTEXT_LIMITS[context.purpose] + AUTH_TAG_BYTES) };
}

function keyHeader(key: VaultKeyPackage): unknown[] {
  exactKeys(key, ["version", "suite", "scope", "createOperationId", "kdf", "nonce", "ciphertext"]);
  suite(key.version, key.suite, KEY_PACKAGE_VERSION);
  exactKeys(key.kdf, ["algorithm", "operations", "memoryBytes", "keyBytes", "salt"]);
  const { algorithm, operations, memoryBytes, keyBytes, salt } = key.kdf;
  assertCrypto(algorithm === KDF_PARAMETERS.algorithm && operations === 3 && memoryBytes === 67108864 && keyBytes === 32, "sync-encryption-unsupported");
  validateBytes(salt, SALT_BYTES);
  validateBytes(key.nonce, NONCE_BYTES);
  validateBytes(key.ciphertext, VAULT_KEY_BYTES + AUTH_TAG_BYTES);
  return [1, "bottega-sync-key", ENCRYPTION_SUITE, scopeTuple(key.scope), opaqueId(key.createOperationId),
    [algorithm, operations, memoryBytes, keyBytes, encodeBase64url(salt)]];
}

export const keyPackageAad = (key: VaultKeyPackage): Uint8Array => utf8.encode(JSON.stringify(keyHeader(key)));

export function encodeKeyPackage(key: VaultKeyPackage): Uint8Array {
  const bytes = utf8.encode(JSON.stringify([...keyHeader(key), encodeBase64url(key.nonce), encodeBase64url(key.ciphertext)]));
  assertCrypto(bytes.byteLength <= MAX_KEY_PACKAGE_BYTES);
  return bytes;
}

export function parseKeyPackage(bytes: Uint8Array): VaultKeyPackage {
  const t = tuple(parseCanonical(bytes, MAX_KEY_PACKAGE_BYTES), 8);
  suite(t[0], t[2], KEY_PACKAGE_VERSION);
  assertCrypto(t[1] === "bottega-sync-key");
  const kdf = tuple(t[5], 5);
  assertCrypto(kdf[0] === KDF_PARAMETERS.algorithm && kdf[1] === 3 && kdf[2] === 67108864 && kdf[3] === 32, "sync-encryption-unsupported");
  const key: VaultKeyPackage = { version: 1, suite: ENCRYPTION_SUITE, scope: parseScopeTuple(t[3]), createOperationId: opaqueId(t[4]),
    kdf: { ...KDF_PARAMETERS, salt: decodeBase64url(kdf[4], SALT_BYTES) }, nonce: decodeBase64url(t[6], NONCE_BYTES),
    ciphertext: decodeBase64url(t[7], VAULT_KEY_BYTES + AUTH_TAG_BYTES) };
  keyHeader(key);
  return key;
}

export function hashEnvelope(bytes: Uint8Array): CiphertextHash {
  parseEnvelope(bytes);
  return bytesToHex(sha256(bytes)) as CiphertextHash;
}

export function fingerprintKeyPackage(bytes: Uint8Array): KeyPackageFingerprint {
  parseKeyPackage(bytes);
  return bytesToHex(sha256(bytes)) as KeyPackageFingerprint;
}
