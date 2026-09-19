/**
 * [INPUT]: Minimal WASM backend, shared canonical contracts and scalar-exact password encoding.
 * [OUTPUT]: Root wrapping and context-verified content operations with local key cleanup.
 * [POS]: Worker engine; random encryption freezes bytes for the existing outbox owner.
 */
import { assertCrypto, assertExpectedContext, assertExpectedScope, CryptoError, encodeBase64url,
  encodeEnvelope, encodeKeyPackage, ENCRYPTION_SUITE, ENCRYPTION_VERSION, envelopeAad, fingerprintKeyPackage, hashEnvelope,
  KDF_PARAMETERS, keyPackageAad, NONCE_BYTES, parseEnvelope, parseKeyPackage, PLAINTEXT_LIMITS, SALT_BYTES, scopeOf, VAULT_KEY_BYTES,
  type CryptoContext, type CryptoScope, type KeyPackageFingerprint, type VaultKeyPackage } from "@ai-chat/cloud-protocol/encryption";
import { encodePassword, validateNewPassword } from "../../password";
import type { CryptoBackend } from "./backend";

export interface UnlockedVault { scope: CryptoScope; key: Uint8Array; fingerprint: KeyPackageFingerprint }

export function createVault(backend: CryptoBackend, password: string, source: Pick<CryptoScope, "sourceEnvironment" | "sourceAccountId">): { vault: UnlockedVault; keyPackage: Uint8Array } {
  validateNewPassword(password);
  const passwordBytes = encodePassword(password);
  let kek: Uint8Array | undefined, root: Uint8Array | undefined;
  try {
    const opaque = () => encodeBase64url(backend.random(24));
    const scope: CryptoScope = { ...source, vaultId: `vault_${opaque()}`, keyId: `key_${opaque()}` };
    root = backend.random(VAULT_KEY_BYTES);
    const key: VaultKeyPackage = { version: 1, suite: ENCRYPTION_SUITE, scope, createOperationId: `create_${opaque()}`,
      kdf: { ...KDF_PARAMETERS, salt: backend.random(SALT_BYTES) }, nonce: backend.random(NONCE_BYTES), ciphertext: new Uint8Array(48) };
    const aad = keyPackageAad(key);
    kek = backend.derive(passwordBytes, key.kdf.salt);
    key.ciphertext = backend.encrypt(root, aad, key.nonce, kek);
    const keyPackage = encodeKeyPackage(key);
    const vault = { scope, key: root, fingerprint: fingerprintKeyPackage(keyPackage) };
    root = undefined;
    return { vault, keyPackage };
  } finally { passwordBytes.fill(0); kek?.fill(0); root?.fill(0); }
}

export function unlockVault(backend: CryptoBackend, password: string, keyPackage: Uint8Array, expectedScope: CryptoScope, expectedFingerprint: KeyPackageFingerprint | null): UnlockedVault {
  const key = parseKeyPackage(keyPackage), fingerprint = fingerprintKeyPackage(keyPackage);
  assertExpectedScope(key.scope, expectedScope);
  assertCrypto(expectedFingerprint === null || fingerprint === expectedFingerprint, "sync-space-changed");
  const passwordBytes = encodePassword(password);
  let kek: Uint8Array | undefined;
  try {
    kek = backend.derive(passwordBytes, key.kdf.salt);
    let root: Uint8Array;
    try { root = backend.decrypt(key.ciphertext, keyPackageAad(key), key.nonce, kek); }
    catch { throw new CryptoError("sync-unlock-failed"); }
    if (root.byteLength !== VAULT_KEY_BYTES) { root.fill(0); throw new CryptoError("sync-unlock-failed"); }
    return { scope: key.scope, key: root, fingerprint };
  } finally { passwordBytes.fill(0); kek?.fill(0); }
}

export function encryptContent(backend: CryptoBackend, vault: UnlockedVault, context: CryptoContext, plaintext: Uint8Array) {
  assertExpectedScope(vault.scope, scopeOf(context));
  const aad = envelopeAad(context);
  assertCrypto(plaintext instanceof Uint8Array && plaintext.byteLength <= PLAINTEXT_LIMITS[context.purpose]);
  const key = backend.subkey(vault.key, context.purpose);
  try {
    const nonce = backend.random(NONCE_BYTES), ciphertext = backend.encrypt(plaintext, aad, nonce, key);
    const envelope = encodeEnvelope({ version: ENCRYPTION_VERSION, suite: ENCRYPTION_SUITE, context, nonce, ciphertext });
    return { envelope, ciphertextHash: hashEnvelope(envelope) };
  } finally { key.fill(0); }
}

export function decryptContent(backend: CryptoBackend, vault: UnlockedVault, expectedContext: CryptoContext, bytes: Uint8Array): Uint8Array {
  const envelope = parseEnvelope(bytes);
  assertExpectedScope(vault.scope, scopeOf(expectedContext));
  assertExpectedContext(envelope.context, expectedContext);
  const key = backend.subkey(vault.key, expectedContext.purpose);
  try {
    try { return backend.decrypt(envelope.ciphertext, envelopeAad(expectedContext), envelope.nonce, key); }
    catch { throw new CryptoError("sync-integrity-failed"); }
  } finally { key.fill(0); }
}
