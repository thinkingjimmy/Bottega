/**
 * [INPUT]: Closed Home metadata, named domain contexts and exact canonical envelope bytes.
 * [OUTPUT]: Ciphertext identity/digest checks and authenticated generation/ordinal/file commitments.
 * [POS]: Shared content-blind Home verification; semantic path validation remains client-side.
 */
import { canonicalJson } from "../../../encryption/encoding";
import { hashCanonical } from "../../../encryption/encoding";
import { assertCrypto, assertExpectedContext, createHomeContext, decodeBase64url, hashEnvelope, parseEnvelope, type CryptoContext, type CryptoScope } from "../../../encryption";
import { homeCipherEntryMetadataSchema, homeCipherManifestMetadataSchema, homeCipherIdentitySchema, encryptedHomeManifestSchema, encryptedHomePageSchema,
  encryptedHomeEntrySchema, HOME_CIPHER_LIMITS, type HomeCipherIdentity, type EncryptedHomeEntry, type EncryptedHomeManifest, type EncryptedHomePage } from "./model";
export const hashHomeCiphertext = hashCanonical;
export const EMPTY_HOME_CIPHER_DIGEST = hashHomeCiphertext(["bottega.home-cipher/v1"]);
export const extendHomeCipherDigest = (previous: string, entry: EncryptedHomeEntry) => hashHomeCiphertext([previous, entry]);
export function homeCipherIdentity(value: HomeCipherIdentity) {
  return homeCipherIdentitySchema.parse(Object.fromEntries(Object.keys(homeCipherIdentitySchema.shape).map(key => [key, value[key as keyof HomeCipherIdentity]])));
}
export function homeManifestContext(scope: CryptoScope, value: Omit<EncryptedHomeManifest, "packet" | "ciphertextHash">) {
  const metadata = homeCipherManifestMetadataSchema.parse(value);
  return createHomeContext(scope, value.chatId, value.snapshotId, { role: "manifest", incarnationId: value.incarnationId,
    snapshotId: value.snapshotId, executionEpoch: value.executionEpoch, throughSeq: value.throughSeq, expectedSnapshotId: value.expectedSnapshotId,
    pageIndex: null, pageCount: Math.max(1, value.entryCount), metadataCommitment: hashHomeCiphertext(metadata) });
}
export function homeEntryContext(scope: CryptoScope, identity: HomeCipherIdentity, entry: Pick<EncryptedHomeEntry, "ordinal" | "operationId" | "file">) {
  const metadata = homeCipherEntryMetadataSchema.parse(entry);
  return createHomeContext(scope, identity.chatId, entry.operationId, { role: "page", incarnationId: identity.incarnationId,
    snapshotId: identity.snapshotId, executionEpoch: identity.executionEpoch, throughSeq: identity.throughSeq, expectedSnapshotId: identity.expectedSnapshotId,
    pageIndex: entry.ordinal, pageCount: Math.max(1, identity.entryCount), metadataCommitment: hashHomeCiphertext(metadata) });
}
export function verifyHomePacket(packet: EncryptedHomeEntry["packet"], context: CryptoContext) {
  const bytes = decodeBase64url(packet.envelope, 1, HOME_CIPHER_LIMITS.packetBytes);
  assertCrypto(bytes.byteLength === packet.ciphertextBytes && hashEnvelope(bytes) === packet.ciphertextHash);
  assertExpectedContext(parseEnvelope(bytes).context, context); return bytes;
}
export function verifyHomeEntry(scope: CryptoScope, identity: HomeCipherIdentity, raw: EncryptedHomeEntry) {
  const entry = encryptedHomeEntrySchema.parse(raw); assertCrypto(entry.ordinal < identity.entryCount);
  const { packet, ...metadata } = entry; verifyHomePacket(packet, homeEntryContext(scope, identity, metadata));
  if (entry.file) assertCrypto(entry.file.encryption.owner.kind === "chat" && entry.file.encryption.owner.id === identity.chatId &&
    entry.file.encryption.ownerGeneration === identity.incarnationId && canonicalJson(entry.file.encryption.encryptedSpace.scope) === canonicalJson(scope));
  return entry;
}
export function verifyHomeManifest(scope: CryptoScope, raw: EncryptedHomeManifest) {
  const value = encryptedHomeManifestSchema.parse(raw), { packet, ciphertextHash, ...metadata } = value;
  assertCrypto(hashHomeCiphertext({ ...metadata, packet }) === ciphertextHash);
  verifyHomePacket(packet, homeManifestContext(scope, metadata));
  if (!value.entryCount) assertCrypto(value.digest === EMPTY_HOME_CIPHER_DIGEST && value.bytes === 0 && value.omittedCount === 0);
  return value;
}
export function verifyHomePage(scope: CryptoScope, raw: EncryptedHomePage) {
  const page = encryptedHomePageSchema.parse(raw), { ciphertextHash, ...body } = page;
  assertCrypto(new TextEncoder().encode(canonicalJson(page)).byteLength <= HOME_CIPHER_LIMITS.requestBytes &&
    hashHomeCiphertext(body) === ciphertextHash && page.offset + page.entries.length <= page.entryCount);
  for (const [index, entry] of page.entries.entries()) {
    assertCrypto(entry.ordinal === page.offset + index && entry.operationId === page.operationId); verifyHomeEntry(scope, homeCipherIdentity(page), entry);
  }
  return page;
}
