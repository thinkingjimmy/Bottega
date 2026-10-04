/**
 * [INPUT]: Depends on the pure envelope parser/hash, the purpose-13 App build-status context, canonical JSON, a content cipher port and the
 *          build-status model.
 * [OUTPUT]: Provides validateAppBuildStatus (server-safe: AAD against the header, plaintext size from the ciphertext), sealAppBuildStatus
 *           (the owner desktop) and openAppBuildStatus (a reader that names the App it asked for).
 * [POS]: App build-status codec (U06-d). A row served under another App, owner or revision fails AEAD; a body that disagrees with its
 *        header's App is refused on open.
 */
import { canonicalJson } from "../../encryption/encoding";
import { assertCrypto, assertExpectedContext, assertExpectedScope, AUTH_TAG_BYTES, createAppBuildStatusContext, decodeBase64url, encodeBase64url, hashEnvelope,
  parseEnvelope, type CryptoScope } from "../../encryption";
import type { FileCipherPort } from "../../blobs/encrypted/model";
import { APP_BUILD_LIMITS, appBuildStatusSchema, encryptedAppBuildStatusSchema, type AppBuildStatus, type EncryptedAppBuildStatus } from "./model";

type Identity = Pick<EncryptedAppBuildStatus, "appId" | "ownerDeviceId" | "revision" | "operationId">;
const context = (scope: CryptoScope, r: Identity) =>
  createAppBuildStatusContext(scope, r.appId, r.operationId, { appId: r.appId, ownerDeviceId: r.ownerDeviceId, expectedRevision: r.revision - 1 });

export function validateAppBuildStatus(input: EncryptedAppBuildStatus) {
  const record = encryptedAppBuildStatusSchema.parse(input);
  const bytes = decodeBase64url(record.packet.envelope, 1, APP_BUILD_LIMITS.envelopeBytes);
  assertCrypto(bytes.length === record.packet.ciphertextBytes && hashEnvelope(bytes) === record.packet.ciphertextHash);
  const envelope = parseEnvelope(bytes);
  assertExpectedContext(envelope.context, context(record.encryptedSpace.scope, record));
  return { record, plaintextBytes: envelope.ciphertext.byteLength - AUTH_TAG_BYTES };
}
export async function sealAppBuildStatus(input: Omit<Identity, "appId"> & { status: AppBuildStatus }, crypto: FileCipherPort, signal?: AbortSignal): Promise<EncryptedAppBuildStatus> {
  const status = appBuildStatusSchema.parse(input.status);
  const identity = { appId: status.appId, ownerDeviceId: input.ownerDeviceId, revision: input.revision, operationId: input.operationId };
  const plaintext = new TextEncoder().encode(canonicalJson(status));
  try {
    if (plaintext.byteLength > APP_BUILD_LIMITS.plaintextBytes) throw new Error("app-build-status-budget");
    const sealed = await crypto.run({ kind: "encrypt", context: context(crypto.scope, identity), plaintext }, signal, { priority: "background" });
    assertCrypto(sealed.kind === "encrypted");
    return validateAppBuildStatus({ ...identity, encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint },
      packet: { envelope: encodeBase64url(sealed.envelope), ciphertextHash: sealed.ciphertextHash, ciphertextBytes: sealed.envelope.byteLength } }).record;
  } finally { plaintext.fill(0); }
}
/** The reader names the App it asked for; the row's header and its sealed body must both be that App's. */
export async function openAppBuildStatus(raw: EncryptedAppBuildStatus, expected: { appId: string }, crypto: FileCipherPort, signal?: AbortSignal): Promise<AppBuildStatus> {
  const { record } = validateAppBuildStatus(raw);
  assertCrypto(record.appId === expected.appId);
  assertExpectedScope(record.encryptedSpace.scope, crypto.scope);
  assertCrypto(record.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint);
  const opened = await crypto.run({ kind: "decrypt", expectedContext: context(crypto.scope, { ...record, appId: expected.appId }),
    envelope: decodeBase64url(record.packet.envelope, 1, APP_BUILD_LIMITS.envelopeBytes) }, signal);
  assertCrypto(opened.kind === "decrypted");
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(opened.plaintext)); }
  catch { assertCrypto(false); }
  finally { opened.plaintext.fill(0); }
  const status = appBuildStatusSchema.safeParse(value);
  assertCrypto(status.success && status.data.appId === expected.appId);
  return (status as { data: AppBuildStatus }).data;
}
