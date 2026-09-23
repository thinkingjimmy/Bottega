/**
 * [INPUT]: Depends on the exact environment header and bounded opaque deletion request identities.
 * [OUTPUT]: Defines Google reauthentication, confirmation and credential-proof deletion notice HTTP contracts, plus the fixed system-browser continuation page.
 * [POS]: Shared account lifecycle contract; no browser or renderer receives a session credential.
 */
import { z } from "zod";
import { protocolHeaderSchema } from "../config";
const requestId = z.string().uuid();
const request = protocolHeaderSchema.extend({ requestId }).strict();
export const accountDeletionStatusSchema = z.object({ state: z.enum(["pending", "verified", "deleting", "deleted", "unavailable"]),
  email: z.string().max(320).nullable(), expiresAt: z.number().nullable() }).strict();
/* C13: the phone's WebView cannot run Google OAuth, so it opens this fixed page in the system browser. The browser signs in
   there (a new session the callback can prove), then confirms in that same session; the WebView only polls its own request. */
export const accountDeletionContinuationSchema = z.object({ request: requestId, account: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  via: z.literal("browser") }).strict();
export type AccountDeletionContinuation = z.infer<typeof accountDeletionContinuationSchema>;
export const ACCOUNT_DELETION_PATH = "/account/delete";
/** The only destination the continuation opens and returns to: built from a validated request and account, never from input. */
export function accountDeletionContinuationPath(input: { requestId: string; userId: string }) {
  const value = accountDeletionContinuationSchema.parse({ request: input.requestId, account: input.userId, via: "browser" });
  return ACCOUNT_DELETION_PATH + "?" + new URLSearchParams(value);
}
export const accountDeletionAuth = {
  begin: { path: "/api/auth/account-deletion/begin", args: protocolHeaderSchema.extend({ requestId, expectedUserId: z.string().min(1).max(192) }).strict(),
    result: accountDeletionStatusSchema },
  status: { path: "/api/auth/account-deletion/status", args: request, result: accountDeletionStatusSchema },
  confirm: { path: "/api/auth/account-deletion/confirm", args: request, result: z.object({ state: z.literal("deleting") }).strict() },
  notice: { path: "/api/auth/account-deletion/notice", args: protocolHeaderSchema,
    result: z.object({ deleted: z.boolean() }).strict() },
} as const;
