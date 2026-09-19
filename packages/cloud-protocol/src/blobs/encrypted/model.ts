/**
 * [INPUT]: Fixed crypto envelope bounds, opaque identities and immutable encrypted-space schemas.
 * [OUTPUT]: Shared ciphertext manifest validation for reference reads, private descriptors and worker ports carrying scheduling priority.
 * [POS]: Shared file boundary; plaintext hash, MIME and size stay inside authenticated parent content.
 */
import { z } from "zod";
import { encryptedSpaceSchema } from "../../spaces";
import { blobDescriptorSchema, blobOwnerSchema, sha256Schema } from "../index";
import { MAX_BLOB_BYTES } from "../../config";
import { assertCrypto, createFileContext, createSkillGenerationContext, MAX_ENVELOPE_BYTES, type CryptoContext, type CryptoScope } from "../../encryption";
export const FILE_CHUNK_BYTES = 1_048_576;
export type CipherPriority = "foreground" | "background";
export const MAX_FILE_CHUNKS = Math.max(1, Math.ceil(MAX_BLOB_BYTES / FILE_CHUNK_BYTES));
export const MAX_CIPHERTEXT_FILE_BYTES = MAX_FILE_CHUNKS * MAX_ENVELOPE_BYTES;
const id = z.string().min(1).max(128);
export const encryptedFileIdentitySchema = z.object({ encryptedSpace: encryptedSpaceSchema,
  domain: z.literal("skill-generation").optional(), blobId: z.uuid(), owner: blobOwnerSchema, ownerGeneration: id.nullable(), manifestId: z.uuid(), operationId: id,
  chunkCount: z.number().int().min(1).max(MAX_FILE_CHUNKS) }).strict();
export const encryptedFilePartSchema = z.object({ partIndex: z.number().int().min(0).max(MAX_FILE_CHUNKS - 1),
  bytes: z.number().int().positive().max(MAX_ENVELOPE_BYTES), sha256: sha256Schema }).strict();
export const encryptedFileManifestSchema = encryptedFileIdentitySchema.extend({
  bytes: z.number().int().positive().max(MAX_CIPHERTEXT_FILE_BYTES), sha256: sha256Schema,
  parts: z.array(encryptedFilePartSchema).min(1).max(MAX_FILE_CHUNKS),
}).strict().refine(value => value.parts.length === value.chunkCount && value.parts.every((part, i) => part.partIndex === i) &&
  value.parts.reduce((total, part) => total + part.bytes, 0) === value.bytes);
export const encryptedFileDescriptorSchema = blobDescriptorSchema.extend({ encryption: encryptedFileManifestSchema }).strict()
  .refine(value => value.blobId === value.encryption.blobId && value.encryption.chunkCount === Math.max(1, Math.ceil(value.bytes / FILE_CHUNK_BYTES)));
export type EncryptedFileIdentity = z.infer<typeof encryptedFileIdentitySchema>;
export type EncryptedFilePart = z.infer<typeof encryptedFilePartSchema>;
export type EncryptedFileDescriptor = z.infer<typeof encryptedFileDescriptorSchema>;
export const ciphertextFileDescriptorSchema = z.object({ blobId: z.uuid(), sha256: sha256Schema,
  bytes: z.number().int().positive().max(MAX_CIPHERTEXT_FILE_BYTES), mime: z.literal("application/octet-stream"),
  encryption: encryptedFileIdentitySchema }).strict().refine(value => value.blobId === value.encryption.blobId);
export type CiphertextFileDescriptor = z.infer<typeof ciphertextFileDescriptorSchema>;
export interface FileCipherPort {
  scope: CryptoScope;
  keyPackageFingerprint: string;
  session: { userId: string; sessionId: string; deviceId: string };
  skillSlugKey?(normalizedSlug: string, signal?: AbortSignal): Promise<string>;
  run(command: { kind: "encrypt"; context: CryptoContext; plaintext: Uint8Array } |
    { kind: "decrypt"; expectedContext: CryptoContext; envelope: Uint8Array }, signal?: AbortSignal,
    options?: { priority?: CipherPriority }): Promise<
      { kind: "encrypted"; envelope: Uint8Array; ciphertextHash: string } | { kind: "decrypted"; plaintext: Uint8Array } |
      { kind: "status"; unlocked: boolean; scope: CryptoScope | null; evidence: unknown }>;
}

export const fileCipherContext = (identity: EncryptedFileIdentity, partIndex: number) => {
  if (identity.domain === "skill-generation") {
    assertCrypto(identity.owner.kind === "skill" && identity.ownerGeneration !== null);
    return createSkillGenerationContext(identity.encryptedSpace.scope, identity.ownerGeneration!, identity.operationId,
      { libraryId: identity.owner.id, generationId: identity.ownerGeneration!, blobId: identity.blobId,
        manifestId: identity.manifestId, chunkIndex: partIndex, chunkCount: identity.chunkCount });
  }
  return createFileContext(identity.encryptedSpace.scope, identity.blobId, identity.operationId,
    { ownerKind: identity.owner.kind, ownerId: identity.owner.id, ownerGeneration: identity.ownerGeneration,
      manifestId: identity.manifestId, chunkIndex: partIndex, chunkCount: identity.chunkCount });
};
