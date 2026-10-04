/**
 * [INPUT]: Depends on the pure envelope parser/hash, the purpose-nine context constructor, canonical JSON and a content cipher port.
 * [OUTPUT]: Provides server-safe record validation (returning the plaintext size measured from the ciphertext), client sealing, tombstones and request-bound opening.
 * [POS]: Agent-configuration codec; the server learns sizes without trusting the client and never sees plaintext.
 */
import { canonicalJson } from "../encryption/encoding";
import { assertCrypto, assertExpectedContext, assertExpectedScope, AUTH_TAG_BYTES, createAgentConfigurationContext, decodeBase64url, encodeBase64url,
  hashEnvelope, parseEnvelope, type CryptoScope } from "../encryption";
import type { FileCipherPort } from "../blobs/encrypted/model";
import { AGENT_CONFIG_LIMITS, encryptedAgentConfigSchema, type EncryptedAgentConfig } from "./model";
type Frozen = Pick<EncryptedAgentConfig, "configId" | "configSchemaVersion" | "revision" | "operationId" | "producerClass">;
/* AAD binds the scope, config ID, schema version, operation, expected revision (= revision − 1) and producer class. */
const context = (scope: CryptoScope, record: Frozen) => createAgentConfigurationContext(scope, record.configId, record.operationId,
  { configSchemaVersion: record.configSchemaVersion, expectedRevision: record.revision - 1, producerClass: record.producerClass });

/** Validates a record and measures it: plaintext bytes come from the authenticated ciphertext length, stored bytes from the packet. */
export function validateAgentConfig(input: EncryptedAgentConfig): { record: EncryptedAgentConfig; plaintextBytes: number; storedBytes: number } {
  const record = encryptedAgentConfigSchema.parse(input);
  if (!record.packet) return { record, plaintextBytes: 0, storedBytes: 0 };
  const bytes = decodeBase64url(record.packet.envelope, 1, AGENT_CONFIG_LIMITS.envelopeBytes);
  assertCrypto(bytes.length === record.packet.ciphertextBytes && hashEnvelope(bytes) === record.packet.ciphertextHash);
  const envelope = parseEnvelope(bytes);
  assertExpectedContext(envelope.context, context(record.encryptedSpace.scope, record));
  return { record, plaintextBytes: envelope.ciphertext.byteLength - AUTH_TAG_BYTES, storedBytes: record.packet.envelope.length };
}
export async function sealAgentConfig(identity: Frozen, value: unknown, crypto: FileCipherPort, signal?: AbortSignal): Promise<EncryptedAgentConfig> {
  const plaintext = new TextEncoder().encode(canonicalJson(value));
  try {
    if (plaintext.byteLength > AGENT_CONFIG_LIMITS.plaintextBytes) throw new Error("agent-config-budget");
    const packet = await crypto.run({ kind: "encrypt", context: context(crypto.scope, identity), plaintext }, signal, { priority: "background" });
    assertCrypto(packet.kind === "encrypted");
    return validateAgentConfig({ ...identity, encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint },
      packet: { envelope: encodeBase64url(packet.envelope), ciphertextHash: packet.ciphertextHash, ciphertextBytes: packet.envelope.byteLength } }).record;
  } finally { plaintext.fill(0); }
}
/** Deleting writes a tombstone: a new revision with no ciphertext, so "absent" never has to mean "deleted". */
export const agentConfigTombstone = (identity: Frozen, crypto: Pick<FileCipherPort, "scope" | "keyPackageFingerprint">): EncryptedAgentConfig =>
  encryptedAgentConfigSchema.parse({ ...identity, encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint }, packet: null });
/** The caller names the config it asked for; a valid same-space ciphertext of another config never satisfies it. */
export async function openAgentConfig(raw: EncryptedAgentConfig, expected: { configId: string }, crypto: FileCipherPort, signal?: AbortSignal): Promise<unknown> {
  const { record } = validateAgentConfig(raw);
  assertCrypto(record.configId === expected.configId && record.packet !== null);
  assertExpectedScope(record.encryptedSpace.scope, crypto.scope);
  assertCrypto(record.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint);
  const expectedContext = context(crypto.scope, { ...record, configId: expected.configId });
  const opened = await crypto.run({ kind: "decrypt", expectedContext, envelope: decodeBase64url(record.packet!.envelope, 1, AGENT_CONFIG_LIMITS.envelopeBytes) }, signal);
  assertCrypto(opened.kind === "decrypted");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(opened.plaintext)) as unknown; }
  catch { assertCrypto(false); }
  finally { opened.plaintext.fill(0); }
}
