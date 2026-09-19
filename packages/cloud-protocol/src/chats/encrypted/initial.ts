/**
 * [INPUT]: Original initialization identities, bounded proof packets and named Chat AAD.
 * [OUTPUT]: Defines encrypted initial manifests/pages, immutable receipt mappings and receiving/resetting/ready publication status.
 * [POS]: Native initialization wire boundary; domain plaintext digests stay inside authenticated proofs.
 */
import { z } from "zod";
import { encryptedSpaceSchema } from "../../spaces";
import { assertCrypto, assertExpectedContext, createChatContext, decodeBase64url, hashEnvelope, parseEnvelope, type CryptoScope } from "../../encryption";
import { sha256Schema as hash } from "../../blobs";
import { hashChatContent } from "../transcript/body";
import { chatInitialManifestSchema, chatInitialPageSchema, chatInitialReceiptSchema, chatInitialStatusSchema } from "../transcript/initial";
import { messagePacketSchema } from "./messages/model";
export const encryptedInitialManifestSchema = chatInitialManifestSchema.safeExtend({ proof: messagePacketSchema }).strict();
export const encryptedInitialPageSchema = chatInitialPageSchema.omit({ payloadHash: true }).extend({ proof: messagePacketSchema, ciphertextHash: hash }).strict();
export const encryptedInitialStatusSchema = chatInitialStatusSchema.omit({ payloadHash: true }).extend({ ciphertextHash: hash, state: z.enum(["receiving", "ready", "resetting"]) }).strict();
export const encryptedInitialReceiptSchema = chatInitialReceiptSchema.omit({ payloadHash: true }).extend({ ciphertextHash: hash, commit: encryptedInitialPageSchema }).strict();
export const frozenInitialManifestSchema = z.object({ kind: z.literal("encrypted-native-manifest"), plaintextHash: hash,
  encryptedSpace: encryptedSpaceSchema, transport: encryptedInitialManifestSchema }).strict();
export const frozenInitialPageSchema = z.object({ kind: z.literal("encrypted-native-page"), plaintextHash: hash,
  encryptedSpace: encryptedSpaceSchema, transport: encryptedInitialPageSchema }).strict();
export type EncryptedInitialManifest = z.infer<typeof encryptedInitialManifestSchema>;
export type EncryptedInitialPage = z.infer<typeof encryptedInitialPageSchema>;
export function initialContext(scope: CryptoScope, raw: EncryptedInitialManifest | EncryptedInitialPage) {
  const page = "operationId" in raw, value = page ? encryptedInitialPageSchema.parse(raw) : encryptedInitialManifestSchema.parse(raw);
  const { proof: _proof, ...rest } = value;
  const metadata = "ciphertextHash" in rest ? (({ ciphertextHash: _hash, ...binding }) => binding)(rest) : rest;
  return createChatContext(scope, value.chatId, page ? (raw as EncryptedInitialPage).operationId : value.manifestId,
    { role: "initial", incarnationId: value.incarnationId, expectedRevision: value.executionEpoch,
      metadataCommitment: hashChatContent([page ? "native-initial-page-v1" : "native-initial-manifest-v1", metadata]) });
}
export function validateInitialPacket(scope: CryptoScope, value: EncryptedInitialManifest | EncryptedInitialPage) {
  const packet = value.proof, bytes = decodeBase64url(packet.envelope, 1, 98_304);
  assertCrypto(bytes.byteLength === packet.ciphertextBytes && hashEnvelope(bytes) === packet.ciphertextHash);
  assertExpectedContext(parseEnvelope(bytes).context, initialContext(scope, value)); return bytes;
}
export function hashEncryptedInitialPage(raw: EncryptedInitialPage) {
  const { ciphertextHash: _hash, ...value } = encryptedInitialPageSchema.parse(raw); return hashChatContent(value);
}
