/**
 * [INPUT]: Electron userData/safeStorage, the cloud build schema, credential and device identity stores, the durable sync binding and the owners attached before the first window.
 * [OUTPUT]: Provides prepareCloudRuntime and the PreparedCloudRuntime shape consumed by createCloudRuntime.
 * [POS]: Light half of the cloud composition; startup reads the binding here without compiling the transport/session/sync implementation.
 */
import { app, safeStorage } from "electron";
import { cloudBuildConfigSchema, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { DeviceIdentityStore } from "../../chats/device-identity/device-identity";
import { CredentialStore } from "../account/credential-store";
import { restoreSyncBinding } from "../sync/account/startup";
import { baseIdentityCatalog } from "../sync/account/inventory";
import type { ChatStore } from "../../chats/chat-store";
import { AccountScopeLifecycle } from "../sync/account/cleanup/lifecycle";
import type { ConversionCleanupServices } from "../sync/account/cleanup/conversions";
import type { CleanupOwners } from "../sync/account/cleanup/plan";
import type { AdmissionGate } from "../../lifecycle/admission-gate";
import type { LifecycleIntentStore } from "../../lifecycle/intent-store";
import { LocalHomeCapture } from "../sync-home/capture";
import { prepareCloudApps } from "../apps/composition";
import type { CloudAppInstallPorts } from "../../apps/install/cloud/installer";
import type { LifecycleReconciliation } from "../../lifecycle/reconciliation";
import type { AppLocalRemovalService } from "../../apps/conversion/removal/service";
/* Kept out of composition.ts on purpose: the first parallel group before the window
   awaits this, and reading a binding must not drag in the 1.1 MB composition chunk
   (~20 ms of main-thread compile/evaluate with the V8 compile cache, more without it).
   scripts/check-main-bundle.mjs and tests/prepare-boundary.test.ts hold the boundary. */
export async function prepareCloudRuntime(input: CloudBuildConfig) {
  const config = cloudBuildConfigSchema.parse(input);
  const userData = app.getPath("userData");
  const vault = new CredentialStore(userData, config, safeStorage);
  const deviceId = await new DeviceIdentityStore(userData).loadOrCreate();
  const binding = await restoreSyncBinding(userData, config, vault, deviceId);
  let scope: AccountScopeLifecycle | null = null;
  let attachedOwners: CleanupOwners | null = null;
  let lifecycle: { journal: LifecycleIntentStore; gate: AdmissionGate } | null = null;
  let homeCapture: LocalHomeCapture | null = null;
  let appInstall: ReturnType<typeof prepareCloudApps> | null = null;
  return { config, userData, vault, deviceId, binding, get appInstall() { return appInstall; }, get scope() { return scope; }, get owners() { return attachedOwners; }, get lifecycle() { return lifecycle; }, get homeCapture() { return homeCapture; },
    baseIdentities: (chats: ChatStore) => baseIdentityCatalog(chats, binding.snapshot() ? { environment: config.environmentId, userId: binding.snapshot()!.userId } : null),
    async attach(owners: CleanupOwners, journal: LifecycleIntentStore, gate: AdmissionGate, conversions: ConversionCleanupServices,
      installation: Pick<CloudAppInstallPorts, "configs" | "extensions" | "validateAgent" | "removed"> & { reconciliation: LifecycleReconciliation; removal: AppLocalRemovalService }) {
      if (scope) throw new Error("SYNC_OWNERS_ALREADY_ATTACHED");
      appInstall = prepareCloudApps({ userData, ...owners, journal, gate, ...installation });
      installation.reconciliation.registerRecovery("app-cloud-install", intent => appInstall!.installer.recover(intent));
      scope = new AccountScopeLifecycle({ userData, config, binding, owners, journal, gate, conversions, installations: appInstall }); await scope.initialize();
      attachedOwners = owners; lifecycle = { journal, gate };
      homeCapture = new LocalHomeCapture({ config, userData, binding, store: owners.chats.sync, homes: owners.homes, own: activity => scope!.ownLocal(activity) });
    } };
}
export type PreparedCloudRuntime = Awaited<ReturnType<typeof prepareCloudRuntime>>;
