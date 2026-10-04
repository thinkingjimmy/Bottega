/**
 * [INPUT]: Closed original message membership and ordered ciphertext-block descriptors.
 * [OUTPUT]: Per-message manifest/block bindings and exact immutable original-time commitments.
 * [POS]: Range-read integrity; imported versions never use upload time or plaintext hashes as identities.
 */
import { z } from "zod";
import { commitment, digest, id, nullableId, version } from "./scalars";
export const messageMembershipSchema = z.object({ chatId: id, incarnationId: id, messageId: id, versionId: id,
  source: z.enum(["native", "imported"]), generationId: nullableId, seq: version.positive(), messageRole: z.enum(["user", "assistant", "system"]),
  originalCreatedAt: version.nullable(), timeState: z.enum(["valid", "missing", "invalid"]), manifestId: id }).strict()
  .refine(value => (value.source === "native") === (value.generationId === null) && (value.timeState === "valid") === (value.originalCreatedAt !== null));
const messageBlockMetadataSchema = z.object({ blockId: id, index: version.max(16_383), ciphertextHash: digest, ciphertextBytes: version.positive().max(98_304) }).strict();
export const messageManifestMetadataSchema = z.object({ membership: messageMembershipSchema,
  blockOffset: version, blockCount: version.positive().max(16_384), blocks: z.array(messageBlockMetadataSchema).min(1).max(64) }).strict()
  .refine(value => value.blockOffset + value.blocks.length <= value.blockCount && value.blocks.every((block, index) => block.index === value.blockOffset + index) &&
    new Set(value.blocks.map(block => block.blockId)).size === value.blocks.length);
export const messageBindingSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("manifest"), membership: messageMembershipSchema, blockCount: version.positive().max(16_384), pageIndex: version,
    pageCount: version.positive().max(256), metadataCommitment: digest }).strict().refine(value => value.pageIndex < value.pageCount),
  z.object({ role: z.literal("block"), membership: messageMembershipSchema, blockId: id, blockIndex: version,
    blockCount: version.positive().max(16_384) }).strict().refine(value => value.blockIndex < value.blockCount),
]);
export const hashMessageManifestMetadata = (value: z.input<typeof messageManifestMetadataSchema>) => commitment("message-manifest", messageManifestMetadataSchema, value);
