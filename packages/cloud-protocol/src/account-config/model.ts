/**
 * [INPUT]: Depends on Zod, the closed encryption scalars, purpose-eight plaintext bound and immutable encrypted-space descriptors.
 * [OUTPUT]: Provides the closed `dock-layout` account-config identity, byte budgets, the encrypted CAS record, its receipt and the watched revision.
 * [POS]: Shared account-config contract; the server sees only kind/id/schema version/revision/operation/hash/size, never the layout.
 */
import { z } from "zod";
import { digest, id, version } from "../encryption/domains/scalars";
import { PLAINTEXT_LIMITS } from "../encryption/limits";
import { encryptedSpaceSchema } from "../spaces";
/* One Dock layout per account, so its identity is a constant rather than a minted ID: every installation of the
   account converges on the same row without first discovering it. */
export const DOCK_LAYOUT_CONFIG_ID = "dock-layout:default" as const;
export const ACCOUNT_CONFIG_KINDS = ["dock-layout"] as const;
export const accountConfigKindSchema = z.enum(ACCOUNT_CONFIG_KINDS);
export const accountConfigIdSchema = z.enum([DOCK_LAYOUT_CONFIG_ID]);
export type AccountConfigKind = z.infer<typeof accountConfigKindSchema>;
/* Plaintext ≤ 384 KiB; the envelope carries base64url ciphertext plus a ≤ 4 KiB context; the packet is base64url of
   the envelope bytes. Every bound keeps a record and its receipt below Convex's 1 MiB document limit. */
const plaintextBytes = PLAINTEXT_LIMITS[8];
const envelopeBytes = 532_480;
export const ACCOUNT_CONFIG_LIMITS = Object.freeze({ plaintextBytes, envelopeBytes, packetChars: Math.ceil(envelopeBytes * 4 / 3) });
export const accountConfigPacketSchema = z.object({ envelope: z.string().min(1).max(ACCOUNT_CONFIG_LIMITS.packetChars).regex(/^[A-Za-z0-9_-]+$/),
  ciphertextHash: digest, ciphertextBytes: version.positive().max(envelopeBytes) }).strict();
export const accountConfigIdentitySchema = z.object({ configKind: accountConfigKindSchema, configId: accountConfigIdSchema }).strict();
/* The server admits any positive schema version so a newer client can publish a layout an older one keeps verbatim. */
export const encryptedAccountConfigSchema = z.object({ configId: accountConfigIdSchema, configKind: accountConfigKindSchema,
  configSchemaVersion: version.positive().max(65_535), revision: version.positive(), operationId: id, encryptedSpace: encryptedSpaceSchema,
  packet: accountConfigPacketSchema }).strict();
/* `head` is the submitted record when applied, and the current record (or null when none exists) when conflicted. */
export const accountConfigReceiptSchema = z.object({ operationId: id, ciphertextHash: digest, status: z.enum(["applied", "conflicted"]),
  head: encryptedAccountConfigSchema.nullable() }).strict().refine(value => value.status === "conflicted" || value.head !== null);
export const accountConfigRevisionSchema = z.object({ revision: version }).strict();
export type EncryptedAccountConfig = z.infer<typeof encryptedAccountConfigSchema>;
export type AccountConfigReceipt = z.infer<typeof accountConfigReceiptSchema>;
export type AccountConfigIdentity = z.infer<typeof accountConfigIdentitySchema>;
