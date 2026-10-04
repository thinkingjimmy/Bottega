/**
 * [INPUT]: Original import lifecycle identities, message ciphertext and fixed generation limits.
 * [OUTPUT]: Closed encrypted generation manifests/pages and immutable original-outbox hash mappings.
 * [POS]: Public imported-history wire model; source text, preview, paths and plaintext hashes are private.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../../../auth";
import { versionSchema as rev } from "../../../scalars";
import { sha256Schema as hash } from "../../../blobs";
import { encryptedSpaceSchema } from "../../../spaces";
import { createChatContext, assertCrypto, assertExpectedContext, decodeBase64url, hashEnvelope, parseEnvelope, type CryptoScope } from "../../../encryption";
import { importManifestSchema, importReceiptSchema } from "../model";
import { hashChatContent } from "../../transcript/body";
import { encryptedMessageSchema, messagePacketSchema, type EncryptedMessage } from "../../encrypted/messages";
export const encryptedImportManifestSchema = importManifestSchema.omit({ sourceKind: true, incompleteTail: true }).extend({ proof: messagePacketSchema }).strict();
export const encryptedImportStatusSchema = z.object({ manifest: encryptedImportManifestSchema, state: z.enum(["receiving", "ready", "superseded"]),
  receivedCount: rev, receivedDigest: hash, receivedBytes: rev, revision: rev }).strict();
export const encryptedImportPageSchema = z.object({ chatId: id, incarnationId: id, generationId: id,
  operationId: id, ciphertextHash: hash, offset: rev, entries: z.array(encryptedMessageSchema).min(1).max(32) }).strict();
export const encryptedImportReceiptSchema = importReceiptSchema.omit({ payloadHash: true }).extend({ ciphertextHash: hash }).strict();
export const encryptedImportIntentSchema = z.object({ kind: z.literal("encrypted-import-intent"), userId: id, chatId: id, incarnationId: id,
  expectedRevision: rev, generationId: z.uuid() }).strict();
export const frozenImportManifestSchema = z.object({ kind: z.literal("encrypted-import-manifest"), plaintextHash: hash, encryptedSpace: encryptedSpaceSchema,
  transport: encryptedImportManifestSchema }).strict();
export const frozenImportPageSchema = z.object({ kind: z.literal("encrypted-import-page"), plaintextHash: hash, transport: encryptedImportPageSchema }).strict();
export const encryptedImportCheckpoints = [encryptedImportIntentSchema, frozenImportManifestSchema, frozenImportPageSchema] as const;
export type EncryptedImportManifest = z.infer<typeof encryptedImportManifestSchema>;
export type EncryptedImportStatus = z.infer<typeof encryptedImportStatusSchema>;
type EncryptedImportPage = z.infer<typeof encryptedImportPageSchema>;
export function importManifestContext(scope: CryptoScope, raw: EncryptedImportManifest) {
  const { proof: _proof, ...metadata } = encryptedImportManifestSchema.parse(raw);
  return createChatContext(scope, metadata.chatId, metadata.generationId, { role: "initial", incarnationId: metadata.incarnationId,
    expectedRevision: metadata.expectedRevision, metadataCommitment: hashChatContent(["encrypted-import-manifest-v1", metadata]) });
}
export function validateImportManifest(scope: CryptoScope, raw: EncryptedImportManifest) {
  const value = encryptedImportManifestSchema.parse(raw), bytes = decodeBase64url(value.proof.envelope, 1, 98_304);
  assertCrypto(bytes.byteLength === value.proof.ciphertextBytes && hashEnvelope(bytes) === value.proof.ciphertextHash);
  assertExpectedContext(parseEnvelope(bytes).context, importManifestContext(scope, value)); return value;
}
export const hashEncryptedImportPage = (raw: EncryptedImportPage) => { const { ciphertextHash: _hash, ...value } = encryptedImportPageSchema.parse(raw); return hashChatContent(value); };
export const importCipherEntryBytes = (message: EncryptedMessage) => message.pages.reduce((bytes, page) => bytes + page.ciphertextBytes +
  page.metadata.blocks.reduce((sum, block) => sum + block.ciphertextBytes, 0) + page.publication.references.reduce((sum, file) => sum + file.bytes, 0), 0);
export const extendImportCipherDigest = (previous: string, message: EncryptedMessage) => hashChatContent([previous, message.membership.seq, message.membership.versionId, message.bodyHash]);
