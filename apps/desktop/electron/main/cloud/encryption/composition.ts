/**
 * [INPUT]: The existing authenticated account, scope lifecycle, original sync review and fixed RPC transport.
 * [OUTPUT]: Wires guarded native key ownership and consent-dependent content admission; stopping content never pauses a binding the same operation just approved.
 * [POS]: Desktop E2EE composition; authentication, business queues and cleanup retain their existing owners.
 */
import { randomUUID } from "node:crypto";
import { safeStorage } from "electron";
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { AccountTransport } from "../runtime/transport";
import type { CloudAccountService } from "../runtime/service";
import type { SyncBindingStore } from "../sync/account/binding";
import type { AccountScopeLifecycle } from "../sync/account/cleanup/lifecycle";
import type { InitialSyncController } from "../sync/initial/controller";
import { SyncKeyStore } from "./storage/store";
import { SyncEncryptionController } from "./controller";
import { createDesktopCryptoWorker } from "./worker";
import type { SyncIdentity } from "./model";
export async function composeSyncEncryption(input: { config: CloudBuildConfig; userData: string; deviceId: string;
  service: CloudAccountService; transport: AccountTransport; binding: SyncBindingStore; scope: AccountScopeLifecycle; sync: InitialSyncController; onSyncEnabled?(initial: boolean): Promise<void> }) {
  const { config, service, transport, scope, sync, binding } = input;
  await scope.allowContent(false);
  const store = new SyncKeyStore(input.userData, config, input.deviceId, safeStorage);
  const args = (identity: SyncIdentity) => ({ ...protocolHeader(config), expectedUserId: identity.userId,
    expectedSessionId: identity.sessionId, expectedDeviceId: identity.deviceId });
  const owner: SyncEncryptionController = new SyncEncryptionController({ config, installationId: input.deviceId, store,
    connection: () => service.remoteConnection(), sampleTime: (identity, sampleId) => transport.mutate("account:sampleTime", { ...args(identity), sampleId }),
    identity: () => service.syncIdentity(), accountEmail: () => service.snapshot().profile?.email ?? null,
    hasBinding: () => Boolean(binding.snapshot()), consent: () => binding.snapshot()?.encryption ?? null,
    changed(value) {
      service.updateEncryption(value);
      const ready = owner.isUnlocked();
      void scope.allowContent(ready).then(async () => {
        if (!owner.isUnlocked()) { await scope.allowContent(false); return; }
        sync.resume();
      }).catch(() => {});
    },
    stopContent: () => scope.allowContent(false),
    async verifyIdentity(identity) {
      const sampleId = randomUUID(), result = await transport.mutate("account:sampleTime", { ...args(identity), sampleId });
      if (result.sampleId !== sampleId) throw new Error("sync-space-changed"); return result.current;
    },
    async continuity(identity, previous) {
      const checkId = randomUUID(), result = await transport.mutate("account:checkUnlockContinuity", { ...args(identity), previous, checkId });
      if (result.checkId !== checkId) throw new Error("sync-space-changed"); return result;
    },
    getSpace: identity => transport.query("spaces/api:get", args(identity)),
    createSpace: (identity, candidate) => transport.mutate("spaces/api:createIfAbsent", { ...args(identity), ...candidate }),
    createWorker: createDesktopCryptoWorker,
    validateReview: id => { sync.validateReview(id); },
    async approveReview(id, consent, current, initial) {
      await sync.approve(id, consent, current);
      if (!current()) throw new Error("sync-operation-cancelled");
      await scope.pause(false);
      if (!current()) { await scope.pause(true); throw new Error("sync-operation-cancelled"); }
      await input.onSyncEnabled?.(initial);
      await scope.allowContent(owner.isUnlocked()); sync.resume();
    },
  });
  service.attachEncryption(owner);
  const stopConnection = service.subscribeConnection(() => owner.invalidateClock());
  return { owner, async close() { stopConnection(); await owner.close(); await store.close(); } };
}
