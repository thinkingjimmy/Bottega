/**
 * [INPUT]: Depends on the account connection identity/epoch, the durable sync binding, the content cipher port and canonical JSON.
 * [OUTPUT]: Provides accountScopeAdmission and its Admission/Admitted types: whether account-level config sync may talk to the server now, with the request header and a key that changes whenever the identity, epoch, crypto session or space does.
 * [POS]: The one admission gate shared by the Dock layout and Agent-configuration coordinators; neither decides it on its own.
 */
import { canonicalJson, protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import type { CloudAccountService } from "../../runtime/service";
import type { SyncBindingStore } from "../account/binding";
import { accountConfigScopeKey } from "./cleanup";

/* Terminal account states: the account really left, so the scope is sealed. A connecting or offline account is not. */
const SIGNED_OUT = new Set(["signed-out", "signing-out", "revoked", "deleted", "deleting"]);
export type Admitted = { kind: "admitted"; key: string; scopeKey: string; crypto: FileCipherPort; header: ReturnType<typeof protocolHeader> & { expectedUserId: string;
  encryptedSpace: { scope: FileCipherPort["scope"]; keyPackageFingerprint: string } } };
export type Admission = Admitted | { kind: "local-only"; signedOut: boolean } | { kind: "offline" } | { kind: "blocked" };
export type AdmissionPorts = { config: CloudBuildConfig; deviceId: string; binding: Pick<SyncBindingStore, "snapshot">;
  account: Pick<CloudAccountService, "connectionIdentity" | "remoteConnection">; crypto(): FileCipherPort };

export function accountScopeAdmission(ports: AdmissionPorts): Admission {
  const { account, binding: bindings, config, deviceId } = ports;
  const identity = account.connectionIdentity();
  if (!identity.profile) return { kind: "local-only", signedOut: SIGNED_OUT.has(identity.status) };
  if (identity.status !== "ready") return ["temporarily-offline", "connecting", "signing-in"].includes(identity.status) ? { kind: "offline" } : { kind: "blocked" };
  const epoch = account.remoteConnection();
  if (!epoch) return { kind: "offline" };
  const binding = bindings.snapshot();
  // Initializing and active are both admitted (a refused first Library upload parks in initializing); closing and anything unknown are not.
  if (!binding || !(binding.phase === "initializing" || binding.phase === "active") || binding.paused) return { kind: "blocked" };
  if (identity.profile.userId !== binding.userId || identity.deviceId !== deviceId || binding.deviceId !== deviceId) return { kind: "blocked" };
  let crypto: FileCipherPort;
  try { crypto = ports.crypto(); } catch { return { kind: "blocked" }; }
  if (crypto.session.userId !== binding.userId || crypto.session.deviceId !== deviceId) return { kind: "blocked" };
  if (binding.encryption && (canonicalJson(binding.encryption.scope) !== canonicalJson(crypto.scope) ||
    binding.encryption.keyPackageFingerprint !== crypto.keyPackageFingerprint)) return { kind: "blocked" };
  const scopeKey = accountConfigScopeKey(config.environmentId, binding.userId, binding.manifestId);
  const encryptedSpace = { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint };
  return { kind: "admitted", scopeKey, crypto, key: canonicalJson([scopeKey, epoch, crypto.session, encryptedSpace]),
    header: { ...protocolHeader(config), expectedUserId: binding.userId, encryptedSpace } };
}
