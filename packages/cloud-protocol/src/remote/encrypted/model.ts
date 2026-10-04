/**
 * [INPUT]: Closed remote states, routing identities and encrypted-space headers.
 * [OUTPUT]: Bounded ciphertext commands, catalog-sized capabilities and live or content-free retired creation receipts.
 * [POS]: Server-safe remote boundary; command text, Agent defaults and submission hashes remain encrypted.
 */
import { isRemoteWorkspaceQuery } from "../input/references";
import { isRemoteTurnKind } from "../model";
import { isQueueControl } from "../queue";
import { z } from "zod";
import { cloudIdSchema as id, deviceNameSchema } from "../../auth";
import { versionSchema as rev } from "../../scalars";
import { sha256Schema as hash } from "../../blobs";
import { protocolHeaderSchema } from "../../config";
import { encryptedSpaceSchema } from "../../spaces";
import { agentBackendIdSchema } from "../../chats/options";
import { remoteCommandBindingSchema, remoteCreationBindingSchema, remoteCreationTargetSchema } from "../../encryption/domains/streams";
import { remoteStateSchema, remoteReasonSchema, remoteBlockedBySchema, remoteTargetSchema, REMOTE_LIMITS } from "../model";
export const REMOTE_CIPHER_LIMITS = { packetBytes: 196_608, capabilityBytes: 32_768, capabilityPlaintextBytes: 16_384,
  pageBytes: 1_048_576, pageItems: 4 } as const;
export const remotePacketSchema = z.object({ envelope: z.string().min(1).max(262_144).regex(/^[A-Za-z0-9_-]+$/), ciphertextHash: hash,
  ciphertextBytes: rev.positive().max(REMOTE_CIPHER_LIMITS.packetBytes) }).strict();
export const remoteCommandHeaderSchema = z.object({ ...protocolHeaderSchema.shape, ...remoteCommandBindingSchema.shape, commandId: id, interactionId: z.string().min(1).max(256).nullable(),
  intent: z.object({ expiresAt: rev.positive(), creation: z.uuid().optional() }).strict().optional(), backend: agentBackendIdSchema.nullable() }).strict().refine(value =>
    (value.kind === "respond-approval" || value.kind === "respond-user-input") === (value.interactionId !== null) &&
    (isRemoteTurnKind(value.kind) || value.backend === null) && (isRemoteTurnKind(value.kind) || isRemoteWorkspaceQuery(value.kind) || isQueueControl(value.kind) || value.kind === "fork-chat") === (value.requestId === null));
export const encryptedRemoteCommandSchema = z.object({ ...remoteCommandHeaderSchema.shape, packet: remotePacketSchema,
  ciphertextHash: hash }).strict().refine(value => remoteCommandHeaderSchema.safeParse((({ packet: _packet, ciphertextHash: _hash, ...header }) => header)(value)).success);
const publicRemoteAdmissionSchema = z.object({ intentId: id, requestId: z.string().min(1).max(256), userMessageId: id.nullable() }).strict();
export const encryptedRemoteReportSchema = z.object({ revision: rev.positive(), state: remoteStateSchema.exclude(["pending", "awaiting-preparation", "delivered"]),
  admission: publicRemoteAdmissionSchema.nullable(), blockedBy: remoteBlockedBySchema.nullable(),
  noAdmission: z.boolean(), packet: remotePacketSchema.extend({ ciphertextBytes: rev.positive().max(4096), envelope: z.string().min(1).max(5462).regex(/^[A-Za-z0-9_-]+$/) }) }).strict().refine(value =>
    (value.state === "claimed" || value.state === "expired" || value.state === "rejected") === value.noAdmission &&
    (!value.noAdmission || value.admission === null) && (value.state === "accepted" || value.blockedBy === null) &&
    (!["accepted", "running", "done", "cancelled", "error"].includes(value.state) || value.admission !== null));
export const encryptedRemoteReceiptSchema = z.object({ command: encryptedRemoteCommandSchema, encryptedSpace: encryptedSpaceSchema,
  sourceDeviceName: deviceNameSchema, createdAt: rev, state: remoteStateSchema, admission: publicRemoteAdmissionSchema.nullable(),
  blockedBy: remoteBlockedBySchema.nullable(), withdrawalRequested: z.boolean().optional(), queueSequence: rev.optional(), reason: remoteReasonSchema.nullable(), report: encryptedRemoteReportSchema.nullable(),
  claimedAt: rev.nullable(), acceptedAt: rev.nullable(), updatedAt: rev }).strict();
export const encryptedRemotePageSchema = z.object({ items: z.array(encryptedRemoteReceiptSchema).max(REMOTE_LIMITS.pageRows),
  cursor: z.string().nullable(), complete: z.boolean(), serverTime: rev }).strict();
const remoteCapabilitySchema = z.object({ backend: agentBackendIdSchema, available: z.boolean(), reason: remoteReasonSchema.nullable(),
  publicationId: z.string().uuid(), packet: remotePacketSchema.extend({ ciphertextBytes: rev.positive().max(REMOTE_CIPHER_LIMITS.capabilityBytes),
    envelope: z.string().min(1).max(Math.ceil(REMOTE_CIPHER_LIMITS.capabilityBytes * 4 / 3)).regex(/^[A-Za-z0-9_-]+$/) }).nullable() }).strict().refine(value => !value.available || value.packet !== null);
export const encryptedRemoteAgentsSchema = z.array(remoteCapabilitySchema).max(4).refine(value => new Set(value.map(item => item.backend)).size === value.length);
/* R-33: the computer-level Memory status packet as published, and as returned with the connection and protocol version it was
   sealed under, which the reader needs to rebuild its AAD after the computer's connection moved on. */
export const encryptedRemoteMemorySchema = z.object({ publicationId: z.uuid(),
  packet: remotePacketSchema.extend({ ciphertextBytes: rev.positive().max(1_024) }) }).strict();
export type EncryptedRemoteMemory = z.infer<typeof encryptedRemoteMemorySchema>;
export const encryptedRemoteMemoryTargetSchema = encryptedRemoteMemorySchema.extend({ connectionEpoch: id, protocolVersion: rev.positive() }).strict();
export const encryptedRemotePluginsSchema = z.object({ publicationId: z.uuid(), packet: remotePacketSchema.extend({ ciphertextBytes: rev.positive().max(70_000) }) }).strict();
export type EncryptedRemotePlugins = z.infer<typeof encryptedRemotePluginsSchema>;
export const encryptedRemotePluginsTargetSchema = encryptedRemotePluginsSchema.extend({ connectionEpoch: id, protocolVersion: rev.positive() }).strict();
const encryptedRemoteTargetSchema = remoteTargetSchema.omit({ agents: true, memory: true, plugins: true }).extend({ agents: encryptedRemoteAgentsSchema,
  connectionEpoch: id.nullable(), encryptedSpace: encryptedSpaceSchema.nullable(), plugins: encryptedRemotePluginsTargetSchema.nullable().optional(), memory: encryptedRemoteMemoryTargetSchema.nullable().optional() }).strict();
export const encryptedRemoteTargetsSchema = z.object({ items: z.array(encryptedRemoteTargetSchema).max(REMOTE_LIMITS.pageRows),
  cursor: z.string().nullable(), complete: z.boolean(), sourceDeviceId: id, sourceProtocolVersion: rev,
  remoteControlEnabled: z.boolean(), serverTime: rev }).strict();
/* `target` (U06 Q7): an App's first Edit Chat, reserved until its first message materialises it; the App names its own Project. */
export const remoteCreationInputSchema = z.object({ createOperationId: z.string().uuid(), targetDeviceId: id,
  backend: agentBackendIdSchema, projectId: id.nullable(), target: remoteCreationTargetSchema.optional() }).strict()
  .refine(value => !value.target || value.projectId === null, "remote-creation-target-project");
export const encryptedRemoteCreationSchema = z.object({ createOperationId: z.string().uuid(), binding: remoteCreationBindingSchema,
  createdAt: rev, packet: remotePacketSchema, ciphertextHash: hash }).strict();
/**
 * U06 Q7: an App Edit creation is a reservation, never a Chat row, until its first message materialises the Chat. `filled` (a
 * canonical Edit Chat exists) and `refused` carry the computer's sealed settlement, so the server cannot name the Chat.
 */
export const REMOTE_RESERVATION_STATES = ["reserved", "admitting", "filled", "refused", "expired"] as const;
export const remoteReservationSchema = z.object({ state: z.enum(REMOTE_RESERVATION_STATES), reservedUntil: rev.positive(), settlement: remotePacketSchema.nullable() }).strict()
  .refine(value => (value.state === "filled" || value.state === "refused") === (value.settlement !== null), "remote-reservation-settlement");
export const encryptedRemoteCreationReceiptSchema = z.object({ createOperationId: z.string().uuid(), ciphertextHash: hash,
  chatId: id, incarnationId: id, ownerDeviceId: id, createdAt: rev, deleted: z.boolean(),
  encryptedSpace: encryptedSpaceSchema, creation: encryptedRemoteCreationSchema.nullable(), reservation: remoteReservationSchema.optional() }).strict()
  .refine(value => value.deleted === (value.creation === null))
  .refine(value => value.creation === null || Boolean(value.creation.binding.target) === (value.reservation !== undefined), "remote-reservation-target");
export const frozenRemoteCommandSchema = z.object({ kind: z.literal("encrypted-remote-command"), encryptedSpace: encryptedSpaceSchema,
  plaintextHash: hash, command: encryptedRemoteCommandSchema }).strict();
export const frozenRemoteCreationSchema = z.object({ kind: z.literal("encrypted-remote-creation"), encryptedSpace: encryptedSpaceSchema,
  plaintextHash: hash, creation: encryptedRemoteCreationSchema }).strict();
export type RemotePacket = z.infer<typeof remotePacketSchema>;
export type EncryptedRemoteCommand = z.infer<typeof encryptedRemoteCommandSchema>;
export type EncryptedRemoteReport = z.infer<typeof encryptedRemoteReportSchema>;
export type EncryptedRemoteReceipt = z.infer<typeof encryptedRemoteReceiptSchema>;
export type EncryptedRemoteCreation = z.infer<typeof encryptedRemoteCreationSchema>;
export type EncryptedRemoteCreationReceipt = z.infer<typeof encryptedRemoteCreationReceiptSchema>;
export type FrozenRemoteCommand = z.infer<typeof frozenRemoteCommandSchema>;
export type FrozenRemoteCreation = z.infer<typeof frozenRemoteCreationSchema>;
export type EncryptedRemoteTargets = z.infer<typeof encryptedRemoteTargetsSchema>;
export type RemoteCreationInput = z.infer<typeof remoteCreationInputSchema>;
