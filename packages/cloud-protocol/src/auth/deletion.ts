/**
 * [INPUT]: Depends on the exact environment header and bounded opaque deletion request identities.
 * [OUTPUT]: Defines Google reauthentication, confirmation and credential-proof deletion notice HTTP contracts.
 * [POS]: Shared account lifecycle contract; no browser or renderer receives a session credential.
 */
import { z } from "zod";
import { protocolHeaderSchema } from "../config";
const requestId = z.string().uuid();
const request = protocolHeaderSchema.extend({ requestId }).strict();
export const accountDeletionStatusSchema = z.object({ state: z.enum(["pending", "verified", "deleting", "deleted", "unavailable"]),
  email: z.string().max(320).nullable(), expiresAt: z.number().nullable() }).strict();
export const accountDeletionAuth = {
  begin: { path: "/api/auth/account-deletion/begin", args: protocolHeaderSchema.extend({ requestId, expectedUserId: z.string().min(1).max(192) }).strict(),
    result: accountDeletionStatusSchema },
  status: { path: "/api/auth/account-deletion/status", args: request, result: accountDeletionStatusSchema },
  confirm: { path: "/api/auth/account-deletion/confirm", args: request, result: z.object({ state: z.literal("deleting") }).strict() },
  notice: { path: "/api/auth/account-deletion/notice", args: protocolHeaderSchema,
    result: z.object({ deleted: z.boolean() }).strict() },
} as const;
