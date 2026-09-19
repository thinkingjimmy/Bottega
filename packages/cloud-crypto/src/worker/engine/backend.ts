/**
 * [INPUT]: Exact libsodium-wrappers-sumo/libsodium-sumo 0.8.4 and runtime-checked native WASM function tables without DOM ambient types.
 * [OUTPUT]: A minimal crypto backend with completed-KDF WASM evidence and fixed derivation costs.
 * [POS]: Worker-only primitive boundary; raw sumo exports never reach business callers.
 */
import { assertCrypto, CryptoError, KDF_PARAMETERS, SALT_BYTES, SUBKEY_CONTEXT, VAULT_KEY_BYTES, type CryptoPurpose } from "@ai-chat/cloud-protocol/encryption";

export interface BackendEvidence {
  backend: "wasm";
  verification: "native-wasm-export";
  wrappersVersion: "0.8.4";
  rawVersion: "0.8.4";
  sodiumVersion: string;
  initializationMilliseconds: number;
  completedKdfCalls: number;
  lastKdfMilliseconds: number | null;
  heapBytes: number;
}

export interface CryptoBackend {
  random(length: number): Uint8Array;
  derive(password: Uint8Array, salt: Uint8Array): Uint8Array;
  subkey(rootKey: Uint8Array, purpose: CryptoPurpose): Uint8Array;
  authenticate(message: Uint8Array, key: Uint8Array): Uint8Array;
  encrypt(plaintext: Uint8Array, aad: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  decrypt(ciphertext: Uint8Array, aad: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  evidence(): BackendEvidence;
}

interface NativeWasmRuntime {
  Table: new (descriptor: { initial: number; element: "anyfunc" }) => { set(index: number, value: unknown): void; get(index: number): unknown };
}
function nativeWasm(): NativeWasmRuntime {
  const wasm = (globalThis as unknown as { WebAssembly?: NativeWasmRuntime }).WebAssembly;
  assertCrypto(wasm && typeof wasm === "object" && typeof wasm.Table === "function", "sync-encryption-unsupported");
  return wasm;
}

export function assertNativeWasmExport(value: unknown): asserts value is (...args: unknown[]) => unknown {
  try {
    assertCrypto(typeof value === "function", "sync-encryption-unsupported");
    // Native tables reject ordinary JavaScript functions. This checks the function
    // actually used by the wrapper, rather than the availability of WebAssembly.
    const table = new (nativeWasm().Table)({ initial: 1, element: "anyfunc" });
    table.set(0, value);
    assertCrypto(table.get(0) === value, "sync-encryption-unsupported");
  } catch { throw new CryptoError("sync-encryption-unsupported"); }
}

export async function loadWasmBackend(): Promise<CryptoBackend> {
  const started = performance.now();
  try {
    nativeWasm();
    const { default: sodium } = await import("libsodium-wrappers-sumo");
    await sodium.ready;
    const raw = (sodium as unknown as { libsodium: Record<string, unknown> }).libsodium;
    const required = ["_crypto_auth_hmacsha256", "_crypto_pwhash", "_crypto_kdf_derive_from_key", "_crypto_aead_xchacha20poly1305_ietf_encrypt", "_crypto_aead_xchacha20poly1305_ietf_decrypt"];
    for (const symbol of required) {
      const implementation = raw[symbol];
      assertNativeWasmExport(implementation);
      Object.defineProperty(raw, symbol, { value: implementation, writable: false, configurable: false });
    }
    assertCrypto(sodium.crypto_pwhash_ALG_ARGON2ID13 === 2 && sodium.crypto_pwhash_SALTBYTES === SALT_BYTES &&
      sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES === 32 && sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES === 24 &&
      sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES === 16 && sodium.crypto_kdf_CONTEXTBYTES === 8, "sync-encryption-unsupported");
    const initializationMilliseconds = performance.now() - started;
    let completedKdfCalls = 0, lastKdfMilliseconds: number | null = null;
    return {
      random: length => sodium.randombytes_buf(length),
      derive(password, salt) {
        assertCrypto(salt.byteLength === SALT_BYTES && password.byteLength <= 1024);
        assertNativeWasmExport(raw._crypto_pwhash);
        const start = performance.now();
        let derived: Uint8Array;
        try { derived = sodium.crypto_pwhash(VAULT_KEY_BYTES, password, salt, KDF_PARAMETERS.operations, KDF_PARAMETERS.memoryBytes, sodium.crypto_pwhash_ALG_ARGON2ID13); }
        catch { throw new CryptoError("sync-encryption-unsupported"); }
        completedKdfCalls++;
        lastKdfMilliseconds = performance.now() - start;
        return derived;
      },
      subkey: (rootKey, purpose) => sodium.crypto_kdf_derive_from_key(32, purpose, SUBKEY_CONTEXT, rootKey),
      authenticate: (message, key) => sodium.crypto_auth_hmacsha256(message, key),
      encrypt: (plaintext, aad, nonce, key) => sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, aad, null, nonce, key),
      decrypt: (ciphertext, aad, nonce, key) => sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, aad, nonce, key),
      evidence: () => ({ backend: "wasm", verification: "native-wasm-export", wrappersVersion: "0.8.4", rawVersion: "0.8.4",
        sodiumVersion: sodium.sodium_version_string(), initializationMilliseconds, completedKdfCalls, lastKdfMilliseconds,
        heapBytes: (raw.HEAPU8 as Uint8Array).buffer.byteLength }),
    };
  } catch { throw new CryptoError("sync-encryption-unsupported"); }
}
