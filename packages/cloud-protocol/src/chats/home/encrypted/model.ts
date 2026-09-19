/**
 * [INPUT]: Closed original Home identities, opaque file references and immutable encrypted-space scopes.
 * [OUTPUT]: Bounded encrypted entries, manifests, page commits and ciphertext-only receipts.
 * [POS]: Server-safe Home transport; paths, MIME, omission reasons and original hashes stay private.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../../../auth";
import { sha256Schema as hash } from "../../../blobs";
import { ciphertextFileDescriptorSchema, encryptedFileDescriptorSchema } from "../../../blobs/encrypted/model";
import { versionSchema as rev } from "../../../scalars";
import { homeEntrySchema, homeManifestSchema, MAX_HOME_ENTRIES } from "../model";
export const HOME_CIPHER_LIMITS = { packetBytes: 24_576, requestBytes: 786_432, snapshotBytes: 512_000_000 } as const;
const homePacketSchema = z.object({ envelope: z.string().min(1).max(32_768).regex(/^[A-Za-z0-9_-]+$/),
  ciphertextHash: hash, ciphertextBytes: rev.positive().max(HOME_CIPHER_LIMITS.packetBytes) }).strict();
export const homeCipherIdentitySchema = z.object(homeManifestSchema.shape).pick({ chatId: true, incarnationId: true, executionEpoch: true,
  snapshotId: true, throughSeq: true, expectedSnapshotId: true, entryCount: true }).extend({ throughSeq: rev });
export const encryptedHomeEntrySchema = z.object({ ordinal: rev.max(MAX_HOME_ENTRIES - 1), operationId: id,
  packet: homePacketSchema, file: ciphertextFileDescriptorSchema.nullable() }).strict();
export const homeCipherManifestMetadataSchema = homeCipherIdentitySchema.extend({
  bytes: rev.max(HOME_CIPHER_LIMITS.snapshotBytes), omittedCount: rev.max(MAX_HOME_ENTRIES), digest: hash,
}).strict().refine(value => value.omittedCount <= value.entryCount);
export const encryptedHomeManifestSchema = homeCipherManifestMetadataSchema.safeExtend({ packet: homePacketSchema, ciphertextHash: hash }).strict();
export const homeCipherEntryMetadataSchema = z.object({ ordinal: rev.max(MAX_HOME_ENTRIES - 1), operationId: id,
  file: ciphertextFileDescriptorSchema.nullable() }).strict();
export const encryptedHomePageSchema = homeCipherIdentitySchema.extend({ operationId: id, offset: rev.max(MAX_HOME_ENTRIES - 1),
  entries: z.array(encryptedHomeEntrySchema).min(1).max(50), ciphertextHash: hash }).strict();
export const encryptedHomeStatusSchema = z.object({ manifest: encryptedHomeManifestSchema, state: z.enum(["receiving", "ready", "superseded"]),
  receivedCount: rev.max(MAX_HOME_ENTRIES), receivedDigest: hash, bytes: rev.max(HOME_CIPHER_LIMITS.snapshotBytes), omittedCount: rev.max(MAX_HOME_ENTRIES) }).strict();
export const encryptedHomeReceiptSchema = z.object({ chatId: id, snapshotId: id, operationId: id, ciphertextHash: hash, sourceDeviceId: id,
  receivedCount: rev.max(MAX_HOME_ENTRIES), state: z.enum(["receiving", "ready"]), createdAt: rev }).strict();
export const privateHomeEntrySchema = z.object({ entry: homeEntrySchema, file: encryptedFileDescriptorSchema.nullable() }).strict();
export const privateHomeManifestSchema = z.object({ manifest: homeManifestSchema, plaintextHash: hash }).strict();
export type HomeCipherIdentity = z.infer<typeof homeCipherIdentitySchema>;
export type EncryptedHomeEntry = z.infer<typeof encryptedHomeEntrySchema>;
export type EncryptedHomeManifest = z.infer<typeof encryptedHomeManifestSchema>;
export type EncryptedHomePage = z.infer<typeof encryptedHomePageSchema>;
export type EncryptedHomeReceipt = z.infer<typeof encryptedHomeReceiptSchema>;
