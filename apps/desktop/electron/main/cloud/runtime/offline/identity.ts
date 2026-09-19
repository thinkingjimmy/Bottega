/**
 * [INPUT]: Depends on the encrypted credential vault, verified account profile and deployment-bound sync consent.
 * [OUTPUT]: Persists session-bound display identity, projects matching local bindings and restores credential-free pending delivery display.
 * [POS]: Read-only cold-start identity library; it grants no authenticated session or execution admission.
 */
import { pendingLoginSchema } from "../../../../../shared/cloud-ipc";
import type { AccountAccess } from "@ai-chat/cloud-protocol";
import type { CloudCredentials, CredentialStore } from "../../account/credential-store";
import type { SyncBinding } from "../../sync/account/binding";
type Ready = Extract<AccountAccess, { state: "ready" }>;
export function restoreOfflineIdentity(credentials: CloudCredentials, binding: SyncBinding | null, deviceId: string) {
  const { session, offlineIdentity: saved } = credentials;
  if (credentials.signOutRequested || credentials.login || !session || !saved || !binding || binding.phase === "closing" ||
    session.sessionId !== saved.sessionId || session.userId !== saved.profile.userId || binding.userId !== session.userId ||
    binding.deviceId !== deviceId || saved.deviceId !== deviceId) return null;
  return { profile: saved.profile, deviceId };
}
export async function rememberOfflineIdentity(vault: CredentialStore, access: Ready, current: () => boolean) {
  await vault.update(credentials => {
    if (!credentials.session || credentials.session.userId !== access.profile.userId || credentials.signOutRequested) return null;
    const offlineIdentity = { sessionId: credentials.session.sessionId, deviceId: access.deviceId, profile: access.profile };
    return JSON.stringify(credentials.offlineIdentity) === JSON.stringify(offlineIdentity) ? null : { ...credentials, offlineIdentity };
  }, { guard: current });
}

export function restorePendingLogin(credentials: CloudCredentials) {
  const pending = credentials.login;
  if (credentials.signOutRequested || !pending) return null;
  return pendingLoginSchema.parse({ deviceNameSnapshot: pending.deviceNameSnapshot, platform: pending.platform,
    environmentId: pending.environmentId, verificationCode: pending.verificationCode, expiresAt: pending.expiresAt, browserUrl: null,
    progress: pending.cancelRequested ? "cancelling" : ({ exchanging: "exchanging", "awaiting-ack": "confirming", registering: "registering" } as const)[pending.phase] });
}
