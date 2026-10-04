/**
 * [INPUT]: Depends on existing App installation owners and main-owned authenticated file/account transports.
 * [OUTPUT]: Prepares original installation/removal and proof-bound App retirement before account cleanup and connects bounded authenticated product access afterward.
 * [POS]: Cloud App composition; no credentials are required by the early local settlement path.
 */
import { CloudAppInstaller, type CloudAppInstallPorts } from "../../apps/install/cloud/installer";
import { CloudAppsService, type CloudAppsPorts } from "./service";
import { DesktopBlobStore, localBlobSource } from "../files/store";
import type { BlobTransferPorts } from "@ai-chat/cloud-protocol";
import { APP_SOURCE_LIMITS } from "@ai-chat/cloud-protocol/apps/source";
import type { AppLocalRemovalService } from "../../apps/conversion/removal/service";
import { sameScope, type SyncScope } from "../../../../shared/local-storage/contracts";
import type { CloudAppDeletion } from "@ai-chat/cloud-protocol/apps/model";
export function prepareCloudApps(ports: Omit<CloudAppInstallPorts, "verifyAccess"> & { removal: AppLocalRemovalService }) {
  let access: CloudAppInstallPorts["verifyAccess"] = async () => { throw new Error("APP_ONLINE_SYNC_REQUIRED"); };
  const installer = new CloudAppInstaller({ ...ports, verifyAccess: input => access(input) });
  const settleDeletion = async (scope: SyncScope, proof: CloudAppDeletion, current: () => void) => {
    current(); await ports.apps.portable.acceptDeletion(scope, proof); current();
    await ports.removal.settleScopeCleanup(scope, `app-deletion-${proof.tombstone.revision}`, current, proof.appId);
    current(); await installer.settleDeletion(scope, proof, current); current();
    await ports.removal.retire(scope, proof); current();
  };
  return { installer, removal: ports.removal, configs: ports.configs, extensions: ports.extensions, settleDeletion,
    async settleScopeCleanup(...args: Parameters<CloudAppInstaller["settleScopeCleanup"]>) {
      for (const entry of ports.apps.portable.list()) if (entry.deletion && sameScope(entry.scope, args[0])) {
        await settleDeletion(args[0], entry.deletion, args[2]);
      }
      await ports.removal.settleScopeCleanup(...args); await installer.settleScopeCleanup(...args);
    },
    setAccess(value: typeof access) { access = value; } };
}
export function createCloudApps(prepared: ReturnType<typeof prepareCloudApps>,
  ports: Omit<CloudAppsPorts, "installer" | "configs" | "extensions" | "readSource"> & {
    userData: string; filePorts(userId: string): BlobTransferPorts;
  }) {
  const service = new CloudAppsService({ ...ports, ...prepared, readSource: async (scope, descriptor, signal) => {
    if (descriptor.sourceBlob.bytes > APP_SOURCE_LIMITS.wireBytes) throw new Error("APP_SOURCE_WIRE_BUDGET");
    const files = new DesktopBlobStore(ports.userData, { environmentId: ports.config.environmentId,
      deploymentId: ports.config.deploymentId, userId: scope.userId }, ports.filePorts(scope.userId));
    try {
      const cached = await files.read(descriptor.sourceBlob, { kind: "app", id: descriptor.appId }, signal);
      signal.throwIfAborted();
      const handle = await localBlobSource(cached.path, descriptor.sourceBlob.mime);
      try {
        // A bounded no-follow handle checks source identity for each read; source envelopes are at most 24 MiB.
        const bytes = new Uint8Array(handle.source.bytes);
        for (let offset = 0; offset < bytes.byteLength; offset += 8 * 1024 * 1024) {
          signal.throwIfAborted(); bytes.set(await handle.source.read(offset, Math.min(8 * 1024 * 1024, bytes.byteLength - offset)), offset);
        }
        return bytes;
      } finally { await handle.close(); }
    } finally { await files.close(); }
  } });
  prepared.setAccess(input => service.verifyAccess(input));
  return service;
}
