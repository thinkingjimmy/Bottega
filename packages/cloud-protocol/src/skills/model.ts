/**
 * [INPUT]: Closed crypto scope, ciphertext file manifests and normalized Skill identities.
 * [OUTPUT]: Encrypted Skill heads, immutable generations and bounded private content contracts.
 * [POS]: Shared Skills synchronization contract; readable names and file paths never enter public DTOs.
 */
import { z } from "zod";
import { id, version, digest } from "../encryption/domains/scalars";
import { encryptedSpaceSchema } from "../spaces";
import { encryptedFileDescriptorSchema, encryptedFileManifestSchema } from "../blobs/encrypted/model";
import { skillSlugSchema, skillObjectIdSchema as objectId } from "./identity";
export const SKILL_LIMITS = Object.freeze({ files: 10_000, bytes: 50 * 1024 * 1024, manifestBytes: 16 * 1024 * 1024, page: 16 });
export const skillPacketSchema = z.object({ envelope: z.string().min(1).max(93_000).regex(/^[A-Za-z0-9_-]+$/),
  ciphertextHash: digest, ciphertextBytes: version.positive().max(69_700) }).strict();
export const encryptedSkillHeadSchema = z.object({ libraryId: objectId, operationId: id, encryptedSpace: encryptedSpaceSchema,
  slugKey: digest, revision: version.positive(), activeGenerationDigest: digest.nullable(), tombstone: z.boolean(), packet: skillPacketSchema }).strict();
export const skillFactsSchema = z.object({ version: z.literal(1), slug: skillSlugSchema, displayName: z.string().min(1).max(256),
  description: z.string().max(16_384), sourceDeviceId: id.optional(), requires: z.string().max(4096).optional(), enabled: z.boolean(),
  activeGenerationId: objectId.nullable(), tombstoneAt: version.nullable() }).strict();
export const skillReceiptSchema = z.object({ operationId: id, ciphertextHash: digest,
  status: z.enum(["applied", "conflicted", "deleted", "slug-conflict"]), head: encryptedSkillHeadSchema }).strict();
export const skillGenerationSchema = z.object({ libraryId: objectId, generationId: objectId, manifestBlobId: z.uuid(),
  fileCount: version.positive().max(SKILL_LIMITS.files), byteSize: version.max(SKILL_LIMITS.bytes),
  state: z.enum(["preparing", "ready", "deleting"]) }).strict();
export const remoteSkillGenerationSchema = skillGenerationSchema.extend({ manifest: encryptedFileManifestSchema.nullable() }).strict();
const relativePath = z.string().min(1).max(2048).refine(value => !value.includes("\\") && !value.includes("\0") &&
  !value.startsWith("/") && !value.split("/").some(part => part === ".." || part === "." || !part));
export const skillManifestSchema = z.object({ version: z.literal(1), libraryId: objectId, generationId: objectId, digest,
  importedAt: version, files: z.array(z.object({ path: relativePath, file: encryptedFileDescriptorSchema, executable: z.boolean() }).strict())
    .min(1).max(SKILL_LIMITS.files) }).strict().refine(value => new Set(value.files.map(file => file.path)).size === value.files.length &&
      value.files.some(file => file.path === "SKILL.md") && value.files.reduce((total, file) => total + file.file.bytes, 0) <= SKILL_LIMITS.bytes &&
      value.files.every(({ file }) => file.encryption.owner.kind === "skill" && file.encryption.owner.id === value.libraryId &&
        file.encryption.ownerGeneration === value.generationId && !file.encryption.domain));
export type EncryptedSkillHead = z.infer<typeof encryptedSkillHeadSchema>;
export type SkillFacts = z.infer<typeof skillFactsSchema>;
export type SkillReceipt = z.infer<typeof skillReceiptSchema>;
export type SkillManifest = z.infer<typeof skillManifestSchema>;
export type RemoteSkillGeneration = z.infer<typeof remoteSkillGenerationSchema>;
