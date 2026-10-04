/**
 * [INPUT]: Depends on Zod, the shared cloud limits, encryption scalars/limits and the encrypted-space schema.
 * [OUTPUT]: Provides the Agent-configuration budgets (plaintext and stored), the encrypted record (a null packet is a tombstone), head, directory, heads page and record-free receipt.
 * [POS]: Agent-configuration domain model (protocol 11, purpose 9); the protocol never interprets the plaintext, TASK-12 owns its schema.
 */
import { z } from "zod";
import { CLOUD_LIMITS } from "../config";
import { digest, id, version } from "../encryption/domains/scalars";
import { PLAINTEXT_LIMITS } from "../encryption/limits";
import { encryptedSpaceSchema } from "../spaces";
/* Plaintext is capped by purpose 9 itself; the envelope carries base64url ciphertext plus a ≤ 8 KiB context, and the packet is
   base64url of the envelope bytes, so stored characters are bounded per record and, through the count, per account. */
const plaintextBytes = PLAINTEXT_LIMITS[9];
const envelopeBytes = Math.ceil(plaintextBytes * 4 / 3) + 8_192;
const packetChars = Math.ceil(envelopeBytes * 4 / 3);
export const AGENT_CONFIG_LIMITS = Object.freeze({ plaintextBytes, envelopeBytes, packetChars,
  perAccount: CLOUD_LIMITS.agentConfigsPerAccount, totalPlaintextBytes: CLOUD_LIMITS.agentConfigTotalBytes,
  totalStoredBytes: CLOUD_LIMITS.agentConfigsPerAccount * packetChars,
  pageHeads: CLOUD_LIMITS.directoryPageHeads, pageBytes: CLOUD_LIMITS.directoryPageBytes, headBytes: CLOUD_LIMITS.headBytes });
/* `desktop` records may be enabled for execution; a phone or browser only ever writes `draft`, and the class is in the AAD. */
export const producerClassSchema = z.enum(["desktop", "draft"]);
export const agentConfigPacketSchema = z.object({ envelope: z.string().min(1).max(packetChars).regex(/^[A-Za-z0-9_-]+$/),
  ciphertextHash: digest, ciphertextBytes: version.positive().max(envelopeBytes) }).strict();
export const encryptedAgentConfigSchema = z.object({ configId: id, configSchemaVersion: version.positive().max(65_535), revision: version.positive(),
  operationId: id, producerClass: producerClassSchema, encryptedSpace: encryptedSpaceSchema, packet: agentConfigPacketSchema.nullable() }).strict();
/* A head is what every subscription reads: no text, no payload, ≤ 1 KiB. "Row absent" never means deleted: a tombstone does. */
export const agentConfigHeadSchema = z.object({ configId: id, configSchemaVersion: version.positive(), revision: version.positive(),
  ciphertextHash: digest.nullable(), plaintextBytes: version, storedBytes: version, writerDeviceId: id, producerClass: producerClassSchema,
  tombstone: z.boolean(), updatedAt: version }).strict().refine(value => value.tombstone === (value.ciphertextHash === null));
export const agentConfigDirectorySchema = z.object({ revision: version, count: version, totalPlaintextBytes: version, totalStoredBytes: version }).strict();
export const agentConfigHeadsPageSchema = z.object({ items: z.array(agentConfigHeadSchema).max(AGENT_CONFIG_LIMITS.pageHeads),
  cursor: z.string().max(2048).nullable(), complete: z.boolean() }).strict();
export const agentConfigReceiptSchema = z.discriminatedUnion("status", [
  z.object({ operationId: id, status: z.literal("applied"), revision: version.positive() }).strict(),
  z.object({ operationId: id, status: z.literal("conflicted"),
    current: z.object({ revision: version.positive(), ciphertextHash: digest.nullable(), tombstone: z.boolean() }).strict().nullable() }).strict(),
]);
export type EncryptedAgentConfig = z.infer<typeof encryptedAgentConfigSchema>;
export type AgentConfigHead = z.infer<typeof agentConfigHeadSchema>;
export type AgentConfigReceipt = z.infer<typeof agentConfigReceiptSchema>;
export type ProducerClass = z.infer<typeof producerClassSchema>;
