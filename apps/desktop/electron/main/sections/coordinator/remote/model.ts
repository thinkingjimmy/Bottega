/**
 * [INPUT]: Depends on strict account scope and bounded command identities.
 * [OUTPUT]: Defines durable remote custody with exact scoped Full Access consent and control receipts.
 * [POS]: Additive ledger contracts; old manual records keep their original interpretation.
 */
import { z } from "zod";
import { remoteReferencesSchema } from "@ai-chat/cloud-protocol/remote/input/references";
import { remoteOutputSchema } from "@ai-chat/cloud-protocol/remote/model";
import { interactionSourceSchema } from "@ai-chat/cloud-protocol/turns/live";
import { encryptedRemoteCommandSchema, encryptedRemoteReportSchema } from "@ai-chat/cloud-protocol/remote/encrypted";
import { encryptedSpaceSchema } from "@ai-chat/cloud-protocol/spaces";
import { remoteFullAccessConsentSchema } from "@ai-chat/cloud-protocol/remote/input/model";
import { syncScopeSchema } from "../../../../../shared/local-storage/contracts";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const remoteOriginSchema = z.object({ kind: z.literal("remote"), commandId: id, sourceDeviceId: id,
  sourceDeviceName: z.string().min(1).max(120), payloadHash: hash, ciphertextHash: hash }).strict();
export const remoteContextSchema = z.object({ origin: remoteOriginSchema, scope: syncScopeSchema,
  chatId: id, incarnationId: id, targetDeviceId: id, executionEpoch: z.number().int().nonnegative(),
  references: remoteReferencesSchema.readonly().optional(), connectionEpoch: id, expiresAt: z.number().int().positive(), fullAccessConsent: remoteFullAccessConsentSchema.optional() }).strict();
export const remoteSubmissionSchema = z.object({ context: remoteContextSchema, envelope: z.unknown(), submissionHash: hash }).strict();
export type RemoteContext = z.infer<typeof remoteContextSchema>;
export type RemoteSubmission = z.infer<typeof remoteSubmissionSchema>;
export const controlReceiptSchema = z.object({ id, conversationId: id, requestId: z.string().min(1).max(256), incarnationId: id,
  generation: z.number().int().positive(), key: z.string().min(1).max(400), payloadHash: hash,
  resolvedBy: interactionSourceSchema.optional(), remote: remoteContextSchema.optional(), payload: z.unknown(), state: z.enum(["not-dispatched", "prepared", "applied", "unknown"]),
  output: remoteOutputSchema.optional(), result: z.enum(["applied", "already-resolved"]).nullable(), createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative() }).strict();
export type ControlReceipt = z.infer<typeof controlReceiptSchema>;

export const remoteCiphertextSchema = z.object({ context: remoteContextSchema, command: encryptedRemoteCommandSchema, encryptedSpace: encryptedSpaceSchema,
  report: z.object({ plaintextHash: hash, transport: encryptedRemoteReportSchema }).strict().nullable(),
  createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative() }).strict();
export type RemoteCiphertext = z.infer<typeof remoteCiphertextSchema>;
