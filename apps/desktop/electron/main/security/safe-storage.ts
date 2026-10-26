/**
 * [INPUT]: Electron safeStorage and the main-process noninteractive Keychain policy.
 * [OUTPUT]: secureStorage, a guarded synchronous/asynchronous native encryption port with no plaintext fallback.
 * [POS]: Shared cipher boundary for account credentials, sync keys and plugin recovery; storage owners retain their error and retry policies.
 */
import { safeStorage } from "electron";
import { protectKeychainAccess } from "./keychain";

function requireAccess() {
  if (!protectKeychainAccess()) throw new Error("SECURE_STORAGE_UNAVAILABLE");
}

export const secureStorage = {
  isEncryptionAvailable: () => protectKeychainAccess() && safeStorage.isEncryptionAvailable(),
  isAsyncEncryptionAvailable: async () => protectKeychainAccess() && await safeStorage.isAsyncEncryptionAvailable(),
  getSelectedStorageBackend: () => safeStorage.getSelectedStorageBackend(),
  encryptString(value: string) {
    requireAccess();
    return safeStorage.encryptString(value);
  },
  decryptString(value: Buffer) {
    requireAccess();
    return safeStorage.decryptString(value);
  },
  async encryptStringAsync(value: string) {
    requireAccess();
    return safeStorage.encryptStringAsync(value);
  },
  async decryptStringAsync(value: Buffer) {
    requireAccess();
    return safeStorage.decryptStringAsync(value);
  },
};
