/**
 * [INPUT]: Closed worker jobs, pure canonical parsers and cheap scalar password validation.
 * [OUTPUT]: Complete bounded preflight before worker message copying or WASM initialization.
 * [POS]: Shared owner/worker admission guard; never loads the cryptographic backend.
 */
import { assertCrypto, assertExpectedScope, contextTuple, fingerprintKeyPackage, MAX_ENVELOPE_BYTES, MAX_KEY_PACKAGE_BYTES,
  parseKeyPackage, PLAINTEXT_LIMITS, scopeTuple, VAULT_KEY_BYTES } from "@ai-chat/cloud-protocol/encryption";
import { skillSlugSchema } from "@ai-chat/cloud-protocol/skills/identity";
import { validatePassword, validateNewPassword } from "../password";
import type { CryptoCommand } from "./model";

const keys: Record<CryptoCommand["kind"], readonly string[]> = {
  "skill-slug-key": ["kind", "expectedScope", "normalizedSlug"],
  create: ["kind", "password", "source"], unlock: ["kind", "password", "keyPackage", "expectedScope", "expectedFingerprint"],
  encrypt: ["kind", "context", "plaintext"], decrypt: ["kind", "expectedContext", "envelope"], status: ["kind"], lock: ["kind"],
  "export-local-key": ["kind", "expectedScope", "expectedFingerprint"],
  "import-local-key": ["kind", "expectedScope", "expectedFingerprint", "keyPackage", "rootKey"],
};

export function validateCryptoCommand(command: CryptoCommand): void {
  assertCrypto(command !== null && typeof command === "object" && Object.hasOwn(keys, command.kind));
  const allowed = keys[command.kind];
  assertCrypto(Object.keys(command).length === allowed.length && Object.keys(command).every(key => allowed.includes(key)));
  if (command.kind === "skill-slug-key") { scopeTuple(command.expectedScope); assertCrypto(skillSlugSchema.safeParse(command.normalizedSlug).success); }
  if (command.kind === "create") validateNewPassword(command.password);
  if (command.kind === "unlock") validatePassword(command.password);
  if (command.kind === "create") {
    assertCrypto(command.source !== null && typeof command.source === "object" && Object.keys(command.source).length === 2 &&
      Object.keys(command.source).every(key => key === "sourceEnvironment" || key === "sourceAccountId"));
    scopeTuple({ ...command.source, vaultId: "preflight-vault", keyId: "preflight-key" });
  }
  if (command.kind === "unlock" || command.kind === "import-local-key" || command.kind === "export-local-key") {
    scopeTuple(command.expectedScope);
    assertCrypto((command.kind === "unlock" && command.expectedFingerprint === null) ||
      typeof command.expectedFingerprint === "string" && /^[a-f0-9]{64}$/.test(command.expectedFingerprint));
  }
  if (command.kind === "unlock" || command.kind === "import-local-key") {
    assertCrypto(command.keyPackage instanceof Uint8Array && command.keyPackage.byteLength <= MAX_KEY_PACKAGE_BYTES);
    const key = parseKeyPackage(command.keyPackage);
    assertExpectedScope(key.scope, command.expectedScope);
    assertCrypto(command.expectedFingerprint === null || fingerprintKeyPackage(command.keyPackage) === command.expectedFingerprint, "sync-space-changed");
  }
  if (command.kind === "import-local-key") assertCrypto(command.rootKey instanceof Uint8Array && command.rootKey.byteLength === VAULT_KEY_BYTES);
  if (command.kind === "decrypt") {
    assertCrypto(command.envelope instanceof Uint8Array && command.envelope.byteLength <= MAX_ENVELOPE_BYTES);
    contextTuple(command.expectedContext);
  }
  if (command.kind === "encrypt") {
    contextTuple(command.context);
    assertCrypto(command.plaintext instanceof Uint8Array && command.plaintext.byteLength <= PLAINTEXT_LIMITS[command.context.purpose]);
  }
}
