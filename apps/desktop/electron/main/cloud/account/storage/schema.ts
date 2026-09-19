/**
 * [INPUT]: Depends on Zod and the fixed desktop authentication metadata contract.
 * [OUTPUT]: Defines encrypted delivery/session records, a session-bound offline display identity, the empty deployment-bound vault and the asynchronous encryption port.
 * [POS]: Durable credential contract; browser approval requests exist only in LoginFlow memory.
 */
import { z } from "zod";
import { accountProfileSchema, cloudIdSchema, loginMetadataSchema, loginStateSchema, verifierSchema } from "@ai-chat/cloud-protocol";
const sessionSchema = z.object({ userId: z.string(), sessionId: z.string(), bearer: z.string().min(20).max(1024) }).strict();
const pendingSchema = loginMetadataSchema.omit({ status: true, returnMode: true }).extend({ state: loginStateSchema, verifier: verifierSchema,
  codeChallenge: z.string().length(43), phase: z.enum(["exchanging", "awaiting-ack", "registering"]),
  exchangeId: z.string().uuid(), issuedSessionId: z.string().optional(), deliveryDeadline: z.number().optional(),
  cancelRequested: z.boolean().optional(),
}).strict();
export const vaultSchema = z.object({ format: z.literal(1), environmentId: z.string(), deploymentId: z.string(),
  offlineIdentity: z.object({ sessionId: z.string(), deviceId: cloudIdSchema, profile: accountProfileSchema }).strict().optional(),
  session: sessionSchema.nullable(), login: pendingSchema.nullable(), signOutRequested: z.boolean(),
}).strict().superRefine((value, ctx) => {
  const pending = value.login;
  if (!pending) return;
  if (pending.environmentId !== value.environmentId) ctx.addIssue({ code: "custom", message: "Invalid login environment" });
  if (["awaiting-ack", "registering"].includes(pending.phase) &&
    (!value.session || pending.issuedSessionId !== value.session.sessionId || !pending.deliveryDeadline)) {
    ctx.addIssue({ code: "custom", message: "Invalid delivery receipt" });
  }
});
export type CloudCredentials = z.infer<typeof vaultSchema>;
export type PendingLogin = z.infer<typeof pendingSchema>;
export const emptyVault = (environmentId: string, deploymentId: string): CloudCredentials =>
  ({ format: 1, environmentId, deploymentId, session: null, login: null, signOutRequested: false });
export interface CredentialEncryption {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  getSelectedStorageBackend?(): string;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}
