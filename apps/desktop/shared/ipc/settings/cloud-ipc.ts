/**
 * [INPUT]: Depends on public cloud display and device schemas by subpath (never the package root, whose function registry would enter the preload), with the `devices:list` shapes checked against the registry at compile time.
 * [OUTPUT]: Provides account and independent sync setup progress, a state-only approval URL, pending sign-out, storage recovery, the closed failed-handshake predicate, this computer's identity, the account computer subscription and closed device/review/rename outcomes.
 * [POS]: apps/desktop/shared/ipc/settings; Shared main/preload/renderer boundary; exchange codes, proof verifiers and credentials are excluded.
 */
import { z } from "zod";
import { syncProgressSchema, type SyncReview, type SyncCleanupReview } from "../../cloud/sync";
import { syncEncryptionStateSchema, initialEncryptionState, syncSetupStateSchema, initialSyncSetupState, type SyncEncryptionState, type SyncSetupInput } from "../../cloud/encryption";
/* By subpath, never the package root: the root re-exports the whole function registry, and the preload would carry every domain's schemas. */
import { accountProfileSchema, cloudIdSchema, computerSchema, deviceNameSchema, deviceSchema, loginMetadataSchema, loginStateSchema, machineIdHashSchema } from "@ai-chat/cloud-protocol/auth/index";
import type { CloudFunctionArgs, CloudFunctionResult } from "@ai-chat/cloud-protocol";
import { environmentIdSchema } from "@ai-chat/cloud-protocol/config";
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
  /** T20-9b: server time minus device time, from main's HTTP Date samples; absent until one is trusted (the renderer keeps the device clock). */
  serverClockOffset: z.number().finite().optional(),
  avatarDataUrl: z.string().max(350_000).regex(/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/).nullable().optional(),
  canDiscardSavedLogin: z.boolean().default(false), canRetryCredentialStorage: z.boolean().default(false),
  canRetryLoginSave: z.boolean().default(false), loginCancelling: z.boolean().default(false), cancelUnconfirmed: z.boolean().default(false),
  /* A persisted sign-out that has not reached the server yet: the local session is already unusable,
     so sign-in must stay closed and say why until the background revoke lands. */
  signOutPending: z.boolean().default(false),
  /* This computer as the desktop knows it: the key the account groups installations by, and the display name this
     installation registered with. They differ exactly when the server suffixed a name another computer held. */
  machine: z.object({ idHash: machineIdHashSchema, name: deviceNameSchema }).strict().nullable().default(null),
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
/* The account's computers, or the reason there are none to show. A renderer that asks while the account is gone or
   the runtime is closing gets an answer, not a stack: main never throws at a surface that only wants to paint. */
export const cloudComputersResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("computers"), computers: z.array(computerSchema).max(100) }).strict(),
  z.object({ kind: z.literal("signed-out") }).strict(),
  z.object({ kind: z.literal("shutting-down") }).strict(),
]);
export type CloudComputersResult = z.infer<typeof cloudComputersResultSchema>;
/** This computer's display name, every installation on it at once; the machine key is main's to supply. */
export const cloudComputerRenameSchema = z.object({ name: deviceNameSchema }).strict();
export const COMPUTER_RENAME_REASONS = ["computer-name-taken", "computer-not-found", "computer-name-invalid"] as const;
export const cloudComputerRenameResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("renamed") }).strict(),
  z.object({ kind: z.literal("rejected"), reason: z.enum(COMPUTER_RENAME_REASONS) }).strict(),
]);
export type CloudComputerRenameResult = z.infer<typeof cloudComputerRenameResultSchema>;
export type CloudComputerRenameReason = (typeof COMPUTER_RENAME_REASONS)[number];
export const cloudRevokeSchema = z.object({ deviceId: cloudIdSchema }).strict();
/* `devices:list`, spelled out here rather than read off the registry (which would carry every domain's schemas into the preload);
   the compile-time checks below keep both shapes equal to the registry's. */
export const cloudDevicesPageSchema = z.object({ devices: z.array(deviceSchema).max(100), cursor: z.string().nullable(), complete: z.boolean() }).strict();
/* The settings list asks for active sessions and only widens to revoked history on request. */
export const cloudDevicesQuerySchema = z.object({ state: z.enum(["active", "revoked"]).optional(), cursor: z.string().max(2048).nullable() }).strict();
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export type CloudDevicesContractsMatch = [Same<z.infer<typeof cloudDevicesPageSchema>, CloudFunctionResult<"devices:list">>,
  Same<z.infer<typeof cloudDevicesQuerySchema>, Pick<CloudFunctionArgs<"devices:list">, "state" | "cursor">>] extends [true, true] ? true : never;
const devicesContractsMatch: CloudDevicesContractsMatch = true;
void devicesContractsMatch;
export { CLOUD_CHANNEL } from "../../ipc-channels/cloud";
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
  /** Settings opened: a signed-out desktop checks availability once (it never polls). */
  settingsOpened(): Promise<void>;
  /** The page's online/offline state changed (TASK-20 T20-2): forwarded every time, main decides whether to reconnect. */
  networkChanged(online: boolean): Promise<void>;
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
  retrySync(): Promise<void>;
  inspectCleanup(): Promise<SyncCleanupReview | null>;
  disableSync(input: { reviewId: string }): Promise<void>;
  inspectAccountSwitch(): Promise<SyncCleanupReview | null>;
  switchAccount(input: { reviewId: string }): Promise<void>;
  listDevices(input: z.infer<typeof cloudDevicesQuerySchema>): Promise<z.infer<typeof cloudDevicesPageSchema>>;
  renameDevice(input: z.infer<typeof cloudRenameSchema>): Promise<void>;
  revokeDevice(input: z.infer<typeof cloudRevokeSchema>): Promise<void>;
  getComputers(): Promise<CloudComputersResult>;
  renameComputer(input: z.infer<typeof cloudComputerRenameSchema>): Promise<CloudComputerRenameResult>;
  onAccountChanged(listener: (state: CloudAccountState) => void): () => void;
  onComputersChanged(listener: (value: CloudComputersResult) => void): () => void;
}
