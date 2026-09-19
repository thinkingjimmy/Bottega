/**
 * [INPUT]: Depends on public cloud display and device schemas.
 * [OUTPUT]: Provides account and independent sync setup progress, a state-only approval URL, pending sign-out, storage recovery, the closed failed-handshake predicate and closed device/review outcomes.
 * [POS]: Shared main/preload/renderer boundary; exchange codes, proof verifiers and credentials are excluded.
 */
import { z } from "zod";
import { syncProgressSchema, type SyncReview, type SyncCleanupReview } from "./cloud/sync";
import { syncEncryptionStateSchema, initialEncryptionState, syncSetupStateSchema, initialSyncSetupState, type SyncEncryptionState, type SyncSetupInput } from "./cloud/encryption";
import { accountProfileSchema, cloudIdSchema, deviceNameSchema, environmentIdSchema, loginMetadataSchema, loginStateSchema, cloudFunctions } from "@ai-chat/cloud-protocol";
const browserLoginUrlSchema = z.string().max(2048).url().refine(value => {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.hash && url.pathname === "/auth/desktop" &&
      url.searchParams.size === 1 && loginStateSchema.safeParse(url.searchParams.get("state")).success;
  } catch { return false; }
}, "Invalid browser login URL");
export const pendingLoginSchema = loginMetadataSchema.omit({ status: true, returnMode: true }).extend({
  browserUrl: browserLoginUrlSchema.nullable(),
  progress: z.enum(["opening", "securing", "waiting", "exchanging", "confirming", "registering", "cancelling", "connection-failed"]),
}).strict();
export const cloudErrorSchema = z.enum(["encryption-unavailable", "credentials-invalid", "credentials-unreadable", "credentials-environment-mismatch", "secure-save-failed", "browser-open-failed", "installation-already-active", "connection-failed", "login-expired", "login-rejected", "rate-limited", "sign-out-required", "request-failed", "environment-mismatch", "client-outdated", "server-outdated"]).nullable();
export const cloudAccountStateSchema = z.object({ available: z.boolean(), environmentId: environmentIdSchema.nullable(),
  status: z.enum(["local-only", "signed-out", "signing-in", "signing-out", "connecting", "ready", "account-switch-required", "temporarily-offline", "revoked", "suspended", "deleting", "deleted", "environment-mismatch", "client-outdated", "error"]),
  profile: accountProfileSchema.nullable(), deviceId: cloudIdSchema.nullable(), pendingLogin: pendingLoginSchema.nullable(),
  avatarDataUrl: z.string().max(350_000).regex(/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/).nullable().optional(),
  canDiscardSavedLogin: z.boolean().default(false), canRetryCredentialStorage: z.boolean().default(false),
  canRetryLoginSave: z.boolean().default(false), loginCancelling: z.boolean().default(false), cancelUnconfirmed: z.boolean().default(false),
  /* A persisted sign-out that has not reached the server yet: the local session is already unusable,
     so sign-in must stay closed and say why until the background revoke lands. */
  signOutPending: z.boolean().default(false),
  error: cloudErrorSchema, sync: syncProgressSchema, encryption: syncEncryptionStateSchema.default(initialEncryptionState),
  syncSetup: syncSetupStateSchema.default(initialSyncSetupState),
}).strict();
export type CloudAccountState = z.infer<typeof cloudAccountStateSchema>;
export type PendingLoginProjection = z.infer<typeof pendingLoginSchema>;
export type CloudError = z.infer<typeof cloudErrorSchema>;
/* A handshake that failed, from one closed set: the Sync row says "temporarily unavailable"
   instead of blaming the key, the Account banner offers the retry, and main keeps re-checking
   until the account leaves this set. */
const HANDSHAKE_ERRORS: readonly CloudError[] = ["connection-failed", "environment-mismatch", "client-outdated", "server-outdated"];
export const cloudHandshakeFailed = (state: Pick<CloudAccountState, "available" | "status" | "error">) =>
  state.available && state.status !== "ready" && HANDSHAKE_ERRORS.includes(state.error);
export const savedLoginDiscardReviewSchema = z.object({ reviewId: z.string().uuid() }).strict();
export const savedLoginDiscardResultSchema = z.object({ status: z.enum(["discarded", "review-expired"]) }).strict();
export const cloudRenameSchema = z.object({ deviceId: cloudIdSchema, name: deviceNameSchema }).strict();
export const cloudRevokeSchema = z.object({ deviceId: cloudIdSchema }).strict();
export const cloudDevicesPageSchema = cloudFunctions["devices:list"].result;
/* The settings list asks for active sessions and only widens to revoked history on request. */
export const cloudDevicesQuerySchema = cloudFunctions["devices:list"].args.pick({ cursor: true, state: true });
export const CLOUD_CHANNEL = { getAccountState: "cloud:get-account-state", startLogin: "cloud:start-login", cancelLogin: "cloud:cancel-login",
  abandonLogin: "cloud:abandon-login",
  retryLoginSave: "cloud:retry-login-save", retryCredentialStorage: "cloud:retry-credential-storage", retryConnection: "cloud:retry-connection",
  inspectSavedLoginDiscard: "cloud:inspect-saved-login-discard", discardSavedLogin: "cloud:discard-saved-login",
  openCloudAccount: "cloud:open-cloud-account",
  reopenLogin: "cloud:reopen-login", signOut: "cloud:sign-out", listDevices: "cloud:list-devices", renameDevice: "cloud:rename-device",
  revokeDevice: "cloud:revoke-device", accountChanged: "cloud:account-changed",
  inspectSync: "cloud:inspect-sync", cancelSyncReview: "cloud:cancel-sync-review", approveSync: "cloud:approve-sync", pauseSync: "cloud:pause-sync",
  retrySync: "cloud:retry-sync", inspectCleanup: "cloud:inspect-cleanup", disableSync: "cloud:disable-sync",
  inspectAccountSwitch: "cloud:inspect-account-switch", switchAccount: "cloud:switch-account", openAccountDeletion: "cloud:open-account-deletion",
  setupEncryption: "cloud:setup-encryption", unlockEncryption: "cloud:unlock-encryption",
  retryEncryption: "cloud:retry-encryption", cancelEncryption: "cloud:cancel-encryption" } as const;
export interface CloudBridgeApi {
  getAccountState(): Promise<CloudAccountState>;
  startLogin(): Promise<CloudAccountState>;
  cancelLogin(): Promise<CloudAccountState>;
  abandonLogin(): Promise<CloudAccountState>;
  reopenLogin(): Promise<CloudAccountState>;
  signOut(): Promise<CloudAccountState>;
  retryLoginSave(): Promise<CloudAccountState>;
  retryCredentialStorage(): Promise<CloudAccountState>;
  retryConnection(): Promise<CloudAccountState>;
  inspectSavedLoginDiscard(): Promise<z.infer<typeof savedLoginDiscardReviewSchema>>;
  discardSavedLogin(input: z.infer<typeof savedLoginDiscardReviewSchema>): Promise<z.infer<typeof savedLoginDiscardResultSchema>>;
  openCloudAccount(): Promise<void>;
  openAccountDeletion(): Promise<void>;
  setupEncryption(input: SyncSetupInput): Promise<void>;
  unlockEncryption(input: { password: string }): Promise<void>;
  retryEncryption(): Promise<SyncEncryptionState>;
  cancelEncryption(): Promise<void>;
  inspectSync(): Promise<SyncReview>;
  cancelSyncReview(): Promise<void>;
  approveSync(input: { reviewId: string }): Promise<void>;
  pauseSync(input: { paused: boolean }): Promise<void>;
  retrySync(): Promise<void>;
  inspectCleanup(): Promise<SyncCleanupReview | null>;
  disableSync(input: { reviewId: string }): Promise<void>;
  inspectAccountSwitch(): Promise<SyncCleanupReview | null>;
  switchAccount(input: { reviewId: string }): Promise<void>;
  listDevices(input: z.infer<typeof cloudDevicesQuerySchema>): Promise<z.infer<typeof cloudDevicesPageSchema>>;
  renameDevice(input: z.infer<typeof cloudRenameSchema>): Promise<void>;
  revokeDevice(input: z.infer<typeof cloudRevokeSchema>): Promise<void>;
  onAccountChanged(listener: (state: CloudAccountState) => void): () => void;
}
