/**
 * [INPUT]: Zod's closed display and user-input validation.
 * [OUTPUT]: Secret-free encryption and independent setup progress, plus bounded setup/unlock inputs.
 * [POS]: Trusted desktop IPC contract; content keys and key packages never cross it.
 */
import { z } from "zod";
export const syncEncryptionErrorSchema = z.enum(["sync-unlock-failed", "sync-password-invalid", "sync-password-mismatch", "sync-password-weak",
  "sync-key-storage-unavailable", "sync-key-cache-unreadable", "sync-key-save-failed", "sync-integrity-failed",
  "sync-encryption-unsupported", "sync-space-changed", "legacy-sync-unsupported", "sync-connection-failed", "sync-review-expired"]);
export const syncEncryptionStateSchema = z.object({
  status: z.enum(["checking", "not-configured", "setting-up", "locked", "unlocking", "unlocked", "blocked"]),
  canSetPassword: z.boolean(), canUnlock: z.boolean(), canCancel: z.boolean(), canRetry: z.boolean(),
  error: syncEncryptionErrorSchema.nullable(),
}).strict();
export type SyncEncryptionState = z.infer<typeof syncEncryptionStateSchema>;
export type SyncEncryptionError = z.infer<typeof syncEncryptionErrorSchema>;
export const syncSetupStateSchema = z.object({
  status: z.enum(["idle", "running", "retrying", "failed", "succeeded"]),
  retryCount: z.number().int().min(0).max(3),
  error: z.union([syncEncryptionErrorSchema, z.enum(["scan-failed", "request-failed"])]).nullable(),
}).strict();
export type SyncSetupState = z.infer<typeof syncSetupStateSchema>;
export const initialSyncSetupState: SyncSetupState = { status: "idle", retryCount: 0, error: null };
const password = z.string().min(1).max(1024);
export const syncUnlockInputSchema = z.object({ password }).strict();
export const syncSetupInputSchema = z.object({ reviewId: z.string().uuid(), password,
  confirmation: password.optional(), riskAccepted: z.boolean().optional() }).strict();
export type SyncSetupInput = z.infer<typeof syncSetupInputSchema>;
export const initialEncryptionState: SyncEncryptionState = { status: "locked", canSetPassword: false,
  canUnlock: false, canCancel: false, canRetry: false, error: null };
