/**
 * [INPUT]: Original frozen Home content, admitted workers and fully authenticated private file manifests.
 * [OUTPUT]: Exact ciphertext preparation and native manifests/receipts after integrity validation.
 * [POS]: Client Home codec; original source hashes remain local or inside encrypted payloads.
 */
import { canonicalJson } from "../../../encryption/encoding";
import { assertCrypto, encodeBase64url, type CryptoContext } from "../../../encryption";
import { ciphertextFileDescriptor } from "../../../blobs/encrypted/transport";
import type { EncryptedFileDescriptor, FileCipherPort } from "../../../blobs/encrypted/model";
import { hashChatContent } from "../../transcript/body";
import { homeEntrySchema, homeManifestSchema, homePageSchema, homeReceiptSchema, hashHomePage, type HomeManifest, type HomeEntry } from "../model";
import { encryptedHomeReceiptSchema, privateHomeEntrySchema, privateHomeManifestSchema, type HomeCipherIdentity, type EncryptedHomeEntry,
  type EncryptedHomeManifest, type EncryptedHomeReceipt } from "./model";
import { frozenHomeEntrySchema, frozenHomeManifestSchema, frozenHomePageSchema, type FrozenHomeEntry, type FrozenHomeManifest, type FrozenHomePage } from "./journal";
import { homeEntryContext, homeManifestContext, homeCipherIdentity, hashHomeCiphertext, EMPTY_HOME_CIPHER_DIGEST,
  extendHomeCipherDigest, verifyHomeEntry, verifyHomeManifest, verifyHomePacket, verifyHomePage } from "./wire";
const space = (port: FileCipherPort) => ({ scope: port.scope, keyPackageFingerprint: port.keyPackageFingerprint });
async function seal(port: FileCipherPort, context: CryptoContext, value: unknown, signal?: AbortSignal) {
  const plaintext = new TextEncoder().encode(canonicalJson(value));
  try {
    assertCrypto(plaintext.byteLength <= 16_384);
    const result = await port.run({ kind: "encrypt", context, plaintext }, signal); assertCrypto(result.kind === "encrypted");
    return { envelope: encodeBase64url(result.envelope), ciphertextHash: result.ciphertextHash, ciphertextBytes: result.envelope.byteLength };
  } finally { plaintext.fill(0); }
}
async function open(port: FileCipherPort, context: CryptoContext, packet: EncryptedHomeEntry["packet"], signal?: AbortSignal) {
  const envelope = verifyHomePacket(packet, context), result = await port.run({ kind: "decrypt", expectedContext: context, envelope }, signal);
  assertCrypto(result.kind === "decrypted");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result.plaintext)) as unknown; }
  finally { result.plaintext.fill(0); }
}
function privateEntry(identity: HomeCipherIdentity, entry: HomeEntry, file: EncryptedFileDescriptor | null, port: FileCipherPort) {
  const value = privateHomeEntrySchema.parse({ entry, file });
  if (value.entry.kind === "file") {
    assertCrypto(value.file !== null && value.file.sha256 === value.entry.blob.sha256 && value.file.bytes === value.entry.blob.bytes &&
      value.file.mime === value.entry.blob.mime && value.file.encryption.owner.kind === "chat" && value.file.encryption.owner.id === identity.chatId &&
      value.file.encryption.ownerGeneration === identity.incarnationId && canonicalJson(value.file.encryption.encryptedSpace) === canonicalJson(space(port)));
  } else assertCrypto(value.file === null);
  return value;
}
export async function prepareHomeEntry(port: FileCipherPort, identity: HomeCipherIdentity, ordinal: number, operationId: string,
  raw: HomeEntry, file: EncryptedFileDescriptor | null, signal?: AbortSignal): Promise<FrozenHomeEntry> {
  const entry = homeEntrySchema.parse(raw), payload = privateEntry(identity, entry, file, port);
  const metadata = { ordinal, operationId, file: file ? ciphertextFileDescriptor(file) : null };
  const encrypted = verifyHomeEntry(port.scope, identity, { ...metadata, packet: await seal(port, homeEntryContext(port.scope, identity, metadata), payload, signal) });
  return frozenHomeEntrySchema.parse({ kind: "encrypted-home-entry", plaintextHash: hashChatContent(entry), encryptedSpace: space(port), identity, entry: encrypted });
}
export async function openHomeEntry(port: FileCipherPort, identity: HomeCipherIdentity, raw: EncryptedHomeEntry, signal?: AbortSignal) {
  const entry = verifyHomeEntry(port.scope, identity, raw), { packet, ...metadata } = entry;
  const payload = privateHomeEntrySchema.parse(await open(port, homeEntryContext(port.scope, identity, metadata), packet, signal));
  const value = privateEntry(identity, payload.entry, payload.file, port);
  assertCrypto(canonicalJson(value.file ? ciphertextFileDescriptor(value.file) : null) === canonicalJson(entry.file)); return value;
}
export async function prepareHomeManifest(port: FileCipherPort, raw: HomeManifest, entries: readonly FrozenHomeEntry[], signal?: AbortSignal): Promise<FrozenHomeManifest> {
  const manifest = homeManifestSchema.parse(raw), identity = homeCipherIdentity(manifest);
  assertCrypto(entries.length === manifest.entryCount && entries.every((entry, ordinal) => entry.entry.ordinal === ordinal &&
    canonicalJson(entry.identity) === canonicalJson(identity) && canonicalJson(entry.encryptedSpace) === canonicalJson(space(port))));
  const metadata = { ...identity, bytes: entries.reduce((sum, entry) => sum + entry.entry.packet.ciphertextBytes + (entry.entry.file?.bytes ?? 0), 0),
    omittedCount: entries.filter(entry => entry.entry.file === null).length, digest: entries.reduce((digest, value) => extendHomeCipherDigest(digest, value.entry), EMPTY_HOME_CIPHER_DIGEST) };
  assertCrypto(metadata.omittedCount === manifest.omittedCount);
  const plaintextHash = hashChatContent(manifest), packet = await seal(port, homeManifestContext(port.scope, metadata), { manifest, plaintextHash }, signal);
  const value = { ...metadata, packet }, encrypted = verifyHomeManifest(port.scope, { ...value, ciphertextHash: hashHomeCiphertext(value) });
  return frozenHomeManifestSchema.parse({ kind: "encrypted-home-manifest", plaintextHash, encryptedSpace: space(port), manifest: encrypted });
}
export async function openHomeManifest(port: FileCipherPort, raw: EncryptedHomeManifest, signal?: AbortSignal) {
  const value = verifyHomeManifest(port.scope, raw), { packet, ciphertextHash: _hash, ...metadata } = value;
  const payload = privateHomeManifestSchema.parse(await open(port, homeManifestContext(port.scope, metadata), packet, signal));
  assertCrypto(payload.plaintextHash === hashChatContent(payload.manifest) && canonicalJson(homeCipherIdentity(payload.manifest)) === canonicalJson(homeCipherIdentity(value)) &&
    payload.manifest.omittedCount === value.omittedCount); return payload.manifest;
}
export function prepareHomePage(port: FileCipherPort, manifest: HomeManifest, raw: Parameters<typeof hashHomePage>[0], entries: readonly FrozenHomeEntry[]): FrozenHomePage {
  const operation = homePageSchema.parse(raw), identity = homeCipherIdentity(manifest);
  assertCrypto(hashHomePage(operation) === operation.payloadHash && operation.chatId === manifest.chatId && operation.incarnationId === manifest.incarnationId &&
    operation.snapshotId === manifest.snapshotId && entries.length === operation.entries.length &&
    entries.every((entry, index) => entry.entry.ordinal === operation.offset + index && entry.entry.operationId === operation.operationId &&
      entry.plaintextHash === hashChatContent(operation.entries[index]) && canonicalJson(entry.identity) === canonicalJson(identity) &&
      canonicalJson(entry.encryptedSpace) === canonicalJson(space(port))));
  const body = { ...identity, operationId: operation.operationId, offset: operation.offset, entries: entries.map(entry => entry.entry) };
  const encrypted = verifyHomePage(port.scope, { ...body, ciphertextHash: hashHomeCiphertext(body) });
  return frozenHomePageSchema.parse({ kind: "encrypted-home-page", plaintextHash: operation.payloadHash, encryptedSpace: space(port), operation: encrypted });
}
export function openHomeReceipt(raw: EncryptedHomeReceipt, frozen: FrozenHomePage) {
  const receipt = encryptedHomeReceiptSchema.parse(raw), { operation } = frozen;
  assertCrypto(receipt.chatId === operation.chatId && receipt.snapshotId === operation.snapshotId && receipt.operationId === operation.operationId &&
    receipt.ciphertextHash === operation.ciphertextHash && receipt.receivedCount === operation.offset + operation.entries.length &&
    receipt.state === (receipt.receivedCount === operation.entryCount ? "ready" : "receiving"));
  const { ciphertextHash: _hash, ...rest } = receipt; return homeReceiptSchema.parse({ ...rest, payloadHash: frozen.plaintextHash });
}
