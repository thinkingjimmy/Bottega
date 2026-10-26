/**
 * [INPUT]: The built macOS Security/Node-API policy beside the main entry and Node's native module loader.
 * [OUTPUT]: protectKeychainAccess(), which disables and verifies Keychain UI before native cipher access.
 * [POS]: Main-process credential guard; missing native code blocks storage while local startup remains available.
 */
import { createRequire } from "node:module";
import { join } from "node:path";

interface KeychainPolicy { disableInteraction(): boolean }
let policy: KeychainPolicy | null | undefined;

export function protectKeychainAccess(): boolean {
  if (process.platform !== "darwin") return true;
  try {
    if (policy === undefined) policy = createRequire(__filename)(join(__dirname, "keychain-policy.node")) as KeychainPolicy;
    return policy?.disableInteraction() === true;
  } catch {
    policy = null;
    return false;
  }
}
