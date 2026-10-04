/**
 * [INPUT]: Depends on the pure envelope parser/hash, purpose-eight context constructor, canonical JSON and a content cipher port.
 * [OUTPUT]: Provides server-safe record validation plus client sealing and opening with independently rebuilt expected contexts.
 * [POS]: Account-config codec; the protocol never interprets the plaintext, callers validate their own closed schema.
 */
import { canonicalJson } from "../encryption/encoding";
import { assertCrypto, assertExpectedContext, assertExpectedScope, createAccountConfigContext, decodeBase64url, encodeBase64url,
  hashEnvelope, parseEnvelope, type CryptoScope } from "../encryption";
import type { FileCipherPort } from "../blobs/encrypted/model";
import { ACCOUNT_CONFIG_LIMITS, encryptedAccountConfigSchema, type AccountConfigIdentity, type EncryptedAccountConfig } from "./model";
type Frozen = Pick<EncryptedAccountConfig, "configKind" | "configId" | "configSchemaVersion" | "revision" | "operationId">;
/* AAD binds the scope, kind, id, schema version, operation and expectedRevision (= revision − 1). */
const context = (scope: CryptoScope, record: Frozen) => createAccountConfigContext(scope, record.configId, record.operationId,
  { configKind: record.configKind, configSchemaVersion: record.configSchemaVersion, expectedRevision: record.revision - 1 });
export function validateAccountConfig(input: EncryptedAccountConfig): EncryptedAccountConfig {
  const record = encryptedAccountConfigSchema.parse(input), bytes = decodeBase64url(record.packet.envelope, 1, ACCOUNT_CONFIG_LIMITS.envelopeBytes);
  assertCrypto(bytes.length === record.packet.ciphertextBytes && hashEnvelope(bytes) === record.packet.ciphertextHash);
  assertExpectedContext(parseEnvelope(bytes).context, context(record.encryptedSpace.scope, record));
  return record;
}
export async function sealAccountConfig(identity: Frozen, value: unknown, crypto: FileCipherPort, signal?: AbortSignal): Promise<EncryptedAccountConfig> {
  const plaintext = new TextEncoder().encode(canonicalJson(value));
  try {
    if (plaintext.byteLength > ACCOUNT_CONFIG_LIMITS.plaintextBytes) throw new Error("account-config-budget");
    const packet = await crypto.run({ kind: "encrypt", context: context(crypto.scope, identity), plaintext }, signal, { priority: "background" });
    assertCrypto(packet.kind === "encrypted");
    return validateAccountConfig({ ...identity, encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint },
      packet: { envelope: encodeBase64url(packet.envelope), ciphertextHash: packet.ciphertextHash, ciphertextBytes: packet.envelope.byteLength } });
  } finally { plaintext.fill(0); }
}
/**
 * The caller names the object it asked for; a valid same-space ciphertext of another kind or ID never satisfies it,
 * and the expected context is rebuilt from that request rather than copied from the envelope.
 */
export async function openAccountConfig(raw: EncryptedAccountConfig, expected: AccountConfigIdentity, crypto: FileCipherPort, signal?: AbortSignal): Promise<unknown> {
  const record = validateAccountConfig(raw);
  assertCrypto(record.configKind === expected.configKind && record.configId === expected.configId);
  assertExpectedScope(record.encryptedSpace.scope, crypto.scope);
  assertCrypto(record.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint);
  const expectedContext = context(crypto.scope, { ...record, configKind: expected.configKind, configId: expected.configId });
  const opened = await crypto.run({ kind: "decrypt", expectedContext, envelope: decodeBase64url(record.packet.envelope, 1, ACCOUNT_CONFIG_LIMITS.envelopeBytes) }, signal);
  assertCrypto(opened.kind === "decrypted");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(opened.plaintext)) as unknown; }
  catch { assertCrypto(false); }
  finally { opened.plaintext.fill(0); }
}
